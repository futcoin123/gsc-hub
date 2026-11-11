// Отчёт «Закупки»: что изменилось после закупки ссылок — по сайту и по каждому
// купленному ключу (анкору) или странице (безанкорные).
//   До    — 7 дней перед датой закупки.
//   После — со следующего дня по последний полный день Google (не больше 28 дней).
// Клики и показы — суммы за окно (на странице делятся на дни), позиция — средняя,
// взвешенная по показам, как в Search Console.
import type { Db } from './db';
import { getAccount } from './accounts';
import { listAllKnownSites, searchAnalyticsQuery, type SearchAnalyticsRow } from './google';
import { addCalendarDays, dateSpan, latestCompleteDay } from './gsc-calendar';
import type { GroupPurchase } from './link-purchases';
import { nakedAnchor, nakedVariant } from '$lib/utils/naked';

export const BEFORE_DAYS = 7;
export const AFTER_MAX_DAYS = 28;

export interface Window {
  start: string;
  end: string;
  days: number;
}
export interface Metrics {
  clicks: number;
  impressions: number;
  position: number | null;
}
export interface ItemEffect {
  id: number;
  kind: 'anchor' | 'naked';
  /** Анкор или текст безанкорной ссылки. */
  text: string;
  variant: 'url' | 'domain' | null;
  query: string;
  page: string;
  qty: number;
  before: Metrics;
  after: Metrics | null;
}
export interface SiteEffect {
  siteUrl: string;
  links: number;
  before: Metrics;
  after: Metrics | null;
  items: ItemEffect[];
  error: string | null;
}
export interface PurchaseEffect {
  groupId: number;
  name: string;
  date: string;
  before: Window;
  after: Window | null;
  sites: SiteEffect[];
}

export function windows(date: string, now = Date.now()): { before: Window; after: Window | null } {
  const before = { start: addCalendarDays(date, -BEFORE_DAYS), end: addCalendarDays(date, -1), days: BEFORE_DAYS };
  const last = latestCompleteDay(now);
  const start = addCalendarDays(date, 1);
  const cap = addCalendarDays(date, AFTER_MAX_DAYS);
  const end = last < cap ? last : cap;
  return { before, after: end >= start ? { start, end, days: dateSpan(start, end) } : null };
}

/** Сложить строки по дням в одно окно: клики и показы — сумма, позиция — взвешенная. */
export function sumWindow(rows: { date: string; clicks: number; impressions: number; position: number }[], w: Window): Metrics {
  let clicks = 0, impressions = 0, pw = 0;
  for (const r of rows) {
    if (r.date < w.start || r.date > w.end) continue;
    clicks += r.clicks;
    impressions += r.impressions;
    pw += r.position * r.impressions;
  }
  return { clicks, impressions, position: impressions ? pw / impressions : null };
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const anyOf = (xs: string[]) => `^(?:${xs.map(reEscape).join('|')})$`;

const byDate = (rows: SearchAnalyticsRow[], keyIdx: number) => {
  const m = new Map<string, { date: string; clicks: number; impressions: number; position: number }[]>();
  for (const r of rows) {
    const k = r.keys[keyIdx].toLowerCase();
    const list = m.get(k) ?? [];
    list.push({ date: r.keys[keyIdx === 0 ? 1 : 0], clicks: r.clicks, impressions: r.impressions, position: r.position });
    m.set(k, list);
  }
  return m;
};

export async function purchaseEffect(db: Db, p: GroupPurchase, now = Date.now()): Promise<PurchaseEffect> {
  const { before, after } = windows(p.date, now);
  const span = { startDate: before.start, endDate: after?.end ?? before.end };
  const known = await listAllKnownSites(db);
  const accOf = new Map(known.sites.map((s) => [s.siteUrl, s.accountId]));

  const bySite = new Map<string, typeof p.items>();
  for (const i of p.items) bySite.set(i.siteUrl, [...(bySite.get(i.siteUrl) ?? []), i]);

  const sites = await Promise.all(
    [...bySite].map(async ([siteUrl, items]): Promise<SiteEffect> => {
      const links = items.reduce((a, i) => a + i.qty, 0);
      const empty: Metrics = { clicks: 0, impressions: 0, position: null };
      const base = (error: string | null, total?: { before: Metrics; after: Metrics | null }, rows: ItemEffect[] = []): SiteEffect => ({
        siteUrl, links, before: total?.before ?? empty, after: total?.after ?? null, items: rows, error
      });
      const acc = getAccount(db, accOf.get(siteUrl) ?? '');
      if (!acc) return base('сайт не найден ни в одной консоли');
      try {
        const anchors = [...new Set(items.filter((i) => i.kind === 'anchor').map((i) => i.query))];
        const pages = [...new Set(items.filter((i) => i.kind === 'naked').map((i) => i.page))];
        const [daily, qRows, pRows] = await Promise.all([
          searchAnalyticsQuery(db, acc, siteUrl, { ...span, dimensions: ['date'], rowLimit: 1000 }),
          anchors.length
            ? searchAnalyticsQuery(db, acc, siteUrl, {
                ...span, dimensions: ['query', 'date'], rowLimit: 25000,
                dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator: 'includingRegex', expression: anyOf(anchors) }] }]
              })
            : Promise.resolve([] as SearchAnalyticsRow[]),
          pages.length
            ? searchAnalyticsQuery(db, acc, siteUrl, {
                ...span, dimensions: ['page', 'date'], rowLimit: 25000,
                dimensionFilterGroups: [{ filters: [{ dimension: 'page', operator: 'includingRegex', expression: anyOf(pages) }] }]
              })
            : Promise.resolve([] as SearchAnalyticsRow[])
        ]);
        const days = daily.map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions, position: r.position }));
        const q = byDate(qRows, 0);
        const pg = byDate(pRows, 0);
        const rows: ItemEffect[] = items.map((i) => {
          const series = (i.kind === 'anchor' ? q.get(i.query.toLowerCase()) : pg.get(i.page.toLowerCase())) ?? [];
          return {
            id: i.id,
            kind: i.kind,
            text: i.kind === 'naked' ? nakedAnchor(i.page, i.query) : i.query,
            variant: i.kind === 'naked' ? nakedVariant(i.query) : null,
            query: i.query,
            page: i.page,
            qty: i.qty,
            before: sumWindow(series, before),
            after: after ? sumWindow(series, after) : null
          };
        });
        return base(null, { before: sumWindow(days, before), after: after ? sumWindow(days, after) : null }, rows);
      } catch (e) {
        return base((e as Error).message.slice(0, 200));
      }
    })
  );
  return { groupId: p.groupId, name: p.name, date: p.date, before, after, sites };
}
