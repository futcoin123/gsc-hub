import { foldQuery, hostKey } from '$lib/utils/fold-query';
import type { Db } from './db';
import { nakedQuery, nakedAnchor, nakedVariant, NAKED_LABEL, type NakedVariant } from '$lib/utils/naked';

// Ключи группы: связки «страница + ключ», отобранные в Striking Distance.
// Группа с датой в названии («28-10-26») — это закупка ссылок.

export interface GroupItem {
  id: number;
  groupId: number;
  siteUrl: string;
  query: string;
  page: string;
  position: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  addedAt: number;
  /** Сколько ссылок ставить. */
  qty: number;
  /** anchor — анкор = ключ; naked — безанкорная ссылка на страницу. */
  kind: 'anchor' | 'naked';
}

export const QTY_MAX = 1000;

function cleanQty(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, QTY_MAX);
}

export interface NewItem {
  siteUrl: string;
  query: string;
  page: string;
  position?: number | null;
  impressions?: number | null;
  clicks?: number | null;
  ctr?: number | null;
  qty?: number;
}

/** Сегодняшняя дата для названия группы-закупки: 28-10-26. */
export function todayGroupName(now = new Date()): string {
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${String(now.getFullYear()).slice(2)}`;
}

function requireOpen(db: Db, groupId: number): void {
  const g = db.prepare('SELECT fixed_at FROM site_groups WHERE id = ?').get(groupId) as
    | { fixed_at: number | null }
    | undefined;
  if (!g) throw new Error('Группа не найдена');
  if (g.fixed_at) throw new Error('Группа зафиксирована: сначала откройте её для правок');
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function addGroupItem(db: Db, groupId: number, item: NewItem): void {
  requireOpen(db, groupId);
  if (!item.query?.trim() || !item.page?.trim() || !item.siteUrl?.trim()) throw new Error('Нужны сайт, ключ и страница');
  db.prepare(
    `INSERT INTO site_group_items (group_id, site_url, query, page, position, impressions, clicks, ctr, added_at, qty, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'anchor') ON CONFLICT (group_id, page, query) DO NOTHING`
  ).run(groupId, item.siteUrl, item.query, item.page, num(item.position), num(item.impressions), num(item.clicks), num(item.ctr), Date.now(), cleanQty(item.qty ?? 1));
}

/**
 * Безанкорные ссылки на страницу сайта: текстом ссылки — полный адрес ('url')
 * или просто адрес без https:// ('domain'). Повторное добавление той же
 * страницы того же вида прибавляет количество.
 */
export function addNakedItem(db: Db, groupId: number, siteUrl: string, page: string, qty: number, variant: NakedVariant = 'url'): void {
  requireOpen(db, groupId);
  let url: URL;
  try {
    url = new URL(page.trim());
  } catch {
    throw new Error('Страница должна быть полным адресом: https://…');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Страница должна начинаться с https://');
  if (!siteUrl.trim()) throw new Error('Нужен сайт');
  db.prepare(
    `INSERT INTO site_group_items (group_id, site_url, query, page, added_at, qty, kind)
     VALUES (?, ?, ?, ?, ?, ?, 'naked')
     ON CONFLICT (group_id, page, query) DO UPDATE SET qty = MIN(qty + excluded.qty, ${QTY_MAX})`
  ).run(groupId, siteUrl, nakedQuery(variant), url.href, Date.now(), cleanQty(qty));
}

/** Изменить количество ссылок у связки. */
export function setItemQty(db: Db, groupId: number, page: string, query: string, qty: number): void {
  requireOpen(db, groupId);
  db.prepare('UPDATE site_group_items SET qty = ? WHERE group_id = ? AND page = ? AND query = ?').run(cleanQty(qty), groupId, page, query);
}

export function setItemQtyById(db: Db, groupId: number, itemId: number, qty: number): void {
  requireOpen(db, groupId);
  db.prepare('UPDATE site_group_items SET qty = ? WHERE group_id = ? AND id = ?').run(cleanQty(qty), groupId, itemId);
}

/** История по сайту: все ссылки из всех групп, новые сверху. */
export function siteHistory(db: Db, siteUrl: string): (GroupItem & { groupName: string; fixedAt: number | null })[] {
  const rows = db
    .prepare(
      `SELECT i.*, g.name AS group_name, g.fixed_at AS group_fixed FROM site_group_items i
         JOIN site_groups g ON g.id = i.group_id
        WHERE i.site_url = ? ORDER BY g.created_at DESC, g.id DESC, i.kind, i.impressions DESC`
    )
    .all(siteUrl) as Record<string, unknown>[];
  return rows.map((r) => ({ ...toItem(r), groupName: r.group_name as string, fixedAt: r.group_fixed as number | null }));
}

export function removeGroupItem(db: Db, groupId: number, page: string, query: string): void {
  requireOpen(db, groupId);
  db.prepare('DELETE FROM site_group_items WHERE group_id = ? AND page = ? AND query = ?').run(groupId, page, query);
}

export function removeGroupItemById(db: Db, groupId: number, itemId: number): void {
  requireOpen(db, groupId);
  db.prepare('DELETE FROM site_group_items WHERE group_id = ? AND id = ?').run(groupId, itemId);
}

/**
 * Строки группы. order: 'site' — по сайтам (для CSV исполнителю),
 * 'recent' — новые сверху (страница группы: видно, что добавилось).
 */
export function listGroupItems(db: Db, groupId: number, order: 'site' | 'recent' = 'site'): GroupItem[] {
  const by = order === 'recent' ? 'added_at DESC, id DESC' : 'site_url, kind, impressions DESC, query';
  const rows = db.prepare(`SELECT * FROM site_group_items WHERE group_id = ? ORDER BY ${by}`).all(groupId) as Record<string, unknown>[];
  return rows.map(toItem);
}

function toItem(r: Record<string, unknown>): GroupItem {
  return {
    id: r.id as number,
    groupId: r.group_id as number,
    siteUrl: r.site_url as string,
    query: r.query as string,
    page: r.page as string,
    position: r.position as number | null,
    impressions: r.impressions as number | null,
    clicks: r.clicks as number | null,
    ctr: r.ctr as number | null,
    addedAt: r.added_at as number,
    qty: (r.qty as number) ?? 1,
    kind: r.kind === 'naked' ? 'naked' : 'anchor'
  };
}

/** Зафиксировать (true) или снова открыть (false). */
export function setGroupFixed(db: Db, groupId: number, fixed: boolean): void {
  db.prepare('UPDATE site_groups SET fixed_at = ? WHERE id = ?').run(fixed ? Date.now() : null, groupId);
}

/**
 * Пометки для таблиц: «страница\nключ» → группы, где связка уже есть
 * (от старых к новым). С siteUrl — только по одному сайту.
 */
export function itemMarks(
  db: Db,
  siteUrl?: string
): Record<string, { groupId: number; name: string; qty: number; at: number }[]> {
  const sql = `SELECT i.page, i.query, i.qty, g.id, g.name, COALESCE(g.fixed_at, g.created_at) AS at FROM site_group_items i JOIN site_groups g ON g.id = i.group_id
     ${siteUrl ? 'WHERE i.site_url = ?' : ''} ORDER BY g.created_at, g.id`;
  const rows = (siteUrl ? db.prepare(sql).all(siteUrl) : db.prepare(sql).all()) as {
    page: string;
    query: string;
    id: number;
    name: string;
    qty: number;
    at: number;
  }[];
  // at — когда закупка оформлена (зафиксирована), иначе когда создана.
  const out: Record<string, { groupId: number; name: string; qty: number; at: number }[]> = {};
  for (const r of rows) (out[`${r.page}\n${r.query}`] ??= []).push({ groupId: r.id, name: r.name, qty: r.qty, at: r.at });
  return out;
}

const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  // Формулы в Excel не исполняем: ячейки с = + - @ начинаем с апострофа.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/**
 * CSV для Excel: разделитель «;» и BOM, чтобы кириллица открывалась без кракозябр.
 * locale — язык и гео страницы (названия как на бирже ссылок); без него колонки пустые.
 */
export function groupItemsCsv(
  groupName: string,
  items: GroupItem[],
  locale: Record<string, { language: string | null; geo: string }> = {}
): string {
  const head = ['Группа', 'Сайт', 'Язык', 'Гео', 'Тип', 'Страница', 'Анкор', 'Кол-во ссылок', 'Позиция', 'Показы', 'Клики', 'CTR %'];
  const lines = items.map((i) =>
    [
      groupName,
      i.siteUrl,
      locale[i.page]?.language ?? '',
      locale[i.page]?.geo ?? '',
      i.kind === 'naked' ? NAKED_LABEL[nakedVariant(i.query)] : 'Анкор',
      i.page,
      i.kind === 'naked' ? nakedAnchor(i.page, i.query) : i.query,
      i.qty,
      i.position === null ? '' : i.position.toFixed(1).replace('.', ','),
      i.impressions ?? '',
      i.clicks ?? '',
      i.ctr === null ? '' : (i.ctr * 100).toFixed(1).replace('.', ',')
    ]
      .map(csvCell)
      .join(';')
  );
  return '\uFEFF' + [head.join(';'), ...lines].join('\r\n') + '\r\n';
}

export interface QueryLink {
  host: string;
  groupId: number;
  groupName: string;
  qty: number;
  at: number;
  itemId: number;
  /** Группа зафиксирована — удалять нельзя. */
  fixed: boolean;
}

/** Анкорные ссылки по ключу на всех сайтах: ключ (нормальная форма) → где и сколько. */
export function linksByQuery(db: Db): Map<string, QueryLink[]> {
  const rows = db
    .prepare(
      `SELECT i.id AS item_id, i.site_url, i.query, i.qty, g.id, g.name, g.fixed_at,
              COALESCE(g.fixed_at, g.created_at) AS at
         FROM site_group_items i JOIN site_groups g ON g.id = i.group_id
        WHERE i.kind = 'anchor' ORDER BY g.created_at, g.id`
    )
    .all() as { item_id: number; site_url: string; query: string; qty: number; id: number; name: string; fixed_at: number | null; at: number }[];
  const out = new Map<string, QueryLink[]>();
  for (const r of rows) {
    const k = foldQuery(r.query);
    const list = out.get(k) ?? [];
    list.push({ host: hostKey(r.site_url), groupId: r.id, groupName: r.name, qty: r.qty, at: r.at, itemId: r.item_id, fixed: !!r.fixed_at });
    out.set(k, list);
  }
  return out;
}

export interface Overlap {
  query: string;
  sites: { host: string; qty: number }[];
}

/** Пересечения в группе: один ключ отобран для двух и более сайтов. */
export function groupOverlaps(items: GroupItem[]): Overlap[] {
  const by = new Map<string, { query: string; sites: Map<string, number> }>();
  for (const i of items) {
    if (i.kind !== 'anchor') continue;
    const k = foldQuery(i.query);
    const e = by.get(k) ?? { query: i.query, sites: new Map<string, number>() };
    const h = hostKey(i.siteUrl);
    e.sites.set(h, (e.sites.get(h) ?? 0) + i.qty);
    by.set(k, e);
  }
  return [...by.values()]
    .filter((e) => e.sites.size > 1)
    .map((e) => ({ query: e.query, sites: [...e.sites].map(([host, qty]) => ({ host, qty })).sort((a, b) => b.qty - a.qty) }))
    .sort((a, b) => a.query.localeCompare(b.query));
}
