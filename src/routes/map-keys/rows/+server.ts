import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { mapKeyRows } from '$lib/server/map-keys';

/** Строки раздела «Ключи карты»: карта + позиции Google + закупки. */
export const GET: RequestHandler = async ({ locals }) => {
  requireAdmin(locals);
  try {
    return json(await mapKeyRows(db()));
  } catch (e) {
    throw error(502, (e as Error).message.slice(0, 200));
  }
};
