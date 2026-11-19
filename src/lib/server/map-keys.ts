// Раздел «Ключи карты» (просьба владелицы 18.11.2026): все главные и
// второстепенные ключи из «Карты ключей FUT» — какой сайт и страница должны по
// ним стоять, где они стоят в Google на самом деле, какие ваши другие сайты той
// же страны видны по этому ключу и стоят ли выше, сколько ссылок уже куплено на
// этот ключ. Чтобы видеть, какие ключи подтягивать и правильно ли идут закупки.
//
// Ключи — те же, что в колонке «Карта ключей» на «Ключах сайтов» (главный и до
// трёх продающих второстепенных у сайта). Позиции — Search Console всех ваших
// сайтов в стране ключа: средняя позиция по всем странам путала бы (futcoin.at
// 11-й по «fifa coins» — это Австрия, не Британия). Позиция сайта по карте — за
// период из шапки и рядом — за прошлый такой же отрезок («Сегодня» ко вчера,
// «Вчера» к позавчера, 7 дней к прошлым 7; просьба владелицы 19.11.2026).
// Ваши другие сайты — всегда за последние OWNERS_DAYS дней, как на «Ключах сайтов».
import type { Db } from './db';
import { fetchQueryHostsByCountryRange, fetchSiteGeos, listAllKnownSites, type QueryOwner } from './google';
import { addCalendarDays, completedDayRange } from './gsc-calendar';
import { keyMapAll, keyMapHeadline } from './key-map';
import { linksByQuery, type QueryLink } from './group-items';
import { manualSiteUrl } from './manual-sites';
import { foldQuery, hostKey } from '$lib/utils/fold-query';
import { mapGeo, type KeyRole, type MapKey, type MapPage } from '$lib/utils/key-map';
import { siteHref } from '$lib/utils/site';

/** Страна карты → код страны Search Console. */
export const GSC_COUNTRY: Record<string, string> = { DE: 'deu', AT: 'aut', CH: 'che', IT: 'ita', ES: 'esp', NL: 'nld', PL: 'pol', FR: 'fra', UK: 'gbr', US: 'usa' };
import { OWNERS_DAYS } from '$lib/utils/owners';

export type MapKeyFlag = 'no-console' | 'not-ranking' | 'rival-above' | 'other-page';

export interface MapKeyRival {
  host: string;
  page: string;
  position: number;
  impressions: number;
  clicks: number;
  /** Роль этого ключа у того сайта по карте: главный, второстепенный или нет в карте. */
  mapRole: KeyRole | null;
  /**
   * Для какой страны у того сайта этот ключ в карте. Место выше — в стране
   * строки; у futcoins.co.uk «fut coins» — главный для UK, а в Испании он может
   * стоять 5-м: своей строки «в Испании» у него нет (там по карте fut-coins.es).
   */
  mapCountry: string | null;
  /** Стоит выше сайта, который должен стоять по карте. */
  above: boolean;
}

export interface MapKeyRow {
  key: string;
  country: string;
  geo: string;
  role: KeyRole;
  host: string;
  /**
   * Сайт для закупки (колонка «В группу»): property Search Console, у сайта без
   * консоли — https://домен/, как на «Ключах сайтов».
   */
  siteUrl: string;
  /** Страница по карте (путь). */
  url: string;
  /** Страница по карте полным адресом — на неё ставятся ссылки. */
  page: string;
  /** Ключ и его варианты из группы карты (нормальная форма) — по ним считаются ссылки. */
  queries: string[];
  volume: number;
  avg: number;
  ahrefs: number | null;
  /** Позиция сайта по ключу (или его варианту) в стране ключа за период; null — показов там нет. */
  position: number | null;
  impressions: number;
  clicks: number;
  /** То же за прошлый такой же отрезок (сравнение); null — показов тогда не было. */
  prevPosition: number | null;
  prevImpressions: number;
  /** Страница, которую Google показывает по ключу. */
  rankPage: string | null;
  /**
   * Страница по карте, когда Google чаще показывает другую: её собственное место
   * в стране ключа; null — по ключу она не показывается вовсе.
   */
  mapPage: { position: number; impressions: number; clicks: number } | null;
  rivals: MapKeyRival[];
  /** Ссылок на этот ключ этому сайту: куплено (зафиксированные группы) и в незафиксированных. */
  bought: number;
  planned: number;
  lastBuy: number | null;
  /** Куплено на этот же ключ другим вашим сайтам. */
  boughtElsewhere: { host: string; qty: number }[];
  flags: MapKeyFlag[];
}

const pathOf = (u: string) => {
  try {
    return new URL(u).pathname;
  } catch {
    return u;
  }
};

/** Сводит карту, позиции Google, страны сайтов и закупки в строки раздела. */
export function joinMapKeys(input: {
  headline: Map<string, MapKey[]>;
  pages: Map<string, MapPage[]>;
  /** «страна\tключ» → сайты с показами в этой стране за период (fetchQueryHostsByCountryRange). */
  owners: Map<string, QueryOwner[]>;
  /** То же за прошлый отрезок — для сравнения позиции; нет — сравнения нет. */
  prevOwners?: Map<string, QueryOwner[]> | null;
  /** То же за OWNERS_DAYS дней — для «Мои другие сайты»; нет — берётся owners. */
  rivalOwners?: Map<string, QueryOwner[]> | null;
  links: Map<string, QueryLink[]>;
  geos: Map<string, string[]> | null;
  /** Домены, которые есть в Search Console; null — неизвестно. */
  consoleHosts: Set<string> | null;
  /** Домен → property Search Console (для закупки); нет — сайт без консоли. */
  siteUrls?: Map<string, string> | null;
}): MapKeyRow[] {
  const { headline, pages, owners, links, geos, consoleHosts, siteUrls } = input;
  const prevOwners = input.prevOwners ?? null;
  const rivalOwners = input.rivalOwners ?? owners;
  /** Лучшая строка каждого сайта по ключу и вариантам в стране (больше показов). */
  const bestByHost = (src: Map<string, QueryOwner[]>, cc: string, queries: string[]) => {
    const by = new Map<string, QueryOwner>();
    for (const q of queries)
      for (const o of src.get(`${cc}\t${q}`) ?? []) {
        const cur = by.get(o.host);
        if (!cur || o.impressions > cur.impressions) by.set(o.host, o);
      }
    return by;
  };
  // Роль ключа у каждого сайта по карте (все страницы карты, с вариантами).
  // Страна строки — первой: у сайта с языковыми папками ключ бывает в нескольких странах.
  const roleOf = (host: string, k: string, country: string): { role: KeyRole; country: string } | null => {
    const hits = (pages.get(host) ?? []).filter((p) => [p.key, ...p.alts].some((x) => foldQuery(x) === k));
    const rank = (p: MapPage) => (p.country === country ? 0 : 2) + (p.role === 'main' ? 0 : 1);
    const best = hits.sort((a, b) => rank(a) - rank(b))[0];
    return best ? { role: best.role, country: best.country } : null;
  };
  const rows: MapKeyRow[] = [];
  for (const [host, keys] of headline) {
    for (const mk of keys) {
      const k = foldQuery(mk.key);
      // Варианты ключа из группы карты — тот же запрос для Google.
      const alts = (pages.get(host) ?? []).find((p) => foldQuery(p.key) === k)?.alts ?? [];
      const queries = [...new Set([k, ...alts.map(foldQuery)])];
      // Лучшая строка каждого сайта по ключу и его вариантам (больше показов) — в стране ключа.
      const cc = GSC_COUNTRY[mk.country] ?? mk.country.toLowerCase();
      // Другие сайты — за OWNERS_DAYS дней; сам сайт по карте — за период из шапки.
      const byHost = bestByHost(rivalOwners, cc, queries);
      const me = bestByHost(owners, cc, queries).get(host) ?? null;
      const prev = prevOwners ? (bestByHost(prevOwners, cc, queries).get(host) ?? null) : null;
      // Страницы сайта по карте по ключу и вариантам: показы и клики — сумма,
      // место — среднее, взвешенное по показам.
      const myPages = new Map<string, { position: number; impressions: number; clicks: number }>();
      for (const q of queries) {
        for (const o of owners.get(`${cc}\t${q}`) ?? []) {
          if (o.host !== host) continue;
          for (const pg of o.pages ?? [{ page: o.page, position: o.position, impressions: o.impressions, clicks: o.clicks }]) {
            const path = pathOf(pg.page);
            const was = myPages.get(path);
            if (!was) myPages.set(path, { position: pg.position, impressions: pg.impressions, clicks: pg.clicks });
            else {
              const imp = was.impressions + pg.impressions;
              myPages.set(path, { position: imp ? (was.position * was.impressions + pg.position * pg.impressions) / imp : was.position, impressions: imp, clicks: was.clicks + pg.clicks });
            }
          }
        }
      }
      // Ссылки на тот же ключ другим сайтам — только сайтам этой страны: виден в
      // ней по ключу или это его основная страна в Search Console.
      const near = (h: string) => byHost.has(h) || (geos?.get(h) ?? []).includes(cc);
      const rivals: MapKeyRival[] = [...byHost.values()]
        .filter((o) => o.host !== host)
        .sort((a, b) => a.position - b.position)
        .map((o) => {
          const m = roleOf(o.host, k, mk.country);
          return { host: o.host, page: pathOf(o.page), position: o.position, impressions: o.impressions, clicks: o.clicks, mapRole: m?.role ?? null, mapCountry: m?.country ?? null, above: !me || o.position < me.position };
        });
      let bought = 0, planned = 0, lastBuy: number | null = null;
      const elsewhere = new Map<string, number>();
      for (const q of queries) {
        for (const l of links.get(q) ?? []) {
          if (l.host === host) {
            if (l.fixed) {
              bought += l.qty;
              lastBuy = Math.max(lastBuy ?? 0, l.at);
            } else planned += l.qty;
          } else if (l.fixed && near(l.host)) elsewhere.set(l.host, (elsewhere.get(l.host) ?? 0) + l.qty);
        }
      }
      const siteUrl = siteUrls?.get(host) ?? manualSiteUrl(host);
      // Адрес страницы — с тем же началом, что у страниц сайта в Google (www или нет).
      let page = `https://${host}${mk.url}`;
      try {
        page = new URL(mk.url, new URL(me ? me.page : siteHref(siteUrl)).origin + '/').href;
      } catch {
        /* битый адрес — остаётся https://домен/путь */
      }
      const flags: MapKeyFlag[] = [];
      const inConsole = !consoleHosts || consoleHosts.has(host);
      if (!inConsole) flags.push('no-console');
      else if (!me) flags.push('not-ranking');
      if (rivals.some((r) => r.above)) flags.push('rival-above');
      if (me && pathOf(me.page) !== mk.url) flags.push('other-page');
      rows.push({
        key: mk.key,
        country: mk.country,
        geo: mapGeo(mk.country),
        role: mk.role,
        host,
        siteUrl,
        url: mk.url,
        page,
        queries,
        volume: typeof mk.volume === 'number' ? mk.volume : 0,
        avg: typeof mk.avg === 'number' ? mk.avg : 0,
        ahrefs: typeof mk.ahrefs === 'number' ? mk.ahrefs : null,
        position: me ? me.position : null,
        impressions: me?.impressions ?? 0,
        clicks: me?.clicks ?? 0,
        prevPosition: prev ? prev.position : null,
        prevImpressions: prev?.impressions ?? 0,
        rankPage: me ? pathOf(me.page) : null,
        mapPage: me && pathOf(me.page) !== mk.url ? (myPages.get(mk.url) ?? null) : null,
        rivals,
        bought,
        planned,
        lastBuy,
        boughtElsewhere: [...elsewhere].map(([h, qty]) => ({ host: h, qty })).sort((a, b) => b.qty - a.qty),
        flags
      });
    }
  }
  return rows.sort((a, b) => b.volume - a.volume || a.key.localeCompare(b.key));
}

type Range = { startDate: string; endDate: string };

/** Прошлый отрезок той же длины прямо перед периодом: «Сегодня» → вчера, «Вчера» → позавчера, 7 дней → прошлые 7. */
export function previousRange(p: Range & { days: number }): Range {
  return { startDate: addCalendarDays(p.startDate, -p.days), endDate: addCalendarDays(p.startDate, -1) };
}

export interface MapKeyRowsResult {
  rows: MapKeyRow[];
  period: Range;
  prev: Range;
  /** За сколько дней «Мои другие сайты». */
  rivalDays: number;
  errors: string[];
}

/** Строки раздела: карта + позиции Google за период и прошлый отрезок + закупки. */
export async function mapKeyRows(db: Db, period: Range & { days: number }): Promise<MapKeyRowsResult> {
  const errors: string[] = [];
  const range: Range = { startDate: period.startDate, endDate: period.endDate };
  const prevRange = previousRange(period);
  const rivalRange = completedDayRange(OWNERS_DAYS);
  // Один и тот же отрезок (период «7 дней» = окно других сайтов) спрашиваем один раз.
  const asked = new Map<string, Promise<Map<string, QueryOwner[]> | null>>();
  const owners = (r: Range, what: string) => {
    const k = `${r.startDate}_${r.endDate}`;
    if (!asked.has(k))
      asked.set(k, fetchQueryHostsByCountryRange(db, r).catch((e) => (errors.push(`позиции Google ${what}: ${(e as Error).message}`), null)));
    return asked.get(k)!;
  };
  const [cur, prev, rival, geos, known] = await Promise.all([
    owners(range, 'за период'),
    owners(prevRange, 'для сравнения'),
    owners(rivalRange, 'других сайтов'),
    fetchSiteGeos(db).catch(() => null),
    listAllKnownSites(db).catch(() => null)
  ]);
  // Property сайта для закупки: доменная (sc-domain:) охватывает весь сайт — она первой.
  const siteUrls = new Map<string, string>();
  for (const s of [...(known?.sites ?? [])].sort((a, b) => Number(b.siteUrl.startsWith('sc-domain:')) - Number(a.siteUrl.startsWith('sc-domain:')))) {
    const h = hostKey(s.siteUrl);
    if (!siteUrls.has(h)) siteUrls.set(h, s.siteUrl);
  }
  const rows = joinMapKeys({
    headline: keyMapHeadline(db),
    pages: keyMapAll(db),
    owners: cur ?? new Map(),
    prevOwners: prev,
    rivalOwners: rival ?? cur ?? new Map(),
    links: linksByQuery(db),
    geos,
    consoleHosts: known ? new Set(siteUrls.keys()) : null,
    siteUrls
  });
  return { rows, period: range, prev: prevRange, rivalDays: OWNERS_DAYS, errors: [...new Set(errors)] };
}
