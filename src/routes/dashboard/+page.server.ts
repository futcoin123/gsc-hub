import type { PageServerLoad } from './$types';
import { reportPeriod } from '$lib/server/report-period';
import { db } from '$lib/server/db';
import { fetchDailyBreakdown } from '$lib/server/google';
import { requireAdmin } from '$lib/server/guard';
import { listSiteEvents, hostOfSite, toChartEvents } from '$lib/server/site-events';
import { listGroupPurchases } from '$lib/server/link-purchases';
import { seedSiteLabels, siteLabels } from '$lib/server/site-labels';
import { labelKey } from '$lib/utils/site-label';
import { addCalendarDays } from '$lib/server/gsc-calendar';
import { compareWindow } from '$lib/utils/compare-window';
import { userFavorites } from '$lib/server/user-selection';

// Dashboard — таблица сайтов, строка на сайт (просьба владелицы 13.11.2026:
// карточки занимают место; нужно сортировать по кликам, показам, позиции и их
// изменению, видеть закупки ссылок и сравнивать с выбранным периодом).
export const load: PageServerLoad = async ({ url, locals }) => {
  requireAdmin(locals);
  const period = reportPeriod(db());
  const days = period.days;
  // С чем сравнивать: prev — прошлый период той же длины (по умолчанию),
  // week — те же дни неделю назад, YYYY-MM-DD — свой день начала.
  const cmpRaw = url.searchParams.get('cmp') ?? 'prev';
  const cmp = compareWindow(cmpRaw, period.startDate, days, addCalendarDays);
  const { entries, errors, comparable } = await fetchDailyBreakdown(db(), days, cmp.window);

  const eventsByHost = new Map<string, ReturnType<typeof listSiteEvents>>();
  for (const ev of listSiteEvents(db())) {
    const arr = eventsByHost.get(ev.siteHost) ?? [];
    arr.push(ev);
    eventsByHost.set(ev.siteHost, arr);
  }

  // Закупки ссылок по сайту: какие группы, когда, сколько ссылок и с какими анкорами.
  type Buy = { groupId: number; name: string; date: string; qty: number; anchors: string[] };
  const buys = new Map<string, Buy[]>();
  for (const p of listGroupPurchases(db())) {
    const bySite = new Map<string, Buy>();
    for (const i of p.items) {
      const h = labelKey(i.siteUrl);
      const b = bySite.get(h) ?? { groupId: p.groupId, name: p.name, date: p.date, qty: 0, anchors: [] };
      b.qty += i.qty;
      const a = i.kind === 'naked' ? 'безанкор' : i.query;
      if (!b.anchors.includes(a)) b.anchors.push(a);
      bySite.set(h, b);
    }
    for (const [h, b] of bySite) buys.set(h, [...(buys.get(h) ?? []), b]);
  }

  await seedSiteLabels(db());
  const rows = entries.map((e) => ({
    ...e,
    events: toChartEvents(eventsByHost.get(hostOfSite(e.siteUrl)) ?? []),
    // Новые закупки сверху (listGroupPurchases уже отдаёт по дате, новые первыми).
    buys: buys.get(labelKey(e.siteUrl)) ?? []
  }));

  return { entries: rows, errors, days, comparable, cmp: { key: cmp.key, start: cmp.window?.startDate ?? null, end: cmp.window?.endDate ?? null }, labels: siteLabels(db()), favorites: userFavorites(db()) };
};

export const prerender = false;
export const ssr = true;
