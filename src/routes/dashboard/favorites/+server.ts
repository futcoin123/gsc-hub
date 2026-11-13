import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { currentUserId, setUserFavorites, userFavorites } from '$lib/server/user-selection';
import { labelKey } from '$lib/utils/site-label';

/**
 * Избранное Dashboard: { site, on } — отметить или снять; { add: [site…] } —
 * добавить разом (перенос звёзд, которые раньше жили в браузере). Ответ — список.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const uid = currentUserId();
  if (!uid) throw error(401, 'нет пользователя');
  const body = (await request.json().catch(() => null)) as { site?: unknown; on?: unknown; add?: unknown } | null;
  if (!body) throw error(400, 'нужен JSON');
  const set = new Set(userFavorites(db(), uid));
  if (Array.isArray(body.add)) for (const s of body.add) if (typeof s === 'string' && labelKey(s)) set.add(labelKey(s));
  if (typeof body.site === 'string' && labelKey(body.site)) {
    if (body.on) set.add(labelKey(body.site));
    else set.delete(labelKey(body.site));
  }
  setUserFavorites(db(), uid, set);
  return json({ favorites: userFavorites(db(), uid) });
};
