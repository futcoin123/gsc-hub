import type { PageServerLoad } from './$types';
import { reportPeriod } from '$lib/server/report-period';
import { db } from '$lib/server/db';
import { fetchDailyBreakdown } from '$lib/server/google';
import { requireAdmin } from '$lib/server/guard';
import { listSiteEvents, hostOfSite, toChartEvents } from '$lib/server/site-events';
import { listGroupPurchases } from '$lib/server/link-purchases';
import { seedSiteLabels, siteLabels, autoLabel } from '$lib/server/site-labels';
import { labelKey } from '$lib/utils/site-label';
import { addCalendarDays } from '$lib/server/gsc-calendar';
import { compareWindow } from '$lib/utils/compare-window';
import { userFavorites } from '$lib/server/user-selection';
import { clicksForRange, viewsByDay } from '$lib/server/button-clicks';
import { sourceOf } from '$lib/utils/traffic-source';
import { manualPurchases, manualSiteUrl, MANUAL_ACCOUNT } from '$lib/server/manual-sites';
import { counterOnlyHosts } from '$lib/server/own-sites';
import { counterDays, type CounterDay } from '$lib/utils/counter-days';

/** Входы на сайт по счётчику: g — из Google, b, s, ai, o — не из Google, d — прямые (как колонка «Прямые» на «Кнопках»). */
type Ext = { g: number; b: number; s: number; ai: number; o: number; d: number };
const noExt = (): Ext => ({ g: 0, b: 0, s: 0, ai: 0, o: 0, d: 0 });
function externalVisits(start: string, end: string): Map<string, Ext> {
  const out = new Map<string, Ext>();
  for (const r of clicksForRange(db(), start, end)) {
    if (r.kind !== 'view' || !r.target) continue;
    const src = sourceOf(r.target);
    if (!src) continue;
    const e = out.get(r.host) ?? noExt();
    // Прямые заходы (набрали адрес, закладка, мессенджер) — своей колонкой:
    // раньше их не было вовсе, и у сайта с одними прямыми заходами Dashboard
    // показывал нули, а «Кнопки» — просмотры (600kcoins.com, 24.11.2026).
    if (src.group === 'direct') e.d += r.n;
    else if (src.key === 'Google') e.g += r.n;
    else if (src.key === 'Bing') e.b += r.n;
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
  // href — что изменилось после закупки (группа) или кампания «Без консоли».
  type Buy = { key: string; href: string; name: string; date: string; qty: number; anchors: string[] };
  const buys = new Map<string, Buy[]>();
  for (const p of listGroupPurchases(db())) {
    const bySite = new Map<string, Buy>();
    for (const i of p.items) {
      const h = labelKey(i.siteUrl);
      const b = bySite.get(h) ?? { key: `g${p.groupId}`, href: `/purchases?g=${p.groupId}`, name: p.name, date: p.date, qty: 0, anchors: [] };
      b.qty += i.qty;
      const a = i.kind === 'naked' ? 'безанкор' : i.query;
      if (!b.anchors.includes(a)) b.anchors.push(a);
      bySite.set(h, b);
    }
    for (const [h, b] of bySite) buys.set(h, [...(buys.get(h) ?? []), b]);
  }
  // Купленное кампаниями «Без консоли» — в той же колонке.
  for (const m of manualPurchases(db())) {
    const b: Buy = { key: `m${m.campaignId}`, href: `/manual-sites?c=${m.campaignId}`, name: m.name, date: m.date, qty: m.qty, anchors: m.anchors };
    buys.set(m.host, [...(buys.get(m.host) ?? []), b]);
  }
  for (const list of buys.values()) list.sort((a, b) => b.date.localeCompare(a.date));

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
    manual: false,
    counter: null as { cur: CounterDay[]; prev: CounterDay[] } | null,
    events: toChartEvents(eventsByHost.get(hostOfSite(e.siteUrl)) ?? []),
    // Новые закупки сверху.
    buys: buys.get(labelKey(e.siteUrl)) ?? []
  }));

  // Свои сайты со счётчиком, которых ещё нет в Search Console (просьба
  // владелицы 17.11.2026: на них покупают ссылки — видеть прогресс): цифр Google
  // нет, прогресс — по счётчику на сайте, график по раскрытию — входы по дням.
  const manualHosts = await counterOnlyHosts(db(), entries.map((e) => labelKey(e.siteUrl)));
  if (manualHosts.length) {
    const cur = counterDays(viewsByDay(db(), period.startDate, period.endDate), manualHosts, period.startDate, period.endDate);
    const prev = counterDays(viewsByDay(db(), prevWin.startDate, prevWin.endDate), manualHosts, prevWin.startDate, prevWin.endDate);
    const zero = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
    for (const h of manualHosts) {
      const siteUrl = manualSiteUrl(h);
      rows.push({
        ext: extNow.get(h) ?? noExt(),
        extPrev: extPrev.get(h) ?? noExt(),
        accountId: MANUAL_ACCOUNT,
        accountEmail: '',
        accountLabel: null,
        siteUrl,
        current: [],
        previous: [],
        currentTotals: zero,
        previousTotals: zero,
        error: null,
        manual: true,
        counter: { cur: cur.get(h) ?? [], prev: prev.get(h) ?? [] },
        events: toChartEvents(eventsByHost.get(hostOfSite(siteUrl)) ?? []),
        buys: buys.get(h) ?? []
      });
    }
  }

  autoLabel(db(), rows.map((r) => r.siteUrl));
  return { entries: rows, errors, days, comparable, cmp: { key: cmp.key, start: cmp.window?.startDate ?? null, end: cmp.window?.endDate ?? null }, labels: siteLabels(db()), favorites: userFavorites(db()) };
};

export const prerender = false;
export const ssr = true;
