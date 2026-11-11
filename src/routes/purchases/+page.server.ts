import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { listGroupPurchases, itemsLabel } from '$lib/server/link-purchases';
import { siteHostname } from '$lib/utils/url-filters';

// «Закупки»: все закупки ссылок из групп, новые сверху. Цифры «до / после»
// страница запрашивает по каждой закупке отдельно (/purchases/effect).
export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  const purchases = listGroupPurchases(db()).map((p) => {
    const sites = [...new Set(p.items.map((i) => i.siteUrl))];
    return {
      groupId: p.groupId,
      name: p.name,
      date: p.date,
      fixed: p.fixed,
      links: p.items.reduce((a, i) => a + i.qty, 0),
      sites: sites.map((s) => {
        let host = s;
        try {
          host = siteHostname(s);
        } catch {
          /* как есть */
        }
        const items = p.items.filter((i) => i.siteUrl === s);
        return { siteUrl: s, host, links: items.reduce((a, i) => a + i.qty, 0), what: itemsLabel(items) };
      })
    };
  });
  return { purchases };
};
