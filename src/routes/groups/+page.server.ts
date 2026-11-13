import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { listAllKnownSites } from '$lib/server/google';
import { gscCacheInvalidate } from '$lib/server/gsc-cache';
import {
  listSiteGroups,
  createSiteGroup,
  renameSiteGroup,
  deleteSiteGroup,
  setSiteGroupHosts,
  removeHostFromGroup,
  getSiteGroup,
  parseHostList,
  setHostDone
} from '$lib/server/site-groups';
import { listGroupItems, setGroupFixed, removeGroupItemById, todayGroupName, addNakedItem, setItemQtyById, groupOverlaps } from '$lib/server/group-items';
import { siteHostname } from '$lib/utils/url-filters';
import { getSiteViewSettings } from '$lib/server/site-view-settings';
import { seedSiteLabels, siteLabels } from '$lib/server/site-labels';

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals);
  await seedSiteLabels(db());
  // Все сайты всех консолей, без фильтров: выбирать в группу можно любой.
  const { sites, errors } = await listAllKnownSites(db());
  const byHost = new Map<string, { host: string; accounts: string[]; open: { siteUrl: string; accountId: string }; openRank: number; sources: { siteUrl: string; accountId: string; rank: number }[] }>();
  for (const s of sites) {
    let host: string;
    try {
      host = siteHostname(s.siteUrl);
    } catch {
      continue;
    }
    // Ссылка «Открыть» и «Все ключи сайта» берут лучшую property домена:
    // подтверждённая sc-domain: (весь домен) > подтверждённая https:// > любая.
    // Иначе у сайта с двумя property бралась бы почти пустая.
    const rank = (x: { siteUrl: string; permissionLevel: string }) =>
      (x.permissionLevel === 'siteUnverifiedUser' ? 0 : 2) + (x.siteUrl.startsWith('sc-domain:') ? 1 : 0);
    const row = byHost.get(host) ?? { host, accounts: [], open: { siteUrl: s.siteUrl, accountId: s.accountId }, openRank: -1, sources: [] };
    // Все property домена во всех консолях: «Все ключи сайта» собирает ключи из каждой,
    // иначе данные из другой консоли (или другой property) терялись.
    if (!row.sources.some((x) => x.siteUrl === s.siteUrl && x.accountId === s.accountId))
      row.sources.push({ siteUrl: s.siteUrl, accountId: s.accountId, rank: rank(s) });
    if (rank(s) > row.openRank) {
      row.open = { siteUrl: s.siteUrl, accountId: s.accountId };
      row.openRank = rank(s);
    }
    const who = s.accountLabel || s.accountEmail;
    if (!row.accounts.includes(who)) row.accounts.push(who);
    byHost.set(host, row);
  }
  const groups = listSiteGroups(db());
  const wanted = Number(url.searchParams.get('g'));
  const selected = groups.find((g) => g.id === wanted) ?? groups.find((g) => g.active) ?? groups[0] ?? null;
  return {
    groups,
    selectedId: selected?.id ?? null,
    today: todayGroupName(),
    items: selected ? listGroupItems(db(), selected.id, 'recent') : [],
    overlaps: selected ? groupOverlaps(listGroupItems(db(), selected.id)) : [],
    knownSites: [...byHost.values()].map(({ openRank: _r, sources, ...k }) => ({
        ...k,
        // Период как в Striking этого сайта (он запоминается для каждого сайта).
        days: getSiteViewSettings(db(), k.open.siteUrl).days,
        sources: sources.sort((a, b) => b.rank - a.rank).map(({ rank: _x, ...src }) => src)
      })).sort((a, b) => a.host.localeCompare(b.host)),
    siteErrors: errors.map((e) => ({ account: e.accountEmail, reason: e.reason })),
    labels: siteLabels(db())
  };
};

function groupId(form: FormData): number | null {
  const n = Number(form.get('id'));
  return Number.isInteger(n) && n > 0 ? n : null;
}

function changed() {
  // Портфель кэшируется целиком; состав группы мог поменяться.
  gscCacheInvalidate('portfolio:');
}

export const actions: Actions = {
  fix: async ({ request, locals }) => {
    requireAdmin(locals);
    const id = groupId(await request.formData());
    if (id) setGroupFixed(db(), id, true);
  },
  unfix: async ({ request, locals }) => {
    requireAdmin(locals);
    const id = groupId(await request.formData());
    if (id) setGroupFixed(db(), id, false);
  },
  done: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = groupId(form);
    if (!id) return fail(400, { error: 'Нет группы' });
    try {
      setHostDone(db(), id, String(form.get('host') ?? ''), form.get('done') === '1');
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },
  naked: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = groupId(form);
    if (!id) return fail(400, { error: 'Нет группы' });
    try {
      addNakedItem(db(), id, String(form.get('site') ?? ''), String(form.get('page') ?? ''), Number(form.get('qty')));
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },
  qty: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = groupId(form);
    if (!id) return fail(400, { error: 'Нет группы' });
    try {
      setItemQtyById(db(), id, Number(form.get('item')), Number(form.get('qty')));
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },
  removeItem: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = groupId(form);
    if (!id) return fail(400, { error: 'Нет группы' });
    try {
      removeGroupItemById(db(), id, Number(form.get('item')));
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },
  // Отмеченные галочками строки ТЗ — убрать разом.
  removeItems: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = groupId(form);
    if (!id) return fail(400, { error: 'Нет группы' });
    const items = form.getAll('item').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!items.length) return fail(400, { error: 'Ничего не отмечено' });
    try {
      db().transaction(() => {
        for (const it of items) removeGroupItemById(db(), id, it);
      })();
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    return { removed: items.length };
  },
  create: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    try {
      const id = createSiteGroup(db(), String(form.get('name') ?? ''));
      return { created: id };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },
  rename: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = groupId(form);
    if (!id) return fail(400, { error: 'Нет группы' });
    try {
      renameSiteGroup(db(), id, String(form.get('name') ?? ''));
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },
  delete: async ({ request, locals }) => {
    requireAdmin(locals);
    const id = groupId(await request.formData());
    if (!id) return fail(400, { error: 'Нет группы' });
    deleteSiteGroup(db(), id);
    changed();
  },
  // Состав целиком: отмеченные галочками домены плюс вставленный текстом список.
  removeHost: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = groupId(form);
    const g = id ? getSiteGroup(db(), id) : undefined;
    if (!id || !g) return fail(400, { error: 'Нет группы' });
    if (g.fixedAt) return fail(400, { error: 'Группа зафиксирована — сначала откройте её для правок' });
    try {
      removeHostFromGroup(db(), id, String(form.get('host') ?? ''));
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    changed();
    return { saved: id };
  },
  hosts: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = groupId(form);
    if (!id || !getSiteGroup(db(), id)) return fail(400, { error: 'Нет группы' });
    const picked = form.getAll('host').map(String);
    const { hosts: pasted, rejected } = parseHostList(String(form.get('paste') ?? ''));
    try {
      setSiteGroupHosts(db(), id, [...picked, ...pasted]);
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
    changed();
    return { saved: id, rejected };
  }
};
