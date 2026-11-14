import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { fetchQueryOwners, fetchSiteGeos } from '$lib/server/google';
import { sameGeo } from '$lib/utils/site-geo';
import { linksByQuery } from '$lib/server/group-items';
import { foldQuery, hostKey } from '$lib/utils/fold-query';
import { OWNERS_DAYS } from '$lib/utils/owners';

/**
 * Колонка «Мои другие сайты»: { site, queries[] } → по каждому ключу другие
 * ваши сайты с показами по нему и ссылки, уже отобранные на них в группах.
 * ?links=1 — только ссылки, без запросов в Google (быстро).
 * Только сайты той же страны: сайты из разных регионов по одному ключу не конкуренты.
 */
async function geos(): Promise<Map<string, string[]> | null> {
  try {
    return await fetchSiteGeos(db());
  } catch {
    return null;
  }
}

export const POST: RequestHandler = async ({ request, url, locals }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => null)) as { site?: unknown; queries?: unknown; pairs?: unknown } | null;
  // Вариант для страницы группы: { pairs: [{ site, query }] } — у каждого ключа свой сайт.
  if (body && Array.isArray(body.pairs)) {
    const pairs = body.pairs
      .filter((x): x is { site: string; query: string } => !!x && typeof x.site === 'string' && typeof x.query === 'string')
      .slice(0, 5000);
    const links = linksByQuery(db());
    const owners = url.searchParams.get('links') === '1' ? null : await fetchQueryOwners(db(), OWNERS_DAYS);
    const geo = await geos();
    const out: Record<string, { owners: unknown[]; links: unknown[] }> = {};
    for (const p of pairs) {
      const me = hostKey(p.site);
      const k = foldQuery(p.query);
      const near = (h: string) => h !== me && sameGeo(geo?.get(me), geo?.get(h));
      const o = (owners?.get(k) ?? []).filter((x) => near(x.host));
      const l = (links.get(k) ?? []).filter((x) => near(x.host));
      if (o.length || l.length) out[`${p.site}\n${p.query}`] = { owners: o, links: l };
    }
    return json({ byPair: out, ownersLoaded: owners !== null });
  }
  if (!body || typeof body.site !== 'string' || !Array.isArray(body.queries)) throw error(400, 'нужно { site, queries }');
  const me = hostKey(body.site);
  const queries = body.queries.filter((q): q is string => typeof q === 'string').slice(0, 5000);
  const links = linksByQuery(db());
  const owners = url.searchParams.get('links') === '1' ? null : await fetchQueryOwners(db(), OWNERS_DAYS);
  const geo = await geos();
  const near = (h: string) => h !== me && sameGeo(geo?.get(me), geo?.get(h));
  const out: Record<string, { owners: unknown[]; links: unknown[] }> = {};
  for (const q of queries) {
    const k = foldQuery(q);
    const o = (owners?.get(k) ?? []).filter((x) => near(x.host));
    const l = (links.get(k) ?? []).filter((x) => near(x.host));
    if (o.length || l.length) out[q] = { owners: o, links: l };
  }
  return json({ byQuery: out, ownersLoaded: owners !== null });
};
