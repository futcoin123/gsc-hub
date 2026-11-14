// Страница «Ключи сайтов»: все сайты отмеченных консолей с итогами за период,
// у каждого — все ключи. Период: сегодня / вчера (по Германии, свежие данные)
// или последние N завершённых дней.
import type { Db } from './db';
import { listAccounts, listReportAccounts, type AccountRow } from './accounts';
import { listAllKnownSites, listSitesForAccount, searchAnalyticsQuery, type SiteRow } from './google';
import { siteHostname } from '$lib/utils/url-filters';
import { addCalendarDays, completedDayRange, gscToday, localToday, gscDayStartsAtLocal } from './gsc-calendar';
import { mapSettledLimit } from './concurrency';
import { rowToQueryPage, type QueryPageRow } from './analytics';
import { dropFilteredQueries, filterPatterns } from './filters';

export const PERIODS = ['today', 'yesterday', '7', '28', '90', '180', '480'] as const;
export type PeriodKey = (typeof PERIODS)[number];

export interface Period {
  /** Готовый вариант или свои даты «2026-10-01_2026-10-15». */
  key: PeriodKey | string;
  startDate: string;
  endDate: string;
  /** Сколько дней в периоде — для пересчёта частотности на месяц. */
  days: number;
  /** Google ещё не начал этот день (его сутки — по Калифорнии). */
  pending: boolean;
  startsAt: string | null;
}

const CUSTOM = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/;

/** Свои даты: с–по, не позже сегодняшнего дня и не дальше 16 месяцев назад. */
function customPeriod(raw: string, now: number): Period | null {
  const m = CUSTOM.exec(raw);
  if (!m) return null;
  let [, a, b] = m;
  if (Number.isNaN(Date.parse(a + 'T00:00:00Z')) || Number.isNaN(Date.parse(b + 'T00:00:00Z'))) return null;
  if (a > b) [a, b] = [b, a];
  const today = localToday(now);
  const oldest = addCalendarDays(today, -485);
  if (b > today) b = today;
  if (a < oldest) a = oldest;
  if (a > b) return null;
  const days = Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400_000) + 1;
  return { key: `${a}_${b}`, startDate: a, endDate: b, days, pending: gscToday(now) < b && a === b, startsAt: a === b ? gscDayStartsAtLocal(b, now) : null };
}

/**
 * includeToday: «N дней» = последние N дней вместе с сегодняшним (для счётчика
 * кнопок, который пишет данные сразу). Иначе — N завершённых дней, как в Google.
 */
export function parsePeriod(raw: string | null, now: number = Date.now(), opts: { includeToday?: boolean } = {}): Period {
  const custom = raw ? customPeriod(raw, now) : null;
  if (custom) return custom;
  const key = (PERIODS as readonly string[]).includes(raw ?? '') ? (raw as PeriodKey) : '28';
  if (key === 'today' || key === 'yesterday') {
    const d = key === 'today' ? localToday(now) : addCalendarDays(localToday(now), -1);
    return { key, startDate: d, endDate: d, days: 1, pending: gscToday(now) < d, startsAt: gscDayStartsAtLocal(d, now) };
  }
  const days = Number(key);
  if (opts.includeToday) {
    const endDate = localToday(now);
    return { key, startDate: addCalendarDays(endDate, -(days - 1)), endDate, days, pending: false, startsAt: null };
  }
  const { startDate, endDate } = completedDayRange(days, now);
  return { key, startDate, endDate, days, pending: false, startsAt: null };
}

export interface SiteTotalsRow {
  siteUrl: string;
  accountId: string;
  accountEmail: string;
  accountLabel: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number | null;
  error?: string;
}

/** Все сайты отмеченных консолей (без фильтра по группе) с итогами за период. */
export async function sitesForPeriod(db: Db, p: Period): Promise<{ sites: SiteTotalsRow[]; errors: { account: string; reason: string }[] }> {
  const accounts = listReportAccounts(db);
  const errors: { account: string; reason: string }[] = [];
  const pairs: { acc: AccountRow; site: SiteRow }[] = [];
  const lists = await Promise.allSettled(accounts.map((a) => listSitesForAccount(db, a)));
  lists.forEach((r, i) => {
    if (r.status === 'fulfilled') {
      for (const s of r.value) if (s.permissionLevel !== 'siteUnverifiedUser') pairs.push({ acc: accounts[i], site: s });
    } else errors.push({ account: accounts[i].email, reason: (r.reason as Error).message.slice(0, 200) });
  });
  const res = await mapSettledLimit(pairs, ({ acc, site }) =>
    searchAnalyticsQuery(db, acc, site.siteUrl, { startDate: p.startDate, endDate: p.endDate, dimensions: ['date'] })
  );
  const sites = pairs.map(({ site }, i): SiteTotalsRow => {
    const base = { siteUrl: site.siteUrl, accountId: site.accountId, accountEmail: site.accountEmail, accountLabel: site.accountLabel };
    const r = res[i];
    if (r.status !== 'fulfilled') return { ...base, clicks: 0, impressions: 0, ctr: 0, position: null, error: (r.reason as Error).message.slice(0, 120) };
    let clicks = 0, impressions = 0, posSum = 0;
    for (const x of r.value) {
      clicks += x.clicks;
      impressions += x.impressions;
      posSum += x.position * x.impressions;
    }
    return { ...base, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? posSum / impressions : null };
  });
  return { sites, errors };
}

/** Все ключи сайта за период (ключ + страница), без мусорных запросов. */
export async function siteKeysForPeriod(db: Db, acc: AccountRow, siteUrl: string, p: Period): Promise<QueryPageRow[]> {
  const rows = await searchAnalyticsQuery(db, acc, siteUrl, {
    startDate: p.startDate,
    endDate: p.endDate,
    dimensions: ['query', 'page'],
    rowLimit: 25000
  });
  return dropFilteredQueries(rows.map(rowToQueryPage), filterPatterns(db), (r) => r.query);
}

/**
 * Итоги за период по доменам — из всех консолей, без галочек и группы
 * (страница группы). У домена может быть несколько property: берём ту, где
 * показов больше.
 */
export async function hostTotalsForPeriod(
  db: Db,
  hosts: string[],
  p: Period
): Promise<Record<string, { clicks: number; impressions: number; ctr: number; position: number | null }>> {
  const want = new Set(hosts);
  const { sites } = await listAllKnownSites(db);
  const accounts = new Map(listAccounts(db).map((a) => [a.id, a]));
  const pairs: { acc: AccountRow; site: SiteRow; host: string }[] = [];
  for (const s of sites) {
    if (s.permissionLevel === 'siteUnverifiedUser') continue;
    let host: string;
    try {
      host = siteHostname(s.siteUrl);
    } catch {
      continue;
    }
    const acc = accounts.get(s.accountId);
    if (want.has(host) && acc) pairs.push({ acc, site: s, host });
  }
  const res = await mapSettledLimit(pairs, ({ acc, site }) =>
    searchAnalyticsQuery(db, acc, site.siteUrl, { startDate: p.startDate, endDate: p.endDate, dimensions: ['date'] })
  );
  const out: Record<string, { clicks: number; impressions: number; ctr: number; position: number | null }> = {};
  res.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    let clicks = 0, impressions = 0, posSum = 0;
    for (const x of r.value) {
      clicks += x.clicks;
      impressions += x.impressions;
      posSum += x.position * x.impressions;
    }
    const h = pairs[i].host;
    if (!out[h] || impressions > out[h].impressions)
      out[h] = { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? posSum / impressions : null };
  });
  return out;
}
