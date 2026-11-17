// Индексация сайтов раз в 3 дня (просьба владелицы 17.11.2026: «считать раз в
// 2–5 дней индексацию и рядом писать, что 2 страницы не в индексе»).
//
// Панель сама, без участия Claude: берёт страницы сайта из sitemap и каждую
// проверяет в Search Console (URL Inspection API — тот же запрос, что при
// раскрытии сайта на Sites). Лимит Google — 2000 проверок в день на сайт; сайту
// из 10–50 страниц хватает с большим запасом. В Sites рядом с сайтом —
// «N из M не в индексе» и какие страницы.
import type { Db } from './db';
import { getAccount } from './accounts';
import { bulkInspect, listSitemaps, listSitesForAllAccounts, type InspectedUrl } from './google';
import { fetchSitemapUrls } from './sitemap';
import { listHiddenSites } from './hidden';

/** Как часто проверять сайт. */
export const INDEX_EVERY_MS = 3 * 86400_000;
/** Сколько страниц сайта проверять за раз (из sitemap). */
export const INDEX_MAX_URLS = 100;
/** Сколько сайтов проверять за один заход таймера — чтобы не бить Google разом. */
const SITES_PER_TICK = 3;

export interface IndexCheck {
  siteUrl: string;
  checkedAt: number;
  total: number;
  indexed: number;
  notIndexed: number;
  /** Страницы, которые проверить не вышло (ошибка Google). */
  failed: number;
  /** Страницы не в индексе: путь и причина Google (coverageState). */
  missing: { url: string; reason: string }[];
  /** Почему проверить сайт не удалось совсем (нет sitemap и т. п.). */
  error: string | null;
}

/** Страница в индексе: PASS (и PARTIAL — в индексе с замечаниями). */
export function isIndexed(r: InspectedUrl): boolean | null {
  if (r.status !== 'ok' || !r.index) return null;
  return r.index.verdict === 'PASS' || r.index.verdict === 'PARTIAL';
}

/** Итог проверки страниц сайта. */
export function summarize(siteUrl: string, results: InspectedUrl[], now = Date.now()): IndexCheck {
  let indexed = 0, failed = 0;
  const missing: { url: string; reason: string }[] = [];
  for (const r of results) {
    const v = isIndexed(r);
    if (v === null) failed++;
    else if (v) indexed++;
    else missing.push({ url: r.inspectionUrl, reason: r.index?.coverageState ?? r.index?.verdict ?? '' });
  }
  return { siteUrl, checkedAt: now, total: results.length, indexed, notIndexed: missing.length, failed, missing, error: null };
}

/** Адреса из sitemap, которые принадлежат этому property (у папки — только её страницы). */
export function ownUrls(siteUrl: string, urls: string[]): string[] {
  const out: string[] = [];
  for (const u of urls) {
    try {
      const x = new URL(u);
      const ok = siteUrl.startsWith('sc-domain:')
        ? x.hostname === siteUrl.slice(10) || x.hostname.endsWith('.' + siteUrl.slice(10))
        : u.startsWith(siteUrl);
      if (ok && !out.includes(u)) out.push(u);
    } catch {
      /* не адрес */
    }
  }
  return out;
}

const home = (siteUrl: string) => (siteUrl.startsWith('sc-domain:') ? `https://${siteUrl.slice(10)}/` : siteUrl);

async function sitemapUrls(db: Db, acc: NonNullable<ReturnType<typeof getAccount>>, siteUrl: string): Promise<string[]> {
  try {
    const maps = await listSitemaps(db, acc, siteUrl);
    const ok = maps.find((s) => !s.errors || s.errors === '0') ?? maps[0];
    if (ok?.path) {
      const urls = ownUrls(siteUrl, await fetchSitemapUrls(ok.path, INDEX_MAX_URLS * 2));
      if (urls.length) return urls.slice(0, INDEX_MAX_URLS);
    }
  } catch {
    /* дальше — sitemap.xml в корне */
  }
  const urls = ownUrls(siteUrl, await fetchSitemapUrls(new URL('/sitemap.xml', home(siteUrl)).toString(), INDEX_MAX_URLS * 2));
  return urls.slice(0, INDEX_MAX_URLS);
}

function save(db: Db, c: IndexCheck & { accountId: string }): void {
  db.prepare(
    `INSERT INTO index_checks (site_url, account_id, checked_at, total, indexed, not_indexed, failed, missing, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(site_url) DO UPDATE SET account_id = excluded.account_id, checked_at = excluded.checked_at, total = excluded.total,
       indexed = excluded.indexed, not_indexed = excluded.not_indexed, failed = excluded.failed, missing = excluded.missing, error = excluded.error`
  ).run(c.siteUrl, c.accountId, c.checkedAt, c.total, c.indexed, c.notIndexed, c.failed, JSON.stringify(c.missing), c.error);
}

/** Проверить один сайт сейчас и сохранить итог. */
export async function checkSiteIndex(db: Db, accountId: string, siteUrl: string, now = Date.now()): Promise<IndexCheck> {
  const acc = getAccount(db, accountId);
  const fail = (error: string): IndexCheck => {
    const c = { siteUrl, checkedAt: now, total: 0, indexed: 0, notIndexed: 0, failed: 0, missing: [], error };
    save(db, { ...c, accountId });
    return c;
  };
  if (!acc || acc.status === 'revoked') return fail('консоль не подключена');
  let urls: string[];
  try {
    urls = await sitemapUrls(db, acc, siteUrl);
  } catch (e) {
    return fail(`sitemap не прочитался: ${(e as Error).message.slice(0, 120)}`);
  }
  if (!urls.length) return fail('в sitemap нет страниц этого сайта');
  const c = summarize(siteUrl, await bulkInspect(db, acc, siteUrl, urls), now);
  // Все проверки упали (например, лимит Google) — не затираем прошлый итог.
  if (c.failed === c.total) {
    const prev = indexChecks(db).get(siteUrl);
    if (prev && !prev.error) return prev;
    return fail('Google не ответил на проверку страниц');
  }
  save(db, { ...c, accountId });
  return c;
}

/** Последние итоги по сайтам: siteUrl → итог. */
export function indexChecks(db: Db): Map<string, IndexCheck> {
  const rows = db.prepare('SELECT * FROM index_checks').all() as Record<string, unknown>[];
  return new Map(
    rows.map((r) => [
      r.site_url as string,
      {
        siteUrl: r.site_url as string,
        checkedAt: r.checked_at as number,
        total: r.total as number,
        indexed: r.indexed as number,
        notIndexed: r.not_indexed as number,
        failed: r.failed as number,
        missing: JSON.parse((r.missing as string) || '[]'),
        error: (r.error as string | null) ?? null
      }
    ])
  );
}

/** Сайты, у которых подошёл срок: не проверялись или проверены больше 3 дней назад. */
export function dueSites<T extends { siteUrl: string }>(sites: T[], checks: Map<string, IndexCheck>, now = Date.now()): T[] {
  return sites
    .filter((s) => now - (checks.get(s.siteUrl)?.checkedAt ?? 0) >= INDEX_EVERY_MS)
    .sort((a, b) => (checks.get(a.siteUrl)?.checkedAt ?? 0) - (checks.get(b.siteUrl)?.checkedAt ?? 0));
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
/** Фоновая проверка: раз в 20 минут берёт до трёх сайтов, у которых подошёл срок. */
export function startIndexMonitor(getDb: () => Db): void {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const db = getDb();
      const { sites } = await listSitesForAllAccounts(db);
      const hidden = new Set(listHiddenSites(db));
      const seen = new Set<string>();
      const list = sites.filter((s) => {
        if (hidden.has(`${s.accountId}|${s.siteUrl}`) || seen.has(s.siteUrl)) return false;
        seen.add(s.siteUrl);
        return true;
      });
      for (const s of dueSites(list, indexChecks(db)).slice(0, SITES_PER_TICK)) {
        try {
          await checkSiteIndex(db, s.accountId, s.siteUrl);
        } catch (e) {
          console.error('Index monitor:', s.siteUrl, (e as Error).message);
        }
      }
    } catch (e) {
      console.error('Index monitor:', (e as Error).message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), 20 * 60_000);
  timer.unref();
  setTimeout(() => void tick(), 3 * 60_000).unref();
}
