import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { setSiteLabel, siteLabels } from '$lib/server/site-labels';

/** { site, label } — поставить метку сайту (пустая — снять). Ответ — все метки. */
export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => null)) as { site?: unknown; label?: unknown } | null;
  if (!body || typeof body.site !== 'string' || !body.site.trim()) throw error(400, 'нужно { site, label }');
  try {
    setSiteLabel(db(), body.site, body.label);
  } catch (e) {
    throw error(400, (e as Error).message);
  }
  return json({ ok: true, labels: siteLabels(db()) });
};
