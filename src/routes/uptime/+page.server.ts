import type { PageServerLoad, Actions } from './$types';
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { listSitesForAllAccounts } from '$lib/server/google';
import { siteHostname } from '$lib/utils/url-filters';
import { setConfigValue } from '$lib/server/config';
import { acceptCurrent, allHosts, baseHost, checkHost, history, intervalHours, INTERVALS, listChecks, runDue } from '$lib/server/uptime';
import { counterOnlyHosts } from '$lib/server/own-sites';

/** Сайты консолей, выбранных в шапке, и свои сайты со счётчиком без консоли. */
async function shownHosts(): Promise<Set<string>> {
  const hosts = new Set<string>();
  const { sites } = await listSitesForAllAccounts(db());
  for (const s of sites) {
    try {
      hosts.add(baseHost(siteHostname(s.siteUrl)));
    } catch {
      /* битый адрес */
    }
  }
  for (const h of await counterOnlyHosts(db(), hosts).catch(() => [])) hosts.add(baseHost(h));
  return hosts;
}
import { daysUntil, listDomainDates, refreshDomainDates, refreshDomainDatesInBackground, setManualDates } from '$lib/server/domain-dates';

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals);
  // Сайты консолей, выбранных в шапке (и группы, если выбрана), или ?all=1 — все консоли.
  const all = url.searchParams.get('all') === '1';
  const hosts = all ? new Set(await allHosts(db())) : await shownHosts();
  const checks = listChecks(db()).filter((c) => hosts.has(c.host));
  const hist: Record<string, ReturnType<typeof history>> = {};
  for (const h of hosts) hist[h] = history(db(), h, 20);
  // Даты доменов: что уже знаем; недостающие и устаревшие подтянутся в фоне.
  refreshDomainDatesInBackground(db(), [...hosts]);
  const known = listDomainDates(db());
  const domains: Record<string, { registered: string | null; expires: string | null; daysLeft: number | null; registeredManual: boolean; expiresManual: boolean; error: string | null; checked: boolean }> = {};
  for (const h of hosts) {
    const d = known.get(h);
    domains[h] = {
      registered: d?.registered ?? null,
      expires: d?.expires ?? null,
      daysLeft: d?.expires ? daysUntil(d.expires) : null,
      registeredManual: d?.registeredManual ?? false,
      expiresManual: d?.expiresManual ?? false,
      error: d?.error ?? null,
      checked: !!d && d.checkedAt > 0
    };
  }
  return { all, hosts: [...hosts].sort(), checks, history: hist, domains, interval: intervalHours(db()), intervals: [...INTERVALS] };
};

export const actions: Actions = {
  checkAll: async ({ locals }) => {
    requireAdmin(locals);
    const hosts = [...(await shownHosts())];
    const n = await runDue(db(), { force: true, hosts });
    return { checked: n };
  },
  checkOne: async ({ locals, request }) => {
    requireAdmin(locals);
    const host = baseHost(String((await request.formData()).get('host') ?? ''));
    if (!/^[a-z0-9.-]+$/.test(host)) return fail(400, { error: 'Не похоже на домен' });
    await checkHost(db(), host);
    return { checked: 1 };
  },
  accept: async ({ locals, request }) => {
    requireAdmin(locals);
    const host = baseHost(String((await request.formData()).get('host') ?? ''));
    acceptCurrent(db(), host);
    await checkHost(db(), host);
    return { accepted: host };
  },
  domainDates: async ({ locals, request }) => {
    requireAdmin(locals);
    const f = await request.formData();
    const host = baseHost(String(f.get('host') ?? ''));
    if (!/^[a-z0-9.-]+$/.test(host)) return fail(400, { error: 'Не похоже на домен' });
    setManualDates(db(), host, String(f.get('registered') ?? '') || null, String(f.get('expires') ?? '') || null);
    return { saved: true };
  },
  refreshDomains: async ({ locals }) => {
    requireAdmin(locals);
    const n = await refreshDomainDates(db(), await allHosts(db()), { force: true });
    return { domains: n };
  },
  interval: async ({ locals, request }) => {
    requireAdmin(locals);
    const h = Number((await request.formData()).get('h'));
    if (!(INTERVALS as readonly number[]).includes(h)) return fail(400, { error: 'Неверная частота' });
    setConfigValue(db(), 'UPTIME_INTERVAL_H', String(h));
    return { saved: true };
  }
};
