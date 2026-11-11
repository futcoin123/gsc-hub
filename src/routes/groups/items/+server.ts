import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { gscCacheInvalidate } from '$lib/server/gsc-cache';
import {
  listSiteGroups,
  createSiteGroup,
  setSiteGroupHosts,
  setActiveSiteGroup,
  setHostDone,
  getSiteGroup,
  normalizeHost
} from '$lib/server/site-groups';
import { groupDatesAndLinks } from '$lib/server/link-purchases';
import { addGroupItem, removeGroupItem, itemMarks, todayGroupName, setItemQty, addNakedItem, siteHistory, removeGroupItemById, setItemQtyById, type NewItem } from '$lib/server/group-items';

const summaries = () => {
  // Дата закупки и ссылки по сайтам — чтобы у сайта было видно прошлые закупки.
  const extra = groupDatesAndLinks(db());
  return listSiteGroups(db()).map((g) => ({
    id: g.id,
    name: g.name,
    active: g.active,
    fixedAt: g.fixedAt,
    items: g.items,
    hosts: g.hosts,
    done: g.done,
    date: extra.get(g.id)?.date ?? null,
    links: extra.get(g.id)?.links ?? {}
  }));
};

/** Группы и пометки для колонки «В группу» в Striking Distance. ?site= — по одному сайту. */
export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const site = url.searchParams.get('site') || undefined;
  return json({
    groups: summaries(),
    marks: itemMarks(db(), site),
    today: todayGroupName(),
    // История ссылок по сайту: что и когда отбиралось во всех группах.
    history: site ? siteHistory(db(), site) : []
  });
};

/**
 *   { action: 'add',    groupId, item }               — ключ в группу
 *   { action: 'remove', groupId, page, query }        — убрать ключ
 *   { action: 'done',   groupId, host, done }         — сайт пройден / не пройден
 *   { action: 'today',  site }                        — новая группа на сегодня с этим сайтом, выбрать её
 *   { action: 'host',   groupId, site, on }           — добавить сайт в группу / убрать (страница Sites)
 *   { action: 'qtyById', groupId, itemId, qty }     — количество у строки группы по id
 *   { action: 'removeById', groupId, itemId }       — убрать строку группы по id
 *   { action: 'qty',    groupId, page, query, qty }   — сколько ссылок на связку
 *   { action: 'naked',  groupId, site, page, qty, variant? } — безанкорные ссылки на страницу ('url' | 'domain')
 *   { action: 'create', name? }                       — новая группа (по умолчанию сегодняшняя дата)
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) throw error(400, 'нужен JSON');
  try {
    if (body.action === 'today') {
      const host = normalizeHost(String(body.site ?? ''));
      const name = todayGroupName();
      const existing = listSiteGroups(db()).find((g) => g.name === name);
      const id = existing?.id ?? createSiteGroup(db(), name);
      const hosts = getSiteGroup(db(), id)!.hosts;
      if (host && !hosts.includes(host)) setSiteGroupHosts(db(), id, [...hosts, host]);
      setActiveSiteGroup(db(), id);
      gscCacheInvalidate('portfolio:');
      return json({ ok: true, id, groups: summaries() });
    }
    if (body.action === 'create') {
      const name = typeof body.name === 'string' && body.name.trim() ? body.name : todayGroupName();
      const id = createSiteGroup(db(), name);
      return json({ ok: true, id, groups: summaries() });
    }
    const groupId = Number(body.groupId);
    if (!Number.isInteger(groupId) || groupId < 1) throw new Error('Не выбрана группа');
    if (body.action === 'add') addGroupItem(db(), groupId, (body.item ?? {}) as NewItem);
    else if (body.action === 'remove') removeGroupItem(db(), groupId, String(body.page ?? ''), String(body.query ?? ''));
    else if (body.action === 'qtyById') setItemQtyById(db(), groupId, Number(body.itemId), Number(body.qty));
    else if (body.action === 'removeById') removeGroupItemById(db(), groupId, Number(body.itemId));
    else if (body.action === 'qty') setItemQty(db(), groupId, String(body.page ?? ''), String(body.query ?? ''), Number(body.qty));
    else if (body.action === 'naked') addNakedItem(db(), groupId, String(body.site ?? ''), String(body.page ?? ''), Number(body.qty), body.variant === 'domain' ? 'domain' : 'url');
    else if (body.action === 'host') {
      const g = getSiteGroup(db(), groupId);
      const host = normalizeHost(String(body.site ?? ''));
      if (!g || !host) throw new Error('Нет группы или сайта');
      const next = body.on === true ? [...g.hosts, host] : g.hosts.filter((h) => h !== host);
      setSiteGroupHosts(db(), groupId, next);
      gscCacheInvalidate('portfolio:');
    } else if (body.action === 'done') setHostDone(db(), groupId, String(body.host ?? ''), body.done === true);
    else throw new Error('неизвестное действие');
    return json({ ok: true, groups: summaries() });
  } catch (e) {
    throw error(400, (e as Error).message);
  }
};
