import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { getSiteGroup } from '$lib/server/site-groups';
import { listGroupItems, groupItemsCsv } from '$lib/server/group-items';
import { localesFor } from '$lib/server/site-locale';

export const GET: RequestHandler = async ({ params, locals }) => {
  requireAdmin(locals);
  const g = getSiteGroup(db(), Number(params.id));
  if (!g) throw error(404, 'группа не найдена');
  const name = `${g.name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.csv`;
  const items = listGroupItems(db(), g.id);
  // Язык и гео каждой страницы — для биржи ссылок (названия как в её списках).
  const locale = await localesFor(db(), [...new Set(items.map((i) => i.page))]).catch(() => ({}));
  return new Response(groupItemsCsv(g.name, items, locale), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="group.csv"; filename*=UTF-8''${encodeURIComponent(name)}`
    }
  });
};
