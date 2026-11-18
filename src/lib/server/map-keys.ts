// Раздел «Ключи карты» (просьба владелицы 18.11.2026): все главные и
// второстепенные ключи из «Карты ключей FUT» — какой сайт и страница должны по
// ним стоять, где они стоят в Google на самом деле, какие ваши другие сайты той
// же страны видны по этому ключу и стоят ли выше, сколько ссылок уже куплено на
// этот ключ. Чтобы видеть, какие ключи подтягивать и правильно ли идут закупки.
//
// Ключи — те же, что в колонке «Карта ключей» на «Ключах сайтов» (главный и до
// трёх продающих второстепенных у сайта). Позиции — Search Console всех ваших
// сайтов за последние OWNERS_DAYS дней, в стране ключа: средняя позиция по всем
// странам путала бы (futcoin.at 11-й по «fifa coins» — это Австрия, не Британия).
import type { Db } from './db';
import { fetchQueryHostsByCountry, fetchSiteGeos, listAllKnownSites, type QueryOwner } from './google';
import { keyMapAll, keyMapHeadline } from './key-map';
import { linksByQuery, type QueryLink } from './group-items';
import { foldQuery, hostKey } from '$lib/utils/fold-query';
import { mapGeo, type KeyRole, type MapKey, type MapPage } from '$lib/utils/key-map';

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
  /** Стоит выше сайта, который должен стоять по карте. */
  above: boolean;
}

export interface MapKeyRow {
  key: string;
  country: string;
  geo: string;
  role: KeyRole;
  host: string;
  /** Страница по карте (путь). */
  url: string;
  volume: number;
  avg: number;
  ahrefs: number | null;
  /** Позиция сайта по ключу (или его варианту) в стране ключа за OWNERS_DAYS дней; null — показов там нет. */
  position: number | null;
  impressions: number;
  clicks: number;
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
  /** «страна\tключ» → сайты с показами в этой стране (fetchQueryHostsByCountry). */
  owners: Map<string, QueryOwner[]>;
  links: Map<string, QueryLink[]>;
  geos: Map<string, string[]> | null;
  /** Домены, которые есть в Search Console; null — неизвестно. */
  consoleHosts: Set<string> | null;
}): MapKeyRow[] {
  const { headline, pages, owners, links, geos, consoleHosts } = input;
  // Роль ключа у каждого сайта по карте (все страницы карты, с вариантами).
  const roleOf = (host: string, k: string): KeyRole | null => {
    let role: KeyRole | null = null;
    for (const p of pages.get(host) ?? []) {
      if (![p.key, ...p.alts].some((x) => foldQuery(x) === k)) continue;
      if (p.role === 'main') return 'main';
      role = 'secondary';
    }
    return role;
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
      const byHost = new Map<string, QueryOwner>();
      // Страницы сайта по карте по ключу и вариантам: показы и клики — сумма,
      // место — среднее, взвешенное по показам.
      const myPages = new Map<string, { position: number; impressions: number; clicks: number }>();
      for (const q of queries) {
        for (const o of owners.get(`${cc}\t${q}`) ?? []) {
          const cur = byHost.get(o.host);
          if (!cur || o.impressions > cur.impressions) byHost.set(o.host, o);
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
      const me = byHost.get(host) ?? null;
      // Ссылки на тот же ключ другим сайтам — только сайтам этой страны: виден в
      // ней по ключу или это его основная страна в Search Console.
      const near = (h: string) => byHost.has(h) || (geos?.get(h) ?? []).includes(cc);
      const rivals: MapKeyRival[] = [...byHost.values()]
        .filter((o) => o.host !== host)
        .sort((a, b) => a.position - b.position)
        .map((o) => ({ host: o.host, page: pathOf(o.page), position: o.position, impressions: o.impressions, clicks: o.clicks, mapRole: roleOf(o.host, k), above: !me || o.position < me.position }));
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
        url: mk.url,
        volume: typeof mk.volume === 'number' ? mk.volume : 0,
        avg: typeof mk.avg === 'number' ? mk.avg : 0,
        ahrefs: typeof mk.ahrefs === 'number' ? mk.ahrefs : null,
        position: me ? me.position : null,
        impressions: me?.impressions ?? 0,
        clicks: me?.clicks ?? 0,
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

/** Строки раздела: карта + позиции Google за OWNERS_DAYS дней + закупки. */
export async function mapKeyRows(db: Db): Promise<{ rows: MapKeyRow[]; days: number; errors: string[] }> {
  const errors: string[] = [];
  const [owners, geos, known] = await Promise.all([
    fetchQueryHostsByCountry(db, OWNERS_DAYS).catch((e) => (errors.push(`позиции Google: ${(e as Error).message}`), new Map<string, QueryOwner[]>())),
    fetchSiteGeos(db).catch(() => null),
    listAllKnownSites(db).catch(() => null)
  ]);
  const rows = joinMapKeys({
    headline: keyMapHeadline(db),
    pages: keyMapAll(db),
    owners,
    links: linksByQuery(db),
    geos,
    consoleHosts: known ? new Set(known.sites.map((s) => hostKey(s.siteUrl))) : null
  });
  return { rows, days: OWNERS_DAYS, errors };
}
