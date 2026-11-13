import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { listGroupPurchases } from '$lib/server/link-purchases';
import { purchaseEffect } from '$lib/server/purchase-effect';
import { reportPeriod } from '$lib/server/report-period';

/** До / после одной закупки: ?g=<id группы>. «После» — за период из шапки. */
export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const id = Number(url.searchParams.get('g'));
  const p = listGroupPurchases(db()).find((x) => x.groupId === id);
  if (!p) throw error(404, 'закупка не найдена');
  try {
    return json(await purchaseEffect(db(), p, Date.now(), reportPeriod(db())));
  } catch (e) {
    throw error(502, (e as Error).message.slice(0, 200));
  }
};
