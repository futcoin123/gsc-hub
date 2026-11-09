import type { PageServerLoad } from './$types';
import { reportPeriod } from '$lib/server/report-period';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { parsePeriod, sitesForPeriod } from '$lib/server/site-keys';
import { clicksForRange, normHost } from '$lib/server/button-clicks';
import { siteHostname } from '$lib/utils/url-filters';
import { keyMapAll } from '$lib/server/key-map';
import { mapSummary } from '$lib/utils/key-map';

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals);
  const period = reportPeriod(db());
  const { sites, errors } = await sitesForPeriod(db(), period);
  // Нажатия кнопки оплаты (переход на партнёрку) по доменам за тот же период —
  // счётчик хаба на сайтах.
  const payByHost: Record<string, number> = {};
  for (const r of clicksForRange(db(), period.startDate, period.endDate)) {
    if (r.kind === 'submit') payByHost[r.host] = (payByHost[r.host] ?? 0) + r.n;
  }
  const hostOf = (u: string) => {
    try {
      return normHost(siteHostname(u));
    } catch {
      return '';
    }
  };
  const pay: Record<string, number> = {};
  for (const st of sites) pay[st.siteUrl] = payByHost[hostOf(st.siteUrl)] ?? 0;
  // Итого по доменам: у домена может быть две property — не считаем дважды.
  const payTotal = [...new Set(sites.map((st) => hostOf(st.siteUrl)))].reduce((a, h) => a + (payByHost[h] ?? 0), 0);
  // «Карта ключей FUT»: главные ключи сайта и сколько второстепенных; null — сайта в карте нет.
  let all = new Map<string, Parameters<typeof mapSummary>[0]>();
  try {
    all = keyMapAll(db());
  } catch {
    // карта не прочиталась — колонка покажет «нет в карте»
  }
  const keyMap: Record<string, { main: string[]; secondary: number } | null> = {};
  for (const st of sites) {
    const pages = all.get(hostOf(st.siteUrl));
    keyMap[st.siteUrl] = pages ? mapSummary(pages) : null;
  }
  return { period, sites, errors, pay, payTotal, keyMap, keyMapSites: all.size };
};
