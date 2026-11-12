import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { getCampaign, listLinks, campaignCsv } from '$lib/server/manual-sites';
import { localesFor } from '$lib/server/site-locale';

/** ТЗ кампании «Без консоли» для биржи ссылок — CSV, как у групп. */
export const GET: RequestHandler = async ({ params, locals }) => {
  requireAdmin(locals);
  const c = getCampaign(db(), Number(params.id));
  if (!c) throw error(404, 'кампания не найдена');
  const links = listLinks(db(), c.id);
  const locale = await localesFor(db(), [...new Set(links.map((l) => l.page))]).catch(() => ({}));
  const name = `${c.name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.csv`;
  return new Response(campaignCsv(c, links, locale), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="campaign.csv"; filename*=UTF-8''${encodeURIComponent(name)}`
    }
  });
};
