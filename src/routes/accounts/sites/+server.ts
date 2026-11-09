import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { listAccounts, isUsableAccount } from '$lib/server/accounts';
import { listSitesForAccount, type SiteRow } from '$lib/server/google';
import { requireAdmin } from '$lib/server/guard';
import { gscCacheInvalidate } from '$lib/server/gsc-cache';

// Сайты консолей на странице Accounts: сколько их и какие ещё не подтверждены.
// Список сайтов хаб держит в памяти час; кнопка «Обновить сайты» сбрасывает
// эту память и спрашивает Google заново — новые сайты видны сразу везде.

const brief = (sites: SiteRow[]) => ({
  total: sites.length,
  unverified: sites.filter((s) => s.permissionLevel === 'siteUnverifiedUser').map((s) => s.siteUrl)
});

/** Сводка по всем консолям: { [id]: { total, unverified } | { error } }. */
export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  const accounts = listAccounts(db()).filter(isUsableAccount);
  const out: Record<string, { total: number; unverified: string[] } | { error: string }> = {};
  await Promise.all(
    accounts.map(async (a) => {
      try {
        out[a.id] = brief(await listSitesForAccount(db(), a));
      } catch (e) {
        out[a.id] = { error: (e as Error).message.slice(0, 200) };
      }
    })
  );
  return json(out);
};

/** { id } — заново забрать сайты консоли; { } — всех консолей. Отвечает, что добавилось. */
export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  const all = listAccounts(db()).filter(isUsableAccount);
  const accounts = typeof body.id === 'string' ? all.filter((a) => a.id === body.id) : all;
  if (typeof body.id === 'string' && !accounts.length) throw error(404, 'консоль не найдена');

  // Что хаб знал до обновления (из памяти; если памяти нет — спросит Google).
  const before = new Map<string, Set<string>>();
  await Promise.all(
    accounts.map(async (a) => {
      try {
        before.set(a.id, new Set((await listSitesForAccount(db(), a)).map((s) => s.siteUrl)));
      } catch {
        before.set(a.id, new Set());
      }
    })
  );
  // Сбрасываем всю память Search Console: у новых сайтов должны появиться и цифры.
  gscCacheInvalidate();

  const out: Record<string, { total: number; unverified: string[]; added: string[] } | { error: string }> = {};
  await Promise.all(
    accounts.map(async (a) => {
      try {
        const sites = await listSitesForAccount(db(), a);
        const was = before.get(a.id) ?? new Set();
        out[a.id] = { ...brief(sites), added: sites.map((s) => s.siteUrl).filter((u) => !was.has(u)) };
      } catch (e) {
        out[a.id] = { error: (e as Error).message.slice(0, 200) };
      }
    })
  );
  return json(out);
};
