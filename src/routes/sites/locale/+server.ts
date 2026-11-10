import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { localesFor, siteSections } from '$lib/server/site-locale';
import { siteHref } from '$lib/utils/site';

/**
 * Язык и гео для колонок «Язык» и «Гео».
 *   { pages: [url…] } — по страницам (ТЗ группы): url → { language, geo };
 *   { sites: [siteUrl…] } — по сайтам (Ключи сайтов): siteUrl → { languages, geos }
 *     (у сайта с языковыми папками — все его языки и страны).
 * Сайт, которого хаб ещё не спрашивал, проверяется сейчас; потом — раз в неделю.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => null)) as { pages?: unknown; sites?: unknown } | null;
  if (!body) throw error(400, 'нужен JSON');
  const pages = Array.isArray(body.pages) ? body.pages.filter((x): x is string => typeof x === 'string').slice(0, 2000) : [];
  const sites = Array.isArray(body.sites) ? body.sites.filter((x): x is string => typeof x === 'string').slice(0, 500) : [];

  const sectionsBySite = new Map(sites.map((s) => [s, siteSections(db(), siteHref(s))]));
  const all = await localesFor(db(), [...pages, ...[...sectionsBySite.values()].flat()]);

  const bySite: Record<string, { languages: string[]; geos: string[] }> = {};
  for (const [s, secs] of sectionsBySite) {
    const ls = secs.map((x) => all[x]).filter(Boolean);
    bySite[s] = {
      languages: [...new Set(ls.map((l) => l.language).filter((x): x is string => !!x))],
      geos: [...new Set(ls.map((l) => l.geo))]
    };
  }
  return json({ pages: Object.fromEntries(pages.map((p) => [p, all[p]])), sites: bySite });
};
