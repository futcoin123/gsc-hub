// Закупки ссылок из групп («10-11-26») — для графиков и отчёта «Закупки».
//
// Дата закупки: когда группу зафиксировали (ТЗ ушло исполнителю), иначе дата
// в названии группы (дд-мм-гг), иначе когда группу создали. Время — по Берлину.
import type { Db } from './db';
import { localToday } from './gsc-calendar';
import { listGroupItems, type GroupItem } from './group-items';
import { nakedAnchor } from '$lib/utils/naked';

export interface GroupPurchase {
  groupId: number;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  fixed: boolean;
  items: GroupItem[];
}

/** «10-11-26» → 2026-11-10; не дата — null. */
export function dateFromGroupName(name: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{2})$/.exec(name.trim());
  if (!m) return null;
  const iso = `20${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function purchaseDate(g: { name: string; created_at: number; fixed_at: number | null }): string {
  if (g.fixed_at) return localToday(g.fixed_at);
  return dateFromGroupName(g.name) ?? localToday(g.created_at);
}

/** Группы, в которых есть ссылки, новые сверху. */
export function listGroupPurchases(db: Db): GroupPurchase[] {
  const groups = db
    .prepare(
      `SELECT id, name, created_at, fixed_at FROM site_groups g
        WHERE EXISTS (SELECT 1 FROM site_group_items i WHERE i.group_id = g.id)`
    )
    .all() as { id: number; name: string; created_at: number; fixed_at: number | null }[];
  return groups
    .map((g) => ({ groupId: g.id, name: g.name, date: purchaseDate(g), fixed: g.fixed_at !== null, items: listGroupItems(db, g.id) }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.groupId - a.groupId);
}

const hostOf = (siteUrl: string) => {
  const raw = siteUrl.startsWith('sc-domain:') ? `https://${siteUrl.slice(10)}/` : siteUrl;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** Коротко, что купили: «fc 27 coins ×3, fut coins, безанкор ×4». */
export function itemsLabel(items: GroupItem[], max = 4): string {
  const anchors = new Map<string, number>();
  let naked = 0;
  for (const i of items) {
    if (i.kind === 'naked') naked += i.qty;
    else anchors.set(i.query, (anchors.get(i.query) ?? 0) + i.qty);
  }
  const parts = [...anchors].sort((a, b) => b[1] - a[1]).map(([q, n]) => (n > 1 ? `${q} ×${n}` : q));
  const shown = parts.slice(0, max);
  if (parts.length > max) shown.push(`ещё ${parts.length - max}`);
  if (naked) shown.push(naked > 1 ? `безанкор ×${naked}` : 'безанкор');
  return shown.join(', ');
}

export interface PurchaseMark {
  id: number;
  host: string;
  date: string;
  groupId: number;
  name: string;
  links: number;
  label: string;
}

/** Одна пометка на график на группу и сайт. */
export function groupPurchaseMarks(db: Db, purchases = listGroupPurchases(db)): PurchaseMark[] {
  const out: PurchaseMark[] = [];
  for (const p of purchases) {
    const bySite = new Map<string, GroupItem[]>();
    for (const i of p.items) {
      const h = hostOf(i.siteUrl);
      if (h) bySite.set(h, [...(bySite.get(h) ?? []), i]);
    }
    for (const [host, items] of bySite) {
      const links = items.reduce((a, i) => a + i.qty, 0);
      out.push({
        id: -(1_000_000_000 + p.groupId),
        host,
        date: p.date,
        groupId: p.groupId,
        name: p.name,
        links,
        label: `Закупка ${p.name}: ${links} ссыл. (${itemsLabel(items)})`
      });
    }
  }
  return out;
}

/**
 * Пометки для графика одного ключа: закупки ссылок на ту страницу сайта, где
 * этот ключ стоит в Google (любым анкором и безанкорные). Ссылка ведёт на
 * страницу, а не «на ключ»: один анкор бывает на страницах разных стран
 * (futcoins.eu/nl/ и /pl/), поэтому совпадение по тексту анкора не считаем.
 */
export function keywordPurchaseMarks(db: Db, siteUrl: string, _query: string, page: string | null): PurchaseMark[] {
  const host = hostOf(siteUrl);
  if (!page) return [];
  const norm = (u: string) => u.replace(/#.*$/, '').replace(/\/$/, '');
  const target = norm(page);
  const out: PurchaseMark[] = [];
  for (const p of listGroupPurchases(db)) {
    const hit = p.items.filter((i) => hostOf(i.siteUrl) === host && norm(i.page) === target);
    if (!hit.length) continue;
    const links = hit.reduce((a, i) => a + i.qty, 0);
    out.push({ id: -(1_000_000_000 + p.groupId), host, date: p.date, groupId: p.groupId, name: p.name, links, label: `Закупка ${p.name}: ${links} ссыл. на эту страницу (${itemsLabel(hit)})` });
  }
  return out;
}

/**
 * Для колонки «В группу»: дата закупки каждой группы и сколько ссылок в ней
 * на каждый сайт (по домену, без www).
 */
export function groupDatesAndLinks(db: Db): Map<number, { date: string; links: Record<string, number> }> {
  const groups = db.prepare('SELECT id, name, created_at, fixed_at FROM site_groups').all() as { id: number; name: string; created_at: number; fixed_at: number | null }[];
  const out = new Map(groups.map((g) => [g.id, { date: purchaseDate(g), links: {} as Record<string, number> }]));
  const rows = db.prepare('SELECT group_id, site_url, SUM(qty) AS n FROM site_group_items GROUP BY group_id, site_url').all() as { group_id: number; site_url: string; n: number }[];
  for (const r of rows) {
    const g = out.get(r.group_id);
    const h = hostOf(r.site_url);
    if (g && h) g.links[h] = (g.links[h] ?? 0) + r.n;
  }
  return out;
}
