import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { hostToUnicode } from '$lib/server/idn';
import {
  listManualSites,
  addManualSites,
  removeManualSite,
  listCampaigns,
  createCampaign,
  deleteCampaign,
  setCampaignFixed,
  listLinks,
  addLink,
  setLinkQty,
  removeLink,
  linkHistory,
  linkText,
  linkKind,
  todayDate,
  type NewLink
} from '$lib/server/manual-sites';

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals);
  const campaigns = listCampaigns(db());
  const wanted = Number(url.searchParams.get('c'));
  // По умолчанию — последняя открытая кампания (в неё добавляют), иначе последняя.
  const selected = campaigns.find((c) => c.id === wanted) ?? campaigns.find((c) => !c.fixedAt) ?? campaigns[0] ?? null;
  const show = <T extends { kind: 'anchor' | 'naked'; page: string; anchor: string; host: string }>(l: T) => ({
    ...l,
    text: linkText(l),
    kindLabel: linkKind(l),
    label: hostToUnicode(l.host)
  });
  return {
    sites: listManualSites(db()).map((s) => ({ ...s, label: hostToUnicode(s.host) })),
    campaigns,
    selectedId: selected?.id ?? null,
    links: selected ? listLinks(db(), selected.id).map(show) : [],
    history: linkHistory(db()).map(show),
    today: todayDate()
  };
};

const idOf = (form: FormData, name = 'id'): number | null => {
  const n = Number(form.get(name));
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Ошибка у той формы, где её сделали: where — 'sites' | 'campaign' | 'links'. */
const bad = (where: string, e: unknown) => fail(400, { where, error: e instanceof Error ? e.message : String(e) });

export const actions: Actions = {
  addSites: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const r = addManualSites(db(), String(form.get('hosts') ?? ''));
    if (!r.added.length && !r.existed.length) return bad('sites', new Error(r.rejected.length ? `Не похоже на домены: ${r.rejected.join(', ')}` : 'Впишите домены'));
    return { sitesAdded: r };
  },
  removeSite: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    try {
      removeManualSite(db(), String(form.get('host') ?? ''));
    } catch (e) {
      return bad('sites', e);
    }
  },
  createCampaign: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    try {
      return { created: createCampaign(db(), String(form.get('date') ?? ''), String(form.get('name') ?? '')) };
    } catch (e) {
      return bad('campaign', e);
    }
  },
  deleteCampaign: async ({ request, locals }) => {
    requireAdmin(locals);
    const id = idOf(await request.formData());
    if (!id) return bad('campaign', new Error('Нет кампании'));
    try {
      deleteCampaign(db(), id);
    } catch (e) {
      return bad('campaign', e);
    }
    return { deleted: id };
  },
  fix: async ({ request, locals }) => {
    requireAdmin(locals);
    const id = idOf(await request.formData());
    if (!id) return bad('campaign', new Error('Нет кампании'));
    try {
      setCampaignFixed(db(), id, true);
    } catch (e) {
      return bad('campaign', e);
    }
  },
  unfix: async ({ request, locals }) => {
    requireAdmin(locals);
    const id = idOf(await request.formData());
    if (!id) return bad('campaign', new Error('Нет кампании'));
    try {
      setCampaignFixed(db(), id, false);
    } catch (e) {
      return bad('campaign', e);
    }
  },
  addLink: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = idOf(form);
    if (!id) return bad('links', new Error('Сначала создайте кампанию'));
    const type = String(form.get('type') ?? 'anchor');
    const link: NewLink = {
      host: String(form.get('host') ?? ''),
      page: String(form.get('page') ?? ''),
      anchor: String(form.get('anchor') ?? ''),
      type: type === 'url' || type === 'domain' ? type : 'anchor',
      qty: Number(form.get('qty'))
    };
    try {
      const { prev } = addLink(db(), id, link);
      return { linkAdded: { prev, qty: Math.min(1000, Math.round(link.qty)) } };
    } catch (e) {
      return bad('links', e);
    }
  },
  linkQty: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = idOf(form);
    const link = idOf(form, 'link');
    if (!id || !link) return bad('links', new Error('Нет ссылки'));
    try {
      setLinkQty(db(), id, link, Number(form.get('qty')));
    } catch (e) {
      return bad('links', e);
    }
  },
  removeLink: async ({ request, locals }) => {
    requireAdmin(locals);
    const form = await request.formData();
    const id = idOf(form);
    const link = idOf(form, 'link');
    if (!id || !link) return bad('links', new Error('Нет ссылки'));
    try {
      removeLink(db(), id, link);
    } catch (e) {
      return bad('links', e);
    }
  }
};
