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
import { clicksForRange } from '$lib/server/button-clicks';
import { sourceOf } from '$lib/utils/traffic-source';

/** Входы на сайт не из Google и не прямые — по счётчику на сайте. */
type Ext = { b: number; s: number; ai: number; o: number };
const noExt = (): Ext => ({ b: 0, s: 0, ai: 0, o: 0 });
function externalVisits(start: string, end: string): Map<string, Ext> {
  const out = new Map<string, Ext>();
  for (const r of clicksForRange(db(), start, end)) {
    if (r.kind !== 'view' || !r.target) continue;
    const src = sourceOf(r.target);
    if (!src || src.group === 'direct' || src.key === 'Google') continue;
    const e = out.get(r.host) ?? noExt();
    if (src.key === 'Bing') e.b += r.n;
    else if (src.group === 'search') e.s += r.n;
    else if (src.group === 'ai') e.ai += r.n;
    else e.o += r.n;
    out.set(r.host, e);
  }
  return out;
}

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

  // Заходы не из Google (просьба владелицы 14.11.2026: продвижение идёт и в
  // Bing, ИИ, других поисковиках и сайтах) — за те же даты и за период сравнения.
  const prevWin = cmp.window ?? { startDate: addCalendarDays(period.startDate, -days), endDate: addCalendarDays(period.startDate, -1) };
  const extNow = externalVisits(period.startDate, period.endDate);
  const extPrev = externalVisits(prevWin.startDate, prevWin.endDate);

  await seedSiteLabels(db());
  const rows = entries.map((e) => ({
    ext: extNow.get(labelKey(e.siteUrl)) ?? noExt(),
    extPrev: extPrev.get(labelKey(e.siteUrl)) ?? noExt(),
    ...e,
    events: toChartEvents(eventsByHost.get(hostOfSite(e.siteUrl)) ?? []),
    // Новые закупки сверху (listGroupPurchases уже отдаёт по дате, новые первыми).
    buys: buys.get(labelKey(e.siteUrl)) ?? []
  }));

  return { entries: rows, errors, days, comparable, cmp: { key: cmp.key, start: cmp.window?.startDate ?? null, end: cmp.window?.endDate ?? null }, labels: siteLabels(db()), favorites: userFavorites(db()) };
};

export const prerender = false;
export const ssr = true;
