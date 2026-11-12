import type { PageServerLoad, Actions } from './$types';
import { ensureCounterKey, listCounterKeys, revokeCounterKey } from '$lib/server/config';
import { fail } from '@sveltejs/kit';
import { reportPeriod } from '$lib/server/report-period';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { parsePeriod, sitesForPeriod } from '$lib/server/site-keys';
import { checkoutSourcesForRange, clicksForRange, lastSeen, normHost, timeForRange, visitStatsForRange, workerScript } from '$lib/server/button-clicks';
import { siteHostname } from '$lib/utils/url-filters';
import { listAllKnownSites } from '$lib/server/google';
import { activeGroupHosts } from '$lib/server/site-groups';
import { bingConfigured, bingTotals, getBing } from '$lib/server/bing';
import { counterLogSince } from '$lib/server/counter-log';
import { localToday } from '$lib/server/gsc-calendar';

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals);
  // Счётчик пишет данные сразу — «N дней» здесь включают сегодня.
  const period = reportPeriod(db(), { includeToday: true });
  const clicks = clicksForRange(db(), period.startDate, period.endDate);
  // Клики из Google за тот же период — по домену (у домена бывает 2 property: берём бо́льшую).
  const { sites, errors } = await sitesForPeriod(db(), period);
  // Только сайты консолей, выбранных в шапке (и группы, если она выбрана).
  const group = activeGroupHosts(db());
  const hosts = new Set<string>();
  const gsc: Record<string, number> = {};
  const gscImpr: Record<string, number> = {};
  // Запрос к Google по сайту упал: вместо нулей показываем «ошибка» с текстом.
  const gscErr: Record<string, string> = {};
  const gscOk = new Set<string>();
  for (const s of sites) {
    try {
      const h = normHost(siteHostname(s.siteUrl));
      if (group && !group.has(h)) continue;
      hosts.add(h);
      gsc[h] = Math.max(gsc[h] ?? 0, s.clicks);
      gscImpr[h] = Math.max(gscImpr[h] ?? 0, s.impressions);
      if (s.error) gscErr[h] ??= s.error;
      else gscOk.add(h);
    } catch {
      /* битый адрес */
    }
  }
  for (const h of gscOk) delete gscErr[h];
  const time = timeForRange(db(), period.startDate, period.endDate);
  // Сайты, от которых счётчик прислал данные, но которых нет ни в одной рабочей
  // консоли (её доступ отозван или Google не отдал список): данные счётчика всё
  // равно показываем. Сайты консолей, снятых галочкой в шапке, остаются скрытыми.
  const missing = new Set<string>();
  for (const r of [...clicks, ...time]) if (!hosts.has(r.host) && (!group || group.has(r.host))) missing.add(r.host);
  const noConsole: string[] = [];
  if (missing.size) {
    const anywhere = new Set<string>();
    const all = await listAllKnownSites(db()).catch(() => ({ sites: [] as { siteUrl: string }[] }));
    for (const s of all.sites) {
      try {
        anywhere.add(normHost(siteHostname(s.siteUrl)));
      } catch {
        /* битый адрес */
      }
    }
    for (const h of missing) if (!anywhere.has(h)) noConsole.push(h);
    for (const h of noConsole) hosts.add(h);
  }
  // Bing за тот же период. Холодный старт Bing долгий (сотня запросов) — страницу
  // не держим дольше 3 секунд: тогда колонки покажут «загружается», а следующая
  // загрузка возьмёт готовое.
  const bingOn = bingConfigured();
  let bingState: 'off' | 'loading' | 'ok' = bingOn ? 'loading' : 'off';
  const bing: Record<string, { clicks: number; impressions: number }> = {};
  let bingLatest: string | null = null;
  if (bingOn) {
    const data = await Promise.race([getBing().catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
    if (data && data.daily.size) {
      const t = bingTotals(data, period.startDate, period.endDate);
      bingLatest = t.latest;
      for (const [h, v] of t.byHost) if (hosts.has(h)) bing[h] = v;
      bingState = 'ok';
    }
  }
  const mine = (h: string) => hosts.has(h);
  const seen = Object.fromEntries(Object.entries(lastSeen(db())).filter(([h]) => mine(h)));
  return {
    period,
    hosts: [...hosts].sort(),
    clicks: clicks.filter((r) => mine(r.host)),
    time: time.filter((t) => mine(t.host)),
    checkoutSources: checkoutSourcesForRange(db(), period.startDate, period.endDate).filter((r) => mine(r.host)),
    // Отказы: визиты и отказы по сайтам (только сайты, чей счётчик передаёт источник).
    visits: Object.fromEntries(visitStatsForRange(db(), period.startDate, period.endDate).filter((r) => mine(r.host)).map((r) => [r.host, { visits: r.visits, bounces: r.bounces }])) as Record<string, { visits: number; bounces: number }>,
    gsc,
    // Журнал приёма событий за 7 дней: что пришло от счётчика сайта и почему отброшено.
    counterLog: Object.fromEntries(Object.entries(counterLogSince(db(), localToday(Date.now() - 6 * 86400_000))).filter(([h]) => mine(h))),
    counterLogStart: (db().prepare('SELECT MIN(day) AS d FROM counter_log').get() as { d: string | null }).d,
    gscImpr, gscErr, noConsole, bing, bingState, bingLatest, lastSeen: seen, errors, workerCode: workerScript(url.origin), counterKey: ensureCounterKey(db()), keys: listCounterKeys(db()) };
};

export const actions: Actions = {
  // Новый ключ: старый Worker перестанет приниматься — код надо обновить на всех сайтах.
  // Новый ключ для новых сайтов; старые продолжают приниматься, пока их не отозвать.
  rotateKey: ({ locals }) => {
    requireAdmin(locals);
    ensureCounterKey(db(), true);
    return { rotated: true };
  },
  revokeKey: async ({ locals, request }) => {
    requireAdmin(locals);
    const hash = String((await request.formData()).get('hash') ?? '');
    if (!revokeCounterKey(db(), hash)) return fail(400, { keyError: 'Текущий ключ отозвать нельзя — сначала выдайте новый' });
    return { revoked: true };
  }
};
