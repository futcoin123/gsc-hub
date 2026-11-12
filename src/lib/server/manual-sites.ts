// Раздел «Без консоли»: свои сайты, которых нет в Search Console.
// Домены вписываются руками, закупки идут кампаниями по датам, ключи и
// страницы — тоже руками. Кампанию фиксируют, когда ссылки куплены: из
// зафиксированных складывается история «что и когда куплено».
// С группами сайтов консолей (site_groups) таблицы не пересекаются.
import type { Db } from './db';
import { parseHostList, normalizeHost } from './site-groups';
import { csvCell } from './group-items';
import { localToday } from './gsc-calendar';
import { sitePageUrl, cleanAnchor } from '$lib/utils/url-filters';
import { nakedQuery, nakedAnchor, nakedVariant, NAKED_LABEL, type NakedVariant } from '$lib/utils/naked';

export const QTY_MAX = 1000;
const NAME_MAX = 60;

export interface ManualSite {
  host: string;
  addedAt: number;
  /** Ссылок куплено (в зафиксированных кампаниях). */
  bought: number;
  /** Ссылок в незафиксированных кампаниях. */
  planned: number;
  /** Дата последней зафиксированной кампании с этим сайтом, YYYY-MM-DD. */
  lastDate: string | null;
}

export interface ManualCampaign {
  id: number;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  createdAt: number;
  fixedAt: number | null;
  /** Строк (связок) и ссылок всего. */
  rows: number;
  links: number;
}

export interface ManualLink {
  id: number;
  campaignId: number;
  host: string;
  page: string;
  /** Ключ; у безанкорной — '' (полный адрес) или '[домен]'. */
  anchor: string;
  kind: 'anchor' | 'naked';
  qty: number;
  addedAt: number;
}

export interface HistoryLink extends ManualLink {
  campaignName: string;
  date: string;
  fixedAt: number | null;
}

const cleanQty = (v: unknown): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1) throw new Error('Впишите, сколько ссылок (шт)');
  return Math.min(n, QTY_MAX);
};

// ─── Сайты ────────────────────────────────────────────────────────────────

export function listManualSites(db: Db): ManualSite[] {
  return (
    db
      .prepare(
        `SELECT s.host, s.added_at,
                COALESCE((SELECT SUM(l.qty) FROM manual_links l JOIN manual_campaigns c ON c.id = l.campaign_id
                           WHERE l.host = s.host AND c.fixed_at IS NOT NULL), 0) AS bought,
                COALESCE((SELECT SUM(l.qty) FROM manual_links l JOIN manual_campaigns c ON c.id = l.campaign_id
                           WHERE l.host = s.host AND c.fixed_at IS NULL), 0) AS planned,
                (SELECT MAX(c.date) FROM manual_links l JOIN manual_campaigns c ON c.id = l.campaign_id
                  WHERE l.host = s.host AND c.fixed_at IS NOT NULL) AS last_date
           FROM manual_sites s ORDER BY s.host`
      )
      .all() as { host: string; added_at: number; bought: number; planned: number; last_date: string | null }[]
  ).map((r) => ({ host: r.host, addedAt: r.added_at, bought: r.bought, planned: r.planned, lastDate: r.last_date }));
}

/** Список доменов текстом: по строке, запятой или пробелу. */
export function addManualSites(db: Db, text: string, now = Date.now()): { added: string[]; existed: string[]; rejected: string[] } {
  const { hosts, rejected } = parseHostList(text);
  const added: string[] = [];
  const existed: string[] = [];
  const ins = db.prepare('INSERT OR IGNORE INTO manual_sites (host, added_at) VALUES (?, ?)');
  db.transaction(() => {
    for (const h of hosts) (ins.run(h, now).changes ? added : existed).push(h);
  })();
  return { added, existed, rejected };
}

/** Убрать сайт из списка можно, только пока на него нет ссылок ни в одной кампании. */
export function removeManualSite(db: Db, host: string): void {
  const h = normalizeHost(host);
  if (!h) throw new Error('Нет такого сайта');
  const n = (db.prepare('SELECT COUNT(*) AS n FROM manual_links WHERE host = ?').get(h) as { n: number }).n;
  if (n) throw new Error(`У ${h} есть ссылки в кампаниях (${n} строк) — история закупок хранится. Сначала уберите их из кампаний`);
  db.prepare('DELETE FROM manual_sites WHERE host = ?').run(h);
}

// ─── Кампании ─────────────────────────────────────────────────────────────

/** 2026-11-12 → 12-11-26 — как названия групп-закупок. */
export function campaignNameFor(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}-${m}-${y.slice(2)}`;
}

function cleanDate(v: string): string {
  const s = v.trim();
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new Error('Укажите дату кампании');
  }
  return s;
}

export function todayDate(now = Date.now()): string {
  return localToday(now);
}

export function listCampaigns(db: Db): ManualCampaign[] {
  return (
    db
      .prepare(
        `SELECT c.*, COUNT(l.id) AS rows_n, COALESCE(SUM(l.qty), 0) AS links_n
           FROM manual_campaigns c LEFT JOIN manual_links l ON l.campaign_id = c.id
          GROUP BY c.id ORDER BY c.date DESC, c.id DESC`
      )
      .all() as { id: number; name: string; date: string; created_at: number; fixed_at: number | null; rows_n: number; links_n: number }[]
  ).map((r) => ({ id: r.id, name: r.name, date: r.date, createdAt: r.created_at, fixedAt: r.fixed_at, rows: r.rows_n, links: r.links_n }));
}

export function getCampaign(db: Db, id: number): ManualCampaign | undefined {
  return listCampaigns(db).find((c) => c.id === id);
}

/** Новая кампания на дату; без названия — дата («12-11-26»). */
export function createCampaign(db: Db, date: string, name = '', now = Date.now()): number {
  const d = cleanDate(date);
  const n = name.replace(/\s+/g, ' ').trim() || campaignNameFor(d);
  if (n.length > NAME_MAX) throw new Error(`Название длиннее ${NAME_MAX} символов`);
  const key = n.toLocaleLowerCase('ru');
  const taken = (db.prepare('SELECT name FROM manual_campaigns').all() as { name: string }[]).some((r) => r.name.toLocaleLowerCase('ru') === key);
  if (taken) throw new Error(`Кампания «${n}» уже есть — выберите её в списке или впишите другое название`);
  return Number(db.prepare('INSERT INTO manual_campaigns (name, date, created_at) VALUES (?, ?, ?)').run(n, d, now).lastInsertRowid);
}

function requireOpen(db: Db, id: number): void {
  const c = db.prepare('SELECT fixed_at FROM manual_campaigns WHERE id = ?').get(id) as { fixed_at: number | null } | undefined;
  if (!c) throw new Error('Кампания не найдена');
  if (c.fixed_at) throw new Error('Кампания зафиксирована: сначала откройте её для правок');
}

/** Зафиксировать (куплено) или снова открыть для правок. */
export function setCampaignFixed(db: Db, id: number, fixed: boolean, now = Date.now()): void {
  if (!db.prepare('SELECT 1 FROM manual_campaigns WHERE id = ?').get(id)) throw new Error('Кампания не найдена');
  if (fixed && !(db.prepare('SELECT 1 FROM manual_links WHERE campaign_id = ?').get(id))) throw new Error('В кампании нет ссылок');
  db.prepare('UPDATE manual_campaigns SET fixed_at = ? WHERE id = ?').run(fixed ? now : null, id);
}

/** Удалить можно только незафиксированную: купленное остаётся в истории. */
export function deleteCampaign(db: Db, id: number): void {
  requireOpen(db, id);
  db.prepare('DELETE FROM manual_campaigns WHERE id = ?').run(id);
}

// ─── Ссылки ───────────────────────────────────────────────────────────────

const toLink = (r: Record<string, unknown>): ManualLink => ({
  id: r.id as number,
  campaignId: r.campaign_id as number,
  host: r.host as string,
  page: r.page as string,
  anchor: r.anchor as string,
  kind: r.kind === 'naked' ? 'naked' : 'anchor',
  qty: r.qty as number,
  addedAt: r.added_at as number
});

export function listLinks(db: Db, campaignId: number): ManualLink[] {
  return (db.prepare('SELECT * FROM manual_links WHERE campaign_id = ? ORDER BY host, kind, id').all(campaignId) as Record<string, unknown>[]).map(toLink);
}

export interface NewLink {
  host: string;
  page: string;
  /** Для анкорной — ключ; для безанкорной не нужен. */
  anchor?: string;
  /** 'anchor' или вид безанкорной ссылки. */
  type: 'anchor' | NakedVariant;
  qty: number;
}

/**
 * Связка в кампанию. Уже есть та же страница с тем же анкором — ставит новое
 * количество и возвращает прежнее; новая — prev = null.
 */
export function addLink(db: Db, campaignId: number, l: NewLink, now = Date.now()): { prev: number | null } {
  requireOpen(db, campaignId);
  const host = normalizeHost(l.host);
  if (!host || !db.prepare('SELECT 1 FROM manual_sites WHERE host = ?').get(host)) throw new Error('Выберите сайт из списка «Сайты без консоли»');
  const page = sitePageUrl(l.page, `https://${host}/`);
  const naked = l.type === 'url' || l.type === 'domain';
  const anchor = naked ? nakedQuery(l.type as NakedVariant) : cleanAnchor(l.anchor ?? '');
  const qty = cleanQty(l.qty);
  const old = db.prepare('SELECT qty FROM manual_links WHERE campaign_id = ? AND page = ? AND anchor = ?').get(campaignId, page, anchor) as { qty: number } | undefined;
  db.prepare(
    `INSERT INTO manual_links (campaign_id, host, page, anchor, kind, qty, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (campaign_id, page, anchor) DO UPDATE SET qty = excluded.qty`
  ).run(campaignId, host, page, anchor, naked ? 'naked' : 'anchor', qty, now);
  return { prev: old?.qty ?? null };
}

export function setLinkQty(db: Db, campaignId: number, linkId: number, qty: number): void {
  requireOpen(db, campaignId);
  db.prepare('UPDATE manual_links SET qty = ? WHERE campaign_id = ? AND id = ?').run(cleanQty(qty), campaignId, linkId);
}

export function removeLink(db: Db, campaignId: number, linkId: number): void {
  requireOpen(db, campaignId);
  db.prepare('DELETE FROM manual_links WHERE campaign_id = ? AND id = ?').run(campaignId, linkId);
}

/** Все ссылки всех кампаний, новые сверху: дата кампании, затем сайт. */
export function linkHistory(db: Db): HistoryLink[] {
  return (
    db
      .prepare(
        `SELECT l.*, c.name AS campaign_name, c.date AS campaign_date, c.fixed_at AS campaign_fixed
           FROM manual_links l JOIN manual_campaigns c ON c.id = l.campaign_id
          ORDER BY c.date DESC, c.id DESC, l.host, l.kind, l.id`
      )
      .all() as Record<string, unknown>[]
  ).map((r) => ({ ...toLink(r), campaignName: r.campaign_name as string, date: r.campaign_date as string, fixedAt: r.campaign_fixed as number | null }));
}

/** Текст ссылки, как его ставить. */
export const linkText = (l: Pick<ManualLink, 'kind' | 'page' | 'anchor'>) => (l.kind === 'naked' ? nakedAnchor(l.page, l.anchor) : l.anchor);
export const linkKind = (l: Pick<ManualLink, 'kind' | 'anchor'>) => (l.kind === 'naked' ? NAKED_LABEL[nakedVariant(l.anchor)] : 'Анкор');

/** ТЗ кампании для биржи ссылок — как CSV групп: «;», BOM для Excel. */
export function campaignCsv(
  c: Pick<ManualCampaign, 'name' | 'date'>,
  links: ManualLink[],
  locale: Record<string, { language: string | null; geo: string }> = {}
): string {
  const head = ['Кампания', 'Дата', 'Сайт', 'Тип', 'Страница', 'Анкор', 'Кол-во ссылок', 'Язык', 'Гео'];
  const lines = links.map((l) =>
    [c.name, c.date, l.host, linkKind(l), l.page, linkText(l), l.qty, locale[l.page]?.language ?? '', locale[l.page]?.geo ?? ''].map(csvCell).join(';')
  );
  return '﻿' + [head.join(';'), ...lines].join('\r\n') + '\r\n';
}
