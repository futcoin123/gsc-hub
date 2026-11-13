import type { Db } from './db';
import { gscCached } from './gsc-cache';
import { als } from './request-context';
import { addCalendarDays, gscToday, completedDayRange, localToday, gscDayStartsAtLocal } from './gsc-calendar';
import { INSPECT_LIMIT, mapSettledLimit } from './concurrency';
import { siteCountries } from '$lib/utils/site-geo';
import { getGoogleClientId, getGoogleClientSecret } from './config';
import {
  type AccountRow,
  isUsableAccount,
  listAccounts,
  listReportAccounts,
  markActiveIfNeeded,
  markError,
  markRevoked,
  updateTokens
} from './accounts';
import { listHiddenSites } from './hidden';
import { activeGroupHosts, siteInHosts } from './site-groups';
import { hostOfSite } from './site-events';
import { mergePageFragments } from './merge-fragments';
import { foldQuery, hostKey } from '$lib/utils/fold-query';

const REFRESH_URL = 'https://oauth2.googleapis.com/token';
/** Сколько держать в кэше ответ за дни, которые Google ещё дописывает. */
const FRESH_TTL_MS = 10 * 60 * 1000;
const SITES_URL = 'https://searchconsole.googleapis.com/webmasters/v3/sites';
const SEARCH_ANALYTICS_URL = (siteUrl: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/searchAnalytics/query`;
const REVOKE_URL = (token: string) =>
  `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`;

const REFRESH_SKEW_SEC = 60;

export interface SiteRow {
  siteUrl: string;
  permissionLevel: string;
  accountId: string;
  accountEmail: string;
  accountLabel: string | null;
}

export interface SitesFanOut {
  sites: SiteRow[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function clientCreds(db: Db): { id: string; secret: string } {
  const id = getGoogleClientId(db);
  const secret = getGoogleClientSecret(db);
  if (!id || !secret) throw new Error('GOOGLE_CLIENT_ID/SECRET not set');
  return { id, secret };
}

/** In-flight refreshes, keyed by account id. See refreshIfNeeded. */
const refreshing = new Map<string, Promise<string>>();

export function refreshIfNeeded(db: Db, acc: AccountRow): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (acc.expires_at > now + REFRESH_SKEW_SEC) return Promise.resolve(acc.access_token);

  // A fan-out hands the same AccountRow to every per-site call, so an expired token would
  // otherwise trigger one token-endpoint POST per site. Google answers a refresh storm with
  // 400s; only an explicit invalid_grant marks the account revoked (see doRefresh).
  const pending = refreshing.get(acc.id);
  if (pending) return pending;

  const p = doRefresh(db, acc).finally(() => refreshing.delete(acc.id));
  refreshing.set(acc.id, p);
  return p;
}

async function doRefresh(db: Db, acc: AccountRow): Promise<string> {
  const { id, secret } = clientCreds(db);
  const body = new URLSearchParams({
    client_id: id,
    client_secret: secret,
    refresh_token: acc.refresh_token,
    grant_type: 'refresh_token'
  });
  const res = await fetch(REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!res.ok) {
    const text = await res.text();
    // Только invalid_grant значит, что доступ правда отозван или истёк (у
    // приложения Google в режиме Testing — через 7 дней): поможет лишь
    // переподключение. Остальное (перегрузка, сбой, шторм обновлений) —
    // временная ошибка: консоль остаётся в работе, следующий запрос повторит.
    if (/invalid_grant/i.test(text)) {
      markRevoked(db, acc.id, `refresh ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`refresh failed (revoked): ${text}`);
    }
    markError(db, acc.id, `refresh ${res.status}: ${text.slice(0, 200)}`);
    throw new Error(`refresh failed: ${res.status}`);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  const newExp = Math.floor(Date.now() / 1000) + json.expires_in;
  updateTokens(db, acc.id, { access_token: json.access_token, expires_at: newExp });
  // Keep the shared row in sync — the rest of the fan-out reads it, not the DB.
  acc.access_token = json.access_token;
  acc.expires_at = newExp;
  markActiveIfNeeded(db, acc);
  return json.access_token;
}

async function authorizedFetch(
  db: Db,
  acc: AccountRow,
  url: string,
  init?: RequestInit
): Promise<Response> {
  const send = (token: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
  const token = await refreshIfNeeded(db, acc);
  const res = await send(token);
  if (res.status !== 401) return res;
  // Токен мог перестать действовать раньше срока: обновить и повторить один раз.
  // Если его уже обновил соседний запрос той же раскладки — берём новый, не
  // обновляя ещё раз. 401 после свежего токена вызывающий считает отзывом.
  if (acc.access_token === token) acc.expires_at = 0;
  return send(await refreshIfNeeded(db, acc));
}

export async function listSitesForAccount(
  db: Db,
  acc: AccountRow
): Promise<SiteRow[]> {
  return gscCached(`sites:${acc.id}`, async () => {
    const res = await authorizedFetch(db, acc, SITES_URL);
    if (res.status === 401) {
      markRevoked(db, acc.id, 'sites.list 401');
      throw new Error('401 unauthorized');
    }
    if (!res.ok) {
      const text = await res.text();
      markError(db, acc.id, `sites.list ${res.status}: ${text.slice(0, 200)}`);
      throw new Error(`sites.list ${res.status}`);
    }
    const json = (await res.json()) as {
      siteEntry?: { siteUrl: string; permissionLevel: string }[];
    };
    markActiveIfNeeded(db, acc);
    return (json.siteEntry ?? []).map((s) => ({
      siteUrl: s.siteUrl,
      permissionLevel: s.permissionLevel,
      accountId: acc.id,
      accountEmail: acc.email,
      accountLabel: acc.label
    }));
  });
}

/**
 * Сайты консоли для общих отчётов: если в шапке выбрана группа сайтов,
 * остаются только её домены. Страница одного сайта и ручные действия по
 * конкретному сайту идут мимо этого фильтра.
 */
async function listReportSitesForAccount(db: Db, acc: AccountRow): Promise<SiteRow[]> {
  const sites = await listSitesForAccount(db, acc);
  const hosts = activeGroupHosts(db);
  return hosts ? sites.filter((s) => siteInHosts(s.siteUrl, hosts)) : sites;
}

/**
 * Все сайты всех рабочих консолей, без фильтров по галочкам и группам:
 * чтобы на странице групп можно было выбрать любой сайт.
 */
export async function listAllKnownSites(db: Db): Promise<SitesFanOut> {
  const accounts = listAccounts(db).filter(isUsableAccount);
  const sites: SiteRow[] = [];
  const errors: SitesFanOut['errors'] = [];
  const settled = await Promise.allSettled(accounts.map((a) => listSitesForAccount(db, a)));
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') sites.push(...r.value);
    else errors.push({ accountId: accounts[i].id, accountEmail: accounts[i].email, reason: (r.reason as Error).message });
  });
  return { sites, errors };
}

export async function listSitesForAllAccounts(db: Db): Promise<SitesFanOut> {
  const accounts = listReportAccounts(db);
  const sites: SiteRow[] = [];
  const errors: SitesFanOut['errors'] = [];

  const settled = await Promise.allSettled(
    accounts.map((a) => listReportSitesForAccount(db, a))
  );

  settled.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') sites.push(...r.value);
    else
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
  });

  return { sites, errors };
}

export interface DimensionFilter {
  dimension: 'query' | 'page' | 'country' | 'device' | 'searchAppearance';
  operator?: 'equals' | 'notEquals' | 'contains' | 'notContains' | 'includingRegex' | 'excludingRegex';
  expression: string;
}

export interface DimensionFilterGroup {
  groupType?: 'and';
  filters: DimensionFilter[];
}

export interface SearchAnalyticsBody {
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit?: number;
  startRow?: number;
  dimensionFilterGroups?: DimensionFilterGroup[];
  dataState?: 'all' | 'final' | 'HOURLY_ALL';
}

// One definition of "last N days", shared with the export route and anything
// else that needs a window. Если страница выставила период из шапки (свои даты,
// «Сегодня», «Вчера»), окно той же длины берёт именно эти даты.
function gscDateRange(days: number, now: number = Date.now()): { startDate: string; endDate: string } {
  const r = als.getStore()?.range;
  if (r && r.days === days) return { startDate: r.startDate, endDate: r.endDate };
  return completedDayRange(days, now);
}

export async function searchAnalyticsQuery(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  body: SearchAnalyticsBody
): Promise<SearchAnalyticsRow[]> {
  // «Сегодня»: суточных цифр за текущий день Google долго не отдаёт, а почасовые
  // уже есть — их показывает Search Console в режиме «24 часа». Берём их и для
  // итогов, и для ключей/страниц, чтобы цифры сходились; если Google почасовые
  // не дал — как раньше, суточные.
  if (isTodayQuery(body)) {
    const hourly = await todayFromHourly(db, acc, siteUrl, body).catch(() => null);
    if (hourly && hourly.length) return hourly;
  }
  return dailyQuery(db, acc, siteUrl, body);
}

// Что можно собрать из почасовых данных: дата и обычные разрезы.
const HOURLY_DIMS = new Set(['date', 'query', 'page', 'country', 'device']);

/** Запрос ровно за сегодняшний день по Германии, без фильтров и без продолжения страниц. */
function isTodayQuery(body: SearchAnalyticsBody): boolean {
  return (
    body.dimensions.length > 0 &&
    body.dimensions.every((d) => HOURLY_DIMS.has(d)) &&
    body.startDate === body.endDate &&
    body.startDate === localToday() &&
    !body.dimensionFilterGroups?.length &&
    !body.startRow &&
    (body.dataState ?? 'all') === 'all'
  );
}

// Если Google отверг почасовой запрос (400), этот разрез какое-то время не
// повторяем, чтобы не удваивать число запросов. Ключ — консоль + разрез.
const hourlyRejected = new Map<string, number>();
const HOURLY_RETRY_MS = 10 * 60 * 1000;

/**
 * Почасовые данные Google за день по времени Германии (как «24 часа» в Search
 * Console), сложенные по остальным разрезам запроса. Час Google помечает
 * моментом с часовым поясом; день по Германии начинается накануне по
 * Калифорнии, поэтому спрашиваем два дня.
 */
async function todayFromHourly(db: Db, acc: AccountRow, siteUrl: string, body: SearchAnalyticsBody): Promise<SearchAnalyticsRow[]> {
  const day = body.startDate;
  const rest = body.dimensions.filter((d) => d !== 'date');
  const rejectKey = `${acc.id}:${rest.join(',')}`;
  if ((hourlyRejected.get(rejectKey) ?? 0) > Date.now()) return [];
  let rows: SearchAnalyticsRow[];
  try {
    rows = await dailyQuery(db, acc, siteUrl, {
      startDate: addCalendarDays(day, -1),
      endDate: day,
      dimensions: ['HOUR', ...rest],
      dataState: 'HOURLY_ALL',
      rowLimit: rest.length ? 25000 : 200
    });
  } catch (e) {
    if (/searchAnalytics 400/.test((e as Error).message)) hourlyRejected.set(rejectKey, Date.now() + HOURLY_RETRY_MS);
    throw e;
  }
  const groups = new Map<string, { other: string[]; clicks: number; impressions: number; posSum: number }>();
  for (const r of rows) {
    const at = hourInstant(r.keys[0] ?? '');
    if (at === null || localToday(at) !== day) continue;
    const other = r.keys.slice(1);
    const k = JSON.stringify(other);
    const g = groups.get(k) ?? groups.set(k, { other, clicks: 0, impressions: 0, posSum: 0 }).get(k)!;
    g.clicks += r.clicks;
    g.impressions += r.impressions;
    g.posSum += r.position * r.impressions;
  }
  const out = [...groups.values()]
    .filter((g) => g.clicks || g.impressions)
    .map((g): SearchAnalyticsRow => {
      let i = 0;
      return {
        keys: body.dimensions.map((d) => (d === 'date' ? day : (g.other[i++] ?? ''))),
        clicks: g.clicks,
        impressions: g.impressions,
        ctr: g.impressions ? g.clicks / g.impressions : 0,
        position: g.impressions ? g.posSum / g.impressions : 0
      };
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  return out.slice(0, body.rowLimit ?? 1000);
}

const laHour = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23'
});

/** Момент начала часа из ключа Google («2026-11-01T05:00:00-08:00»). */
export function hourInstant(key: string): number | null {
  if (!/^\d{4}-\d\d-\d\dT\d\d/.test(key)) return null;
  if (/(Z|[+-]\d\d:?\d\d)$/.test(key)) {
    const t = Date.parse(key);
    return Number.isFinite(t) ? t : null;
  }
  // Без часового пояса — время Калифорнии: летом -07:00, зимой -08:00.
  for (const off of ['-07:00', '-08:00']) {
    const t = Date.parse(key.slice(0, 19) + off);
    if (!Number.isFinite(t)) continue;
    const p = Object.fromEntries(laHour.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    if (`${p.year}-${p.month}-${p.day}T${p.hour}` === key.slice(0, 13)) return t;
  }
  return null;
}

async function dailyQuery(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  body: SearchAnalyticsBody
): Promise<SearchAnalyticsRow[]> {
  // Default to fresh data ('all') so short windows like days=1 work.
  // Callers can override with dataState: 'final' for stable-only queries.
  const payload: SearchAnalyticsBody = { dataState: 'all', ...body };
  // Последние сутки Google ещё дописывает: такой ответ (часто пустой утром)
  // держим 10 минут, а не час, чтобы цифры появились, как только он их выложит.
  const fresh = payload.endDate >= addCalendarDays(gscToday(), -1);
  return gscCached(`saq:${acc.id}:${siteUrl}:${stableKey(payload)}`, async () => {
    const res = await authorizedFetch(
      db,
      acc,
      SEARCH_ANALYTICS_URL(siteUrl),
      { method: 'POST', body: JSON.stringify(payload) }
    );
    if (res.status === 401) {
      markRevoked(db, acc.id, 'searchAnalytics 401');
      throw new Error('searchAnalytics 401 unauthorized');
    }
    if (!res.ok) {
      throw new Error(`searchAnalytics ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = (await res.json()) as { rows?: SearchAnalyticsRow[] };
    markActiveIfNeeded(db, acc);
    // Страницы с якорями (#bonus, #faq) — одна страница: склеиваем.
    return mergePageFragments(json.rows ?? [], (payload.dimensions ?? []).indexOf('page'));
  }, fresh ? FRESH_TTL_MS : undefined);
}

// Deterministic key for a cache entry: the whole body, nested filters
// included, with object keys sorted at every level so the spelling of the
// literal does not matter. Array order is kept - it carries meaning. Flattening
// with String() once turned every filter into "[object Object]", and one
// query's history was served for another.
function stableKey(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]])
        )
      : v
  );
}

// Search Console returns at most 25,000 rows per response and never says that
// more exist, so a single request silently truncates a large export.
export const SEARCH_ANALYTICS_PAGE_SIZE = 25_000;

// Number(), on its own, turns a typo into Infinity or NaN — and NaN silently
// removes the cap, because every comparison against it is false.
export function positiveIntFromEnv(
  raw: string | undefined, fallback: number, max = Number.MAX_SAFE_INTEGER
): number {
  const n = Number((raw ?? '').trim());
  if (!Number.isSafeInteger(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

// An export bounded only by MAX_SAFE_INTEGER is not bounded. One stray digit in
// the environment should not turn the cap off.
export const SEARCH_ANALYTICS_MAX_ROWS_LIMIT = 2_000_000;
// Paging without a ceiling trades silent truncation for an export that can
// exhaust memory or run past any request timeout. The CSV is built row by row,
// but the API quota and the wall clock still need a bound.
export const SEARCH_ANALYTICS_MAX_ROWS = positiveIntFromEnv(
  process.env.GSC_EXPORT_MAX_ROWS, 250_000, SEARCH_ANALYTICS_MAX_ROWS_LIMIT
);

export interface SearchAnalyticsPages extends AsyncIterable<SearchAnalyticsRow[]> {
  /** True when the cap stopped the walk before the data ran out. */
  readonly truncated: boolean;
  /** The cap actually in force, which env parsing may have clamped. */
  readonly maxRows: number;
}

export function searchAnalyticsPages(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  body: Omit<SearchAnalyticsBody, 'rowLimit' | 'startRow'>,
  opts: { pageSize?: number; maxRows?: number; signal?: AbortSignal } = {}
): SearchAnalyticsPages {
  // Clamped to what one response can carry. Asking for more gets 25,000 back,
  // which reads as a short page — "we are done" — while startRow would have
  // stepped over every row the API never delivered.
  const pageSize = Math.min(
    opts.pageSize ?? positiveIntFromEnv(process.env.GSC_EXPORT_PAGE_SIZE, SEARCH_ANALYTICS_PAGE_SIZE),
    SEARCH_ANALYTICS_PAGE_SIZE
  );
  const maxRows = Math.min(
    opts.maxRows ?? positiveIntFromEnv(
      process.env.GSC_EXPORT_MAX_ROWS, 250_000, SEARCH_ANALYTICS_MAX_ROWS_LIMIT
    ),
    SEARCH_ANALYTICS_MAX_ROWS_LIMIT
  );
  const state = { truncated: false };

  async function* walk(): AsyncGenerator<SearchAnalyticsRow[]> {
    let fetched = 0;
    for (let startRow = 0; ; startRow += pageSize) {
      // Checked before each request, so a client that closed the download stops
      // costing quota rather than paying for the whole walk.
      if (opts.signal?.aborted) return;
      const page = await searchAnalyticsQuery(db, acc, siteUrl, {
        ...body, rowLimit: pageSize, startRow
      });
      if (page.length === 0) return;

      const remaining = maxRows - fetched;
      if (page.length >= remaining) {
        const ambiguous = page.length === remaining && page.length === pageSize;
        state.truncated = page.length > remaining;
        // Handed over before the probe: rows already in hand must not be lost
        // to a request whose only job is to label them.
        yield page.slice(0, remaining);
        if (ambiguous && !opts.signal?.aborted) {
          // The cap was filled exactly, on a full page. Only the next row can
          // say whether anything was left behind — so ask for exactly one.
          try {
            const probe = await searchAnalyticsQuery(db, acc, siteUrl, {
              ...body, rowLimit: 1, startRow: startRow + pageSize
            });
            state.truncated = probe.length > 0;
          } catch {
            // Unknown is closer to "short" than to "complete" here.
            state.truncated = true;
          }
        }
        return;
      }
      fetched += page.length;
      yield page;
      // A short page is the only signal the API gives that it is done.
      if (page.length < pageSize) return;
    }
  }

  return {
    get truncated() { return state.truncated; },
    maxRows,
    [Symbol.asyncIterator]: walk
  };
}

export async function revokeToken(token: string): Promise<void> {
  await fetch(REVOKE_URL(token), { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Sitemaps API
// ---------------------------------------------------------------------------

export interface GscSitemap {
  path: string;            // submitted sitemap URL
  isPending: boolean;
  isSitemapsIndex: boolean;
  type: string;            // "WEB", "VIDEO", etc.
  lastSubmitted?: string;
  lastDownloaded?: string;
  warnings?: string;
  errors?: string;
  contents?: { type: string; submitted?: string; indexed?: string }[];
}

const SITEMAPS_LIST_URL = (siteUrl: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`;

const SITEMAP_SUBMIT_URL = (siteUrl: string, feedpath: string) =>
  `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/sitemaps/${encodeURIComponent(feedpath)}`;

export async function listSitemaps(
  db: Db,
  acc: AccountRow,
  siteUrl: string
): Promise<GscSitemap[]> {
  const res = await authorizedFetch(db, acc, SITEMAPS_LIST_URL(siteUrl));
  if (res.status === 401) {
    markRevoked(db, acc.id, 'sitemaps.list 401');
    throw new Error('sitemaps.list 401');
  }
  if (!res.ok) {
    throw new Error(`sitemaps.list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as { sitemap?: GscSitemap[] };
  return json.sitemap ?? [];
}

// PUT a single sitemap feedpath — tells Google to (re)submit it. Empty body, 2xx = ok.
export async function submitSitemap(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  feedpath: string
): Promise<void> {
  const res = await authorizedFetch(db, acc, SITEMAP_SUBMIT_URL(siteUrl, feedpath), {
    method: 'PUT'
  });
  if (res.status === 401) {
    markRevoked(db, acc.id, 'sitemaps.submit 401');
    throw new Error('sitemaps.submit 401');
  }
  if (!res.ok) {
    throw new Error(`sitemaps.submit ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

// DELETE a single sitemap feedpath — tells Google to drop it. 2xx/204 = ok.
export async function deleteSitemap(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  feedpath: string
): Promise<void> {
  const res = await authorizedFetch(db, acc, SITEMAP_SUBMIT_URL(siteUrl, feedpath), {
    method: 'DELETE'
  });
  if (res.status === 401) {
    markRevoked(db, acc.id, 'sitemaps.delete 401');
    throw new Error('sitemaps.delete 401');
  }
  if (!res.ok && res.status !== 204) {
    throw new Error(`sitemaps.delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

function siteHomepage(siteUrl: string): string {
  if (siteUrl.startsWith('sc-domain:')) return `https://${siteUrl.slice('sc-domain:'.length)}/`;
  return siteUrl;
}

export interface SitemapSubmitResult {
  submitted: string[];
  failed: { path: string; reason: string }[];
  source: 'gsc-list' | 'guess' | 'none';
}

// Resubmit every sitemap GSC already knows for this site. If none are listed,
// fall back to guessing {site}/sitemap.xml and submitting that.
export async function resubmitSitemapsForSite(
  db: Db,
  acc: AccountRow,
  siteUrl: string
): Promise<SitemapSubmitResult> {
  let paths: string[] = [];
  let source: SitemapSubmitResult['source'] = 'gsc-list';

  try {
    const sitemaps = await listSitemaps(db, acc, siteUrl);
    paths = sitemaps.map((s) => s.path).filter(Boolean);
  } catch {
    // sitemaps.list failed (other than 401, which already threw) — fall through to guess.
    paths = [];
  }

  if (paths.length === 0) {
    paths = [new URL('/sitemap.xml', siteHomepage(siteUrl)).toString()];
    source = 'guess';
  }

  const settled = await Promise.allSettled(
    paths.map((p) => submitSitemap(db, acc, siteUrl, p))
  );

  const submitted: string[] = [];
  const failed: { path: string; reason: string }[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') submitted.push(paths[i]);
    else failed.push({ path: paths[i], reason: (r.reason as Error).message.slice(0, 200) });
  });

  return { submitted, failed, source: submitted.length === 0 && source === 'guess' ? 'none' : source };
}

export interface SitemapResyncResult {
  robots: string[];                                       // sitemaps declared in robots.txt
  deleted: string[];                                      // previously-registered sitemaps removed
  submitted: string[];                                    // robots sitemaps (re)submitted
  failed: { path: string; op: 'delete' | 'submit'; reason: string }[];
}

// Drop every sitemap GSC currently knows for this site, then submit the given
// robots.txt-declared ones. The caller supplies the robots list (the popup
// already has it) so we don't re-fetch robots.txt here. Errors collected per path.
export async function resyncSitemapsFromRobots(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  robots: string[]
): Promise<SitemapResyncResult> {
  const existing = await listSitemaps(db, acc, siteUrl);

  const deleted: string[] = [];
  const submitted: string[] = [];
  const failed: SitemapResyncResult['failed'] = [];

  for (const sm of existing) {
    try {
      await deleteSitemap(db, acc, siteUrl, sm.path);
      deleted.push(sm.path);
    } catch (e) {
      failed.push({ path: sm.path, op: 'delete', reason: (e as Error).message.slice(0, 200) });
    }
  }

  for (const p of robots) {
    try {
      await submitSitemap(db, acc, siteUrl, p);
      submitted.push(p);
    } catch (e) {
      failed.push({ path: p, op: 'submit', reason: (e as Error).message.slice(0, 200) });
    }
  }

  return { robots, deleted, submitted, failed };
}

// ---------------------------------------------------------------------------
// URL Inspection API
// ---------------------------------------------------------------------------

const URL_INSPECTION_URL =
  'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';

export interface IndexStatusResult {
  verdict: 'PASS' | 'FAIL' | 'PARTIAL' | 'NEUTRAL' | 'VERDICT_UNSPECIFIED';
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
}

export interface InspectedUrl {
  inspectionUrl: string;
  status: 'ok' | 'error';
  index?: IndexStatusResult;
  link?: string; // GSC "open in URL Inspection" deep-link, straight from the API (has the hash id)
  error?: string;
}

export async function inspectUrl(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  inspectionUrl: string,
  languageCode: string = 'en-US'
): Promise<{ index: IndexStatusResult; link?: string }> {
  const res = await authorizedFetch(db, acc, URL_INSPECTION_URL, {
    method: 'POST',
    body: JSON.stringify({ inspectionUrl, siteUrl, languageCode })
  });
  if (res.status === 401) {
    markRevoked(db, acc.id, 'urlInspection 401');
    throw new Error('urlInspection 401 unauthorized');
  }
  if (res.status === 429) {
    throw new Error('urlInspection 429 quota exceeded (2000/day)');
  }
  if (!res.ok) {
    throw new Error(
      `urlInspection ${res.status}: ${(await res.text()).slice(0, 200)}`
    );
  }
  const json = (await res.json()) as {
    inspectionResult?: { indexStatusResult?: IndexStatusResult; inspectionResultLink?: string };
  };
  return {
    index: json.inspectionResult?.indexStatusResult ?? { verdict: 'VERDICT_UNSPECIFIED' },
    link: json.inspectionResult?.inspectionResultLink
  };
}

export async function bulkInspect(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  urls: string[]
): Promise<InspectedUrl[]> {
  const settled = await mapSettledLimit(
    urls,
    (u) => inspectUrl(db, acc, siteUrl, u),
    INSPECT_LIMIT
  );
  return urls.map((u, i) => {
    const r = settled[i];
    if (r.status === 'fulfilled')
      return { inspectionUrl: u, status: 'ok' as const, index: r.value.index, link: r.value.link };
    return {
      inspectionUrl: u,
      status: 'error' as const,
      error: (r.reason as Error).message.slice(0, 200)
    };
  });
}

export interface DailyRow {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface PeriodTotals {
  clicks: number;
  impressions: number;
  ctr: number;       // weighted: total_clicks / total_impressions
  position: number;  // weighted by impressions
}

export interface SiteDailyBreakdown {
  accountId: string;
  accountEmail: string;
  accountLabel: string | null;
  siteUrl: string;
  current: DailyRow[];   // sorted by date asc
  previous: DailyRow[];  // sorted by date asc
  currentTotals: PeriodTotals;
  previousTotals: PeriodTotals;
  error: string | null;  // per-site error if either fetch failed
}

export interface DailyBreakdownFanOut {
  entries: SiteDailyBreakdown[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
  /** False when the previous period falls outside the history the API keeps. */
  comparable: boolean;
}

// Search Console keeps roughly 16 months. Past half of that, the previous
// period lands where there is no data, and a comparison against nothing reads
// as a confident -100% rather than as "unknown".
export const GSC_HISTORY_DAYS = 480;

export function canCompare(days: number): boolean {
  return days * 2 <= GSC_HISTORY_DAYS;
}

export interface TodayTotals {
  /** The date these totals are for, in Search Console's timezone. */
  date: string;
  totals: PeriodTotals;
  /** Google ещё не начал этот день (его сутки — по Калифорнии, на 9 часов позже Германии). */
  pending: boolean;
  /** Во сколько по местному времени Google начнёт этот день («08:00»), если ещё не начал. */
  startsAt: string | null;
  /** Из каких сайтов набрались сегодняшние цифры (только ненулевые, по убыванию показов). */
  bySite: { siteUrl: string; accountId: string; clicks: number; impressions: number }[];
  errors: DailyBreakdownFanOut['errors'];
  /** True when at least one property could not be read, so the sum is short. */
  partial: boolean;
}

// Today on its own, deliberately uncompared: the day is still accumulating, so
// the only honest thing to do with the number is show it.
export async function fetchTodayTotals(db: Db, day: 'today' | 'yesterday' = 'today'): Promise<TodayTotals> {
  // «Сегодня» — по часовому поясу владельца (Германия), а не по Калифорнии.
  // «Вчера» — день перед ним, тоже со свежими (ещё не финальными) данными.
  const date = day === 'yesterday' ? addCalendarDays(localToday(), -1) : localToday();
  const pending = gscToday() < date;
  const accounts = listReportAccounts(db);
  const errors: DailyBreakdownFanOut['errors'] = [];
  const pairs: { acc: AccountRow; site: SiteRow }[] = [];

  const perAccount = await Promise.allSettled(
    accounts.map((a) => listReportSitesForAccount(db, a).then((sites) => ({ acc: a, sites })))
  );
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    else errors.push({ accountId: acc.id, accountEmail: acc.email, reason: (r.reason as Error).message });
  });

  const rows = await mapSettledLimit(pairs, ({ acc, site }) =>
    searchAnalyticsQuery(db, acc, site.siteUrl, {
      startDate: date, endDate: date, dimensions: ['date'], dataState: 'all'
    })
  );

  const daily: DailyRow[] = [];
  const bySite: TodayTotals['bySite'] = [];
  rows.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      const { acc, site } = pairs[i];
      const clicks = r.value.reduce((a, x) => a + x.clicks, 0);
      const impressions = r.value.reduce((a, x) => a + x.impressions, 0);
      if (clicks || impressions) bySite.push({ siteUrl: site.siteUrl, accountId: acc.id, clicks, impressions });
    }
    if (r.status !== 'fulfilled') {
      // Dropping these silently turns a partial sum into a confident total, and
      // an outage into a very bad day.
      const { acc, site } = pairs[i];
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: `${site.siteUrl}: ${(r.reason as Error).message.slice(0, 100)}`
      });
      return;
    }
    r.value.forEach((row) =>
      daily.push({
        date: row.keys[0] ?? date,
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position
      })
    );
  });

  // Any error at all means the sum is short: a failed account discovery
  // contributes zero properties, which counting only site-level failures read
  // as "nothing went wrong".
  bySite.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks);
  return { date, totals: totalsOf(daily), pending, startsAt: gscDayStartsAtLocal(date), bySite, errors, partial: errors.length > 0 };
}

function totalsOf(rows: DailyRow[]): PeriodTotals {
  let clicks = 0, impressions = 0, posWeightedSum = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    posWeightedSum += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posWeightedSum / impressions : 0
  };
}

export async function fetchDailyBreakdown(
  db: Db,
  days: number,
  /** С чем сравнивать: свои даты; без них — прошлый период той же длины, сразу перед текущим. */
  compare: { startDate: string; endDate: string } | null = null
): Promise<DailyBreakdownFanOut> {
  const accounts = listReportAccounts(db);

  const perAccount = await Promise.allSettled(
    accounts.map((a) =>
      listReportSitesForAccount(db, a).then((sites) => ({ acc: a, sites }))
    )
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: DailyBreakdownFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    } else {
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
    }
  });

  if (pairs.length === 0) return { entries: [], errors, comparable: compare ? true : canCompare(days) };

  // Both windows hold exactly `days` completed dates and sit next to each other,
  // so the comparison is between like and like.
  const now = Date.now();
  const { startDate: currentStart, endDate: currentEnd } = gscDateRange(days, now);
  const prevEndAdj = compare?.endDate ?? addCalendarDays(currentStart, -1);
  const prevStart = compare?.startDate ?? addCalendarDays(prevEndAdj, -(days - 1));

  // Per-pair: current, plus previous only when the history reaches it —
  // otherwise that is a second fan-out spent producing a fake -100%.
  const comparable = compare ? true : canCompare(days);
  const windows = pairs.flatMap(({ acc, site }) => [
    { acc, site, startDate: currentStart, endDate: currentEnd },
    ...(comparable ? [{ acc, site, startDate: prevStart, endDate: prevEndAdj }] : [])
  ]);
  const fetches = await mapSettledLimit(windows, ({ acc, site, startDate, endDate }) =>
    searchAnalyticsQuery(db, acc, site.siteUrl, {
      startDate,
      endDate,
      dimensions: ['date'],
      rowLimit: 1000
    })
  );

  // One window per pair when the previous period was skipped, two when it was
  // fetched — the stride has to follow.
  const stride = comparable ? 2 : 1;
  const entries: SiteDailyBreakdown[] = pairs.map(({ acc, site }, i) => {
    const cur = fetches[i * stride];
    const prev = comparable ? fetches[i * stride + 1] : undefined;

    const toDailyRows = (rows: SearchAnalyticsRow[]): DailyRow[] =>
      rows
        .map((r) => ({
          date: r.keys[0] ?? '',
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

    const errorParts: string[] = [];
    let current: DailyRow[] = [];
    let previous: DailyRow[] = [];

    if (cur.status === 'fulfilled') {
      current = toDailyRows(cur.value);
    } else {
      errorParts.push(`current: ${(cur.reason as Error).message.slice(0, 100)}`);
    }
    if (prev === undefined) {
      // Not fetched: the previous period is outside the available history.
      previous = [];
    } else if (prev.status === 'fulfilled') {
      previous = toDailyRows(prev.value);
    } else {
      errorParts.push(`previous: ${(prev.reason as Error).message.slice(0, 100)}`);
    }

    return {
      accountId: acc.id,
      accountEmail: acc.email,
      accountLabel: acc.label,
      siteUrl: site.siteUrl,
      current,
      previous,
      currentTotals: totalsOf(current),
      previousTotals: totalsOf(previous),
      error: errorParts.length > 0 ? errorParts.join('; ') : null
    };
  });

  return { entries, errors, comparable };
}

export interface AggregatedQuery {
  query: string;
  page: string;
  country: string;   // ISO 3166-1 alpha-3 lowercase from GSC (e.g. 'rus', 'usa'); '' if missing
  clicks: number;
  impressions: number;
  ctr: number;       // clicks / impressions
  position: number;  // weighted avg by impressions
}

export interface PerSiteQueries {
  accountId: string;
  siteUrl: string;
  rows: AggregatedQuery[]; // top per site by impressions
}

export interface PerSiteQueriesFanOut {
  entries: PerSiteQueries[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

export async function fetchPerSiteQueries(
  db: Db,
  days: number,
  perSiteLimit: number = 1000
): Promise<PerSiteQueriesFanOut> {
  const accounts = listReportAccounts(db);

  const perAccount = await Promise.allSettled(
    accounts.map((a) =>
      listReportSitesForAccount(db, a).then((sites) => ({ acc: a, sites }))
    )
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: PerSiteQueriesFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    } else {
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
    }
  });

  if (pairs.length === 0) return { entries: [], errors };

  const { startDate, endDate } = gscDateRange(days);

  const perSite = await mapSettledLimit(pairs, ({ acc, site }) =>
    searchAnalyticsQuery(db, acc, site.siteUrl, {
      startDate,
      endDate,
      dimensions: ['query', 'page', 'country'],
      rowLimit: perSiteLimit
    })
  );

  const entries: PerSiteQueries[] = [];
  perSite.forEach((r, i) => {
    const { acc, site } = pairs[i];
    if (r.status !== 'fulfilled') return;
    const rows: AggregatedQuery[] = r.value.map((row) => ({
      query: row.keys[0] ?? '',
      page: row.keys[1] ?? '',
      country: row.keys[2] ?? '',
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position
    }));
    entries.push({ accountId: acc.id, siteUrl: site.siteUrl, rows });
  });

  return { entries, errors };
}

export interface AggregatedPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface PerSitePages {
  accountId: string;
  siteUrl: string;
  rows: AggregatedPage[];
}

export interface PerSitePagesFanOut {
  entries: PerSitePages[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

export async function fetchPerSitePages(
  db: Db,
  days: number,
  perSiteLimit: number = 200
): Promise<PerSitePagesFanOut> {
  const accounts = listReportAccounts(db);

  const perAccount = await Promise.allSettled(
    accounts.map((a) =>
      listReportSitesForAccount(db, a).then((sites) => ({ acc: a, sites }))
    )
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: PerSitePagesFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    } else {
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
    }
  });

  if (pairs.length === 0) return { entries: [], errors };

  const { startDate, endDate } = gscDateRange(days);

  const perSite = await mapSettledLimit(pairs, ({ acc, site }) =>
    searchAnalyticsQuery(db, acc, site.siteUrl, {
      startDate,
      endDate,
      dimensions: ['page'],
      rowLimit: perSiteLimit
    })
  );

  const entries: PerSitePages[] = [];
  perSite.forEach((r, i) => {
    const { acc, site } = pairs[i];
    if (r.status !== 'fulfilled') return;
    const rows: AggregatedPage[] = r.value.map((row) => ({
      page: row.keys[0] ?? '',
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      position: row.position
    }));
    entries.push({ accountId: acc.id, siteUrl: site.siteUrl, rows });
  });

  return { entries, errors };
}

export interface SiteSummary {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  series: number[]; // daily clicks over the window, oldest → newest (for the sparkline)
}

export interface SiteWithSummary extends SiteRow {
  summary: SiteSummary | null;
  summaryError: string | null;
}

export interface SitesWithSummaryFanOut {
  sites: SiteWithSummary[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

export async function listSitesWithSummary(
  db: Db,
  days = 28
): Promise<SitesWithSummaryFanOut> {
  const accounts = listReportAccounts(db);

  // Step 1: fan-out sites.list per account, capture (acc, site[]) and per-account errors.
  const perAccount = await Promise.allSettled(
    accounts.map((a) => listReportSitesForAccount(db, a).then((sites) => ({ acc: a, sites })))
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: SitesWithSummaryFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    } else {
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
    }
  });

  // Step 2: parallel summaries — one call per site, dims=['date'] so a single call yields both
  // the aggregate totals (summed) and the daily series (for the sparkline). Same call count as
  // a totals-only fetch — the sparkline is effectively free.
  const { startDate, endDate } = gscDateRange(days);
  const summaries = await mapSettledLimit(pairs, ({ acc, site }) =>
    searchAnalyticsQuery(db, acc, site.siteUrl, {
      startDate,
      endDate,
      dimensions: ['date'],
      rowLimit: 500
    })
  );

  // Step 3: zip pairs + summaries into SiteWithSummary[].
  const sites: SiteWithSummary[] = pairs.map(({ site }, i) => {
    const r = summaries[i];
    if (r.status === 'fulfilled') {
      const rows = [...r.value].sort((a, b) => (a.keys[0] ?? '').localeCompare(b.keys[0] ?? ''));
      const clicks = rows.reduce((s, x) => s + x.clicks, 0);
      const impressions = rows.reduce((s, x) => s + x.impressions, 0);
      const posWeight = rows.reduce((s, x) => s + x.position * x.impressions, 0);
      return {
        ...site,
        summary: {
          clicks,
          impressions,
          ctr: impressions > 0 ? clicks / impressions : 0,
          position: impressions > 0 ? posWeight / impressions : 0,
          series: rows.map((x) => x.clicks)
        },
        summaryError: null
      };
    }
    return {
      ...site,
      summary: null,
      summaryError: (r.reason as Error).message.slice(0, 200)
    };
  });

  return { sites, errors };
}

export interface QueryHistoryDailyRow {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface QueryHistoryEntry {
  accountId: string;
  accountEmail: string;
  accountLabel: string | null;
  siteUrl: string;
  rows: QueryHistoryDailyRow[];
}

export interface QueryHistoryFanOut {
  entries: QueryHistoryEntry[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

export async function fetchQueryHistory(
  db: Db,
  query: string,
  days: number = 480
): Promise<QueryHistoryFanOut> {
  const accounts = listReportAccounts(db);

  const perAccount = await Promise.allSettled(
    accounts.map((a) =>
      listReportSitesForAccount(db, a).then((sites) => ({ acc: a, sites }))
    )
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: QueryHistoryFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    } else {
      errors.push({
        accountId: acc.id,
        accountEmail: acc.email,
        reason: (r.reason as Error).message
      });
    }
  });

  if (pairs.length === 0) return { entries: [], errors };

  const { startDate, endDate } = gscDateRange(days);

  const fetches = await mapSettledLimit(pairs, ({ acc, site }) =>
    searchAnalyticsQuery(db, acc, site.siteUrl, {
      startDate,
      endDate,
      dimensions: ['date'],
      rowLimit: 25000,
      dimensionFilterGroups: [
        { filters: [{ dimension: 'query', operator: 'equals', expression: query }] }
      ]
    })
  );

  const entries: QueryHistoryEntry[] = [];
  fetches.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const { acc, site } = pairs[i];
    const rows: QueryHistoryDailyRow[] = r.value
      .map((row) => ({
        date: row.keys[0] ?? '',
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length > 0) {
      entries.push({
        accountId: acc.id,
        accountEmail: acc.email,
        accountLabel: acc.label,
        siteUrl: site.siteUrl,
        rows
      });
    }
  });

  return { entries, errors };
}

// ─── Single-site fetches for the site detail page ─────────────────────────────

// One GSC call: query+page rows for the last `days`. Powers Striking / Cannibalization /
// CTR / Branded from a single response (the caller computes all four in analytics.ts).
export async function fetchSiteQueryPages(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  days: number = 28,
  rowLimit: number = 5000
): Promise<SearchAnalyticsRow[]> {
  const { startDate, endDate } = gscDateRange(days);
  return searchAnalyticsQuery(db, acc, siteUrl, {
    startDate,
    endDate,
    dimensions: ['query', 'page'],
    rowLimit
  });
}

// Two page-level windows for content decay: the recent `days` vs the same-length window
// ending `offsetDays` ago. Default is the immediately preceding period (offsetDays = days),
// e.g. last 28d vs the 28d before that — this catches recent declines, unlike a fixed
// months-ago baseline which misses drops on sites that had little traffic back then.
export async function fetchSiteDecayPages(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  days: number = 28,
  offsetDays?: number,
  rowLimit: number = 5000
): Promise<{ recent: SearchAnalyticsRow[]; prior: SearchAnalyticsRow[] }> {
  const gap = offsetDays ?? days;
  const now = Date.now();
  const recentRange = gscDateRange(days, now);
  // `gap` is the distance between the two windows' end dates; both hold exactly
  // `days` dates, so the default gap of `days` makes them adjacent.
  const priorEnd = addCalendarDays(recentRange.endDate, -gap);
  const priorStart = addCalendarDays(priorEnd, -(days - 1));
  const [recent, prior] = await Promise.all([
    searchAnalyticsQuery(db, acc, siteUrl, {
      startDate: recentRange.startDate,
      endDate: recentRange.endDate,
      dimensions: ['page'],
      rowLimit
    }),
    searchAnalyticsQuery(db, acc, siteUrl, {
      startDate: priorStart,
      endDate: priorEnd,
      dimensions: ['page'],
      rowLimit
    })
  ]);
  return { recent, prior };
}

export interface PortfolioDecayEntry {
  accountId: string;
  siteUrl: string;
  recent: SearchAnalyticsRow[];
  prior: SearchAnalyticsRow[];
}

export interface PortfolioDecayFanOut {
  entries: PortfolioDecayEntry[];
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

// Portfolio-wide content decay: two page-level windows per site (recent vs ~3mo earlier).
// Heavier than the query fan-out (2 calls/site) — call lazily.
export async function fetchPortfolioDecayPages(
  db: Db,
  days: number = 28,
  offsetDays?: number,
  rowLimit: number = 5000
): Promise<PortfolioDecayFanOut> {
  const accounts = listReportAccounts(db);

  const perAccount = await Promise.allSettled(
    accounts.map((a) => listReportSitesForAccount(db, a).then((sites) => ({ acc: a, sites })))
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: PortfolioDecayFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') r.value.sites.forEach((s) => pairs.push({ acc, site: s }));
    else errors.push({ accountId: acc.id, accountEmail: acc.email, reason: (r.reason as Error).message });
  });

  const settled = await mapSettledLimit(pairs, ({ acc, site }) =>
    fetchSiteDecayPages(db, acc, site.siteUrl, days, offsetDays, rowLimit)
  );

  const entries: PortfolioDecayEntry[] = [];
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const { acc, site } = pairs[i];
    entries.push({ accountId: acc.id, siteUrl: site.siteUrl, recent: r.value.recent, prior: r.value.prior });
  });

  return { entries, errors };
}

export interface SiteDaily {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  series: { date: string; clicks: number; impressions: number }[]; // oldest → newest
}

// One GSC call, dims=['date']: aggregate totals + daily series for a single site (sparkline +
// Overview header on the detail page).
export async function fetchSiteDaily(
  db: Db,
  acc: AccountRow,
  siteUrl: string,
  days: number = 28
): Promise<SiteDaily> {
  const { startDate, endDate } = gscDateRange(days);
  const rows = await searchAnalyticsQuery(db, acc, siteUrl, {
    startDate,
    endDate,
    dimensions: ['date'],
    rowLimit: 500
  });
  const sorted = [...rows].sort((a, b) => (a.keys[0] ?? '').localeCompare(b.keys[0] ?? ''));
  const clicks = sorted.reduce((s, x) => s + x.clicks, 0);
  const impressions = sorted.reduce((s, x) => s + x.impressions, 0);
  const posWeight = sorted.reduce((s, x) => s + x.position * x.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? posWeight / impressions : 0,
    series: sorted.map((x) => ({ date: x.keys[0] ?? '', clicks: x.clicks, impressions: x.impressions }))
  };
}

export interface PortfolioDaily {
  totals: { clicks: number; impressions: number; ctr: number };
  series: { date: string; clicks: number; impressions: number }[]; // oldest → newest
}

export interface PortfolioDailyFanOut {
  daily: PortfolioDaily;
  hosts: string[]; // bare hosts of the sites included in the aggregate (hidden excluded)
  errors: { accountId: string; accountEmail: string; reason: string }[];
}

// Portfolio pulse: one dims=['date'] call per site, aggregated by calendar date across
// every connected account. Hidden sites are excluded so the pulse matches the visible
// list. Same call count as the sites list — call lazily, not on the main render path.
export async function fetchPortfolioDaily(db: Db, days: number = 180): Promise<PortfolioDailyFanOut> {
  const accounts = listReportAccounts(db);
  const hidden = new Set(listHiddenSites(db));

  const perAccount = await Promise.allSettled(
    accounts.map((a) => listReportSitesForAccount(db, a).then((sites) => ({ acc: a, sites })))
  );

  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const errors: PortfolioDailyFanOut['errors'] = [];
  perAccount.forEach((r, i) => {
    const acc = accounts[i];
    if (r.status === 'fulfilled') {
      r.value.sites.forEach((s) => {
        if (!hidden.has(`${acc.id}|${s.siteUrl}`)) pairs.push({ acc, site: s });
      });
    } else {
      errors.push({ accountId: acc.id, accountEmail: acc.email, reason: (r.reason as Error).message });
    }
  });

  if (pairs.length === 0) {
    return { daily: { totals: { clicks: 0, impressions: 0, ctr: 0 }, series: [] }, hosts: [], errors };
  }

  const { startDate, endDate } = gscDateRange(days);
  const settled = await mapSettledLimit(pairs, ({ acc, site }) =>
    searchAnalyticsQuery(db, acc, site.siteUrl, {
      startDate,
      endDate,
      dimensions: ['date'],
      rowLimit: 500
    })
  );

  // Sum every site's rows into one per-date bucket. Positions are dropped on purpose:
  // an average across domains of different sizes describes no domain in particular.
  const byDate = new Map<string, { clicks: number; impressions: number }>();
  settled.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    for (const x of r.value) {
      const d = x.keys[0] ?? '';
      if (!d) continue;
      const cur = byDate.get(d) ?? { clicks: 0, impressions: 0 };
      cur.clicks += x.clicks;
      cur.impressions += x.impressions;
      byDate.set(d, cur);
    }
  });

  const series = [...byDate.entries()]
    .map(([date, b]) => ({ date, clicks: b.clicks, impressions: b.impressions }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const clicks = series.reduce((s, x) => s + x.clicks, 0);
  const impressions = series.reduce((s, x) => s + x.impressions, 0);

  return {
    daily: {
      totals: { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0 },
      series
    },
    hosts: [...new Set(pairs.map(({ site }) => hostOfSite(site.siteUrl)))],
    errors
  };
}

// ─── Кто из моих сайтов виден по ключу ─────────────────────────────────────────
// Для колонки «Мои другие сайты»: по всем сайтам всех рабочих консолей, без
// фильтров шапки (конкурировать сайт может и с тем, что сейчас скрыт).

export interface QueryOwner {
  host: string;
  siteUrl: string;
  /** Страница этого сайта с наибольшими показами по ключу. */
  page: string;
  accountId: string;
  position: number;
  impressions: number;
  clicks: number;
}

/** Ключ → все ваши сайты с показами по нему (и один сайт тоже). */
export async function fetchQueryHosts(db: Db, days = 28): Promise<Map<string, QueryOwner[]>> {
  return gscCached(`qhosts:${days}`, async () => {
    const accounts = listAccounts(db).filter(isUsableAccount);
    const perAccount = await Promise.allSettled(accounts.map((a) => listSitesForAccount(db, a)));
    const pairs: { acc: AccountRow; site: SiteRow }[] = [];
    perAccount.forEach((r, i) => {
      if (r.status === 'fulfilled')
        r.value.forEach((site) => {
          if (site.permissionLevel !== 'siteUnverifiedUser') pairs.push({ acc: accounts[i], site });
        });
    });
    const { startDate, endDate } = completedDayRange(days);
    const perSite = await mapSettledLimit(pairs, ({ acc, site }) =>
      searchAnalyticsQuery(db, acc, site.siteUrl, { startDate, endDate, dimensions: ['query', 'page'], rowLimit: 5000 })
    );
    // ключ → домен → лучшая строка (у домена может быть две property: sc-domain: и https://)
    const byQuery = new Map<string, Map<string, QueryOwner>>();
    perSite.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const { acc, site } = pairs[i];
      const host = hostKey(site.siteUrl);
      for (const row of r.value) {
        const q = foldQuery(row.keys[0] ?? '');
        if (!q) continue;
        const hosts = byQuery.get(q) ?? new Map<string, QueryOwner>();
        const cur = hosts.get(host);
        if (!cur || row.impressions > cur.impressions) {
          hosts.set(host, { host, siteUrl: site.siteUrl, page: row.keys[1] ?? '', accountId: acc.id, position: row.position, impressions: row.impressions, clicks: row.clicks });
        }
        byQuery.set(q, hosts);
      }
    });
    const out = new Map<string, QueryOwner[]>();
    for (const [q, hosts] of byQuery) out.set(q, [...hosts.values()].sort((a, b) => a.position - b.position));
    return out;
  }, 60 * 60 * 1000);
}

export async function fetchQueryOwners(db: Db, days = 28): Promise<Map<string, QueryOwner[]>> {
  const all = await fetchQueryHosts(db, days);
  const out = new Map<string, QueryOwner[]>();
  for (const [q, list] of all) if (list.length > 1) out.set(q, list);
  return out;
}

/** Домен → его страны (см. siteCountries). Один запрос по странам на каждую property, кэш час. */
export async function fetchSiteGeos(db: Db, days = 28): Promise<Map<string, string[]>> {
  return gscCached(`geos:${days}`, async () => {
    const accounts = listAccounts(db).filter(isUsableAccount);
    const perAccount = await Promise.allSettled(accounts.map((a) => listSitesForAccount(db, a)));
    const pairs: { acc: AccountRow; site: SiteRow }[] = [];
    perAccount.forEach((r, i) => {
      if (r.status === 'fulfilled')
        r.value.forEach((site) => {
          if (site.permissionLevel !== 'siteUnverifiedUser') pairs.push({ acc: accounts[i], site });
        });
    });
    const { startDate, endDate } = completedDayRange(days);
    const perSite = await mapSettledLimit(pairs, ({ acc, site }) =>
      searchAnalyticsQuery(db, acc, site.siteUrl, { startDate, endDate, dimensions: ['country'], rowLimit: 100 })
    );
    // У домена может быть две property — берём ту, где показов больше.
    const best = new Map<string, { total: number; countries: string[] }>();
    perSite.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      const rows = r.value.map((x) => ({ country: x.keys[0] ?? '', impressions: x.impressions }));
      const total = rows.reduce((t, x) => t + x.impressions, 0);
      const host = hostKey(pairs[i].site.siteUrl);
      if (total > (best.get(host)?.total ?? -1)) best.set(host, { total, countries: siteCountries(rows) });
    });
    return new Map([...best].map(([h, v]) => [h, v.countries]));
  }, 60 * 60 * 1000);
}

// ─── Поиск ключа по всем сайтам ────────────────────────────────────────────────
// Страница «Поиск ключа»: на каких ваших сайтах и страницах есть ключ, на каком
// месте и в какой стране. С ключом фильтр считает Google (contains / equals);
// без ключа («Все ключи») — топ строк каждого сайта. По одному вызову на сайт,
// ответы кэшируются. Неподтверждённые property пропускаются (Google отдаёт 403).

export interface KeywordHit {
  query: string;
  page: string;
  country: string;
  siteUrl: string;
  host: string;
  accountId: string;
  accountEmail: string;
  position: number;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface KeywordSearchResult {
  hits: KeywordHit[];
  sites: number;
  errors: number;
  noAccess: number;
  errorList: { site: string; reason: string }[];
}

export async function searchKeywordAcrossSites(
  db: Db,
  q: string | null,
  mode: 'contains' | 'equals' = 'contains',
  days = 28
): Promise<KeywordSearchResult> {
  const run = async (): Promise<KeywordSearchResult> => {
    const accounts = listAccounts(db).filter(isUsableAccount);
    const perAccount = await Promise.allSettled(accounts.map((a) => listSitesForAccount(db, a)));
    const pairs: { acc: AccountRow; site: SiteRow }[] = [];
    let noAccess = 0;
    perAccount.forEach((r, i) => {
      if (r.status === 'fulfilled')
        r.value.forEach((site) => {
          if (site.permissionLevel === 'siteUnverifiedUser') noAccess++;
          else pairs.push({ acc: accounts[i], site });
        });
    });
    const { startDate, endDate } = completedDayRange(days);
    const perSite = await mapSettledLimit(pairs, ({ acc, site }) =>
      searchAnalyticsQuery(db, acc, site.siteUrl, {
        startDate,
        endDate,
        dimensions: ['query', 'page', 'country'],
        rowLimit: q ? 2000 : 1000,
        ...(q ? { dimensionFilterGroups: [{ filters: [{ dimension: 'query' as const, operator: mode, expression: q }] }] } : {})
      })
    );
    // Один домен может быть в двух property (sc-domain: и https://): берём строку с бо́льшими показами.
    const best = new Map<string, KeywordHit>();
    let errors = 0;
    const errorList: { site: string; reason: string }[] = [];
    perSite.forEach((r, i) => {
      if (r.status !== 'fulfilled') {
        if (/searchAnalytics 403/.test(String((r.reason as Error)?.message))) {
          noAccess++;
          return;
        }
        errors++;
        errorList.push({ site: pairs[i].site.siteUrl, reason: String((r.reason as Error)?.message ?? r.reason).slice(0, 160) });
        return;
      }
      const { acc, site } = pairs[i];
      const host = hostKey(site.siteUrl);
      for (const row of r.value) {
        const hit: KeywordHit = {
          query: row.keys[0] ?? '',
          page: row.keys[1] ?? '',
          country: row.keys[2] ?? '',
          siteUrl: site.siteUrl,
          host,
          accountId: acc.id,
          accountEmail: acc.email,
          position: row.position,
          impressions: row.impressions,
          clicks: row.clicks,
          ctr: row.ctr
        };
        const k = `${host}\n${hit.query}\n${hit.page}\n${hit.country}`;
        const cur = best.get(k);
        if (!cur || hit.impressions > cur.impressions) best.set(k, hit);
      }
    });
    return { hits: [...best.values()], sites: pairs.length, errors, noAccess, errorList };
  };
  // «Все ключи» собираются долго — держим готовый результат час.
  return q ? run() : gscCached(`allkw:${days}`, run, 60 * 60 * 1000);
}

/** Сложить строки разных стран в одну строку «ключ + страница» (если страна не важна). */
export function mergeCountries(hits: KeywordHit[]): KeywordHit[] {
  const m = new Map<string, KeywordHit & { _pos: number }>();
  for (const h of hits) {
    const k = `${h.host}\n${h.query}\n${h.page}`;
    const cur = m.get(k);
    if (!cur) m.set(k, { ...h, country: '', _pos: h.position * h.impressions });
    else {
      cur.clicks += h.clicks;
      cur.impressions += h.impressions;
      cur._pos += h.position * h.impressions;
    }
  }
  return [...m.values()].map(({ _pos, ...h }) => ({
    ...h,
    position: h.impressions ? _pos / h.impressions : h.position,
    ctr: h.impressions ? h.clicks / h.impressions : 0
  }));
}
