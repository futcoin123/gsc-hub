import type { PageServerLoad } from './$types';
import { reportPeriod } from '$lib/server/report-period';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { parsePeriod, sitesForPeriod } from '$lib/server/site-keys';
import { clicksForRange, normHost } from '$lib/server/button-clicks';
import { siteHostname } from '$lib/utils/url-filters';
import { keyMapAll, keyMapHeadline } from '$lib/server/key-map';
import { mapSummary } from '$lib/utils/key-map';
import { seedSiteLabels, siteLabels, autoLabel } from '$lib/server/site-labels';
import { manualSiteUrl, MANUAL_ACCOUNT } from '$lib/server/manual-sites';
import { counterOnlyHosts } from '$lib/server/own-sites';
import { labelKey } from '$lib/utils/site-label';
import { sourceOf } from '$lib/utils/traffic-source';

export const load: PageServerLoad = async ({ locals, url }) => {
  requireAdmin(locals);
  const period = reportPeriod(db());
  await seedSiteLabels(db());
  const { sites: gscSites, errors } = await sitesForPeriod(db(), period);
  // Свои сайты со счётчиком, которых ещё нет в Search Console, — тоже здесь
  // (просьба владелицы 17.11.2026: на них покупают ссылки): ключи карты,
  // переходы к оплате, «В группу», «Свой ключ». Цифр Google у них нет.
  const ownHosts = await counterOnlyHosts(db(), gscSites.map((st) => labelKey(st.siteUrl)));
  const sites = [
    ...gscSites.map((st) => ({ ...st, manual: false })),
    ...ownHosts.map((h) => ({
      siteUrl: manualSiteUrl(h),
      accountId: MANUAL_ACCOUNT,
      accountEmail: '',
      accountLabel: null as string | null,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: null as number | null,
      error: undefined as string | undefined,
      manual: true
    }))
  ];
  // Нажатия кнопки оплаты (переход на партнёрку) по доменам за тот же период —
  // счётчик хаба на сайтах.
  const payByHost: Record<string, number> = {};
  // Входы на сайт по счётчику (просьба владелицы 17.11.2026): ext — из Google,
  // Bing, других поисковиков, ИИ и с других сайтов; direct — прямые заходы.
  const inByHost: Record<string, { ext: number; direct: number }> = {};
  for (const r of clicksForRange(db(), period.startDate, period.endDate)) {
    if (r.kind === 'submit') payByHost[r.host] = (payByHost[r.host] ?? 0) + r.n;
    if (r.kind !== 'view') continue;
    const src = sourceOf(r.target);
    if (!src) continue;
    const e = (inByHost[r.host] ??= { ext: 0, direct: 0 });
    if (src.group === 'direct') e.direct += r.n;
    else e.ext += r.n;
  }
  const hostOf = (u: string) => {
    try {
      return normHost(siteHostname(u));
    } catch {
      return '';
    }
  };
  const pay: Record<string, number> = {};
  const visits: Record<string, { ext: number; direct: number }> = {};
  for (const st of sites) {
    pay[st.siteUrl] = payByHost[hostOf(st.siteUrl)] ?? 0;
    visits[st.siteUrl] = inByHost[hostOf(st.siteUrl)] ?? { ext: 0, direct: 0 };
  }
  // Итого по доменам: у домена может быть две property — не считаем дважды.
  const payTotal = [...new Set(sites.map((st) => hostOf(st.siteUrl)))].reduce((a, h) => a + (payByHost[h] ?? 0), 0);
  // «Карта ключей FUT»: главный ключ сайта и до 3 продающих второстепенных с
  // запросами — вид «План» карты, цифра «Сент.» (просьба владелицы 14 и
  // 17.11.2026); null — сайта в карте нет.
  let all = new Map<string, unknown>();
  let headline = new Map<string, Parameters<typeof mapSummary>[0]>();
  try {
    all = keyMapAll(db());
    headline = keyMapHeadline(db());
  } catch {
    // карта не прочиталась — колонка покажет «нет в карте»
  }
  const keyMap: Record<string, ReturnType<typeof mapSummary> | null> = {};
  for (const st of sites) {
    const keys = headline.get(hostOf(st.siteUrl));
    keyMap[st.siteUrl] = keys ? mapSummary(keys) : null;
  }
  // Новым сайтам — метка по теме (сайт монет FUT — «futcoin»), если её ещё не ставили.
  autoLabel(db(), sites.map((st) => st.siteUrl));
  return { period, sites, errors, pay, payTotal, visits, keyMap, keyMapSites: all.size, labels: siteLabels(db()) };
};
