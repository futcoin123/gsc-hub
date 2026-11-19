import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { mapKeyRows } from '$lib/server/map-keys';
import { reportPeriod } from '$lib/server/report-period';

/** Строки раздела «Ключи карты»: карта + позиции Google за период из шапки и прошлый отрезок + закупки. */
export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  try {
    return json(await mapKeyRows(db(), reportPeriod(db())));
  } catch (e) {
    throw error(502, (e as Error).message.slice(0, 200));
  }
};
