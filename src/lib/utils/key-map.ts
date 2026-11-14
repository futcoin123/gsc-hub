// Пометки «главный» и «второстепенный» у ключей сайта — по «Карте ключей FUT».
// Ключ из Search Console совпадает с ключом карты, если это та же фраза, один
// из её вариантов в группе карты (Google считает их одним запросом) или те же
// слова в другом порядке.
import { COUNTRY, MAP_COUNTRY } from './locale-names';

export type KeyRole = 'main' | 'secondary';

export interface MapPage {
  /** Страна в карте: DE, IT, ES, NL, PL, FR, AT, UK, US. */
  country: string;
  /** Адрес страницы на сайте, например «/» или «/de/fc-coins/». */
  url: string;
  key: string;
  role: KeyRole;
  alts: string[];
}

export interface KeyMark {
  role: KeyRole;
  page: MapPage;
  /** Запрос — сама фраза карты, а не её вариант. */
  same: boolean;
}

export const normKey = (q: string) => q.normalize('NFC').toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
const wordsOf = (q: string) => [...new Set(normKey(q).split(' '))].sort().join(' ');

export const ROLE_LABEL: Record<KeyRole, string> = { main: 'главный', secondary: 'второстеп.' };

/** Функция «запрос → пометка карты»; главный ключ важнее второстепенного. */
export function keyMarker(pages: MapPage[]): (query: string) => KeyMark | null {
  const exact = new Map<string, KeyMark>();
  const loose = new Map<string, KeyMark>();
  const put = (m: Map<string, KeyMark>, k: string, mark: KeyMark) => {
    const cur = m.get(k);
    if (!cur || (cur.role === 'secondary' && mark.role === 'main')) m.set(k, mark);
  };
  for (const p of pages) {
    for (const k of [p.key, ...p.alts]) {
      const mark = { role: p.role, page: p, same: normKey(k) === normKey(p.key) };
      put(exact, normKey(k), mark);
      put(loose, wordsOf(k), { ...mark, same: false });
    }
  }
  return (q) => exact.get(normKey(q)) ?? loose.get(wordsOf(q)) ?? null;
}

/** Подсказка к пометке: что это за ключ и где он стоит в карте. */
export function markTitle(m: KeyMark): string {
  const what = m.role === 'main' ? 'Главный ключ сайта' : 'Второстепенный ключ сайта';
  const via = m.same ? '' : ` — тот же запрос, что «${m.page.key}»`;
  return `${what} по «Карте ключей FUT»${via}. Страница по карте: ${m.page.url} (${m.page.country})`;
}

/** Страна страницы карты названием из списка владелицы: US → United States. */
export function mapGeo(country: string): string {
  return COUNTRY[MAP_COUNTRY[country] ?? ''] ?? country;
}

/** Подпись главного ключа: у сайта с несколькими главными — с коротким кодом страны: «fifa coins (NL)». */
export const mainLabel = (m: { key: string; cc: string }, many: boolean) => (many ? `${m.key} (${m.cc})` : m.key);

/** Страницы карты, ни один ключ которых не встретился среди запросов сайта за период. */
export function missingKeys(pages: MapPage[], queries: string[]): MapPage[] {
  const qs = new Set(queries.map(normKey));
  const qw = new Set(queries.map(wordsOf));
  return pages.filter((p) => ![p.key, ...p.alts].some((k) => qs.has(normKey(k)) || qw.has(wordsOf(k))));
}

/** Сколько ключей на страну идёт в ТЗ группы: не меньше 5, не больше 10. */
export const GEO_KEYS_MIN = 5;
export const GEO_KEYS_MAX = 10;
/** Сколько ключей дать блоку страны: по строке на ключ, но 5–10 (просьба владелицы). */
export const geoKeyCount = (rows: number, available: number) => Math.min(available, Math.max(GEO_KEYS_MIN, Math.min(rows, GEO_KEYS_MAX)));

/**
 * Ключи под страну для ТЗ группы (просьба владелицы 13.11.2026: «на одну гео
 * минимум 5 ключей, любые на эту тему, как они там звучат»): сначала ключи
 * темы страны из «Карты ключей FUT» (коммерческие группы «Монеты», от частых к
 * редким), потом главные и второстепенные ключи сайтов этой страны; без
 * повторов. Страна — названием, как колонка «Гео» (Italy…).
 */
export function geoKeywords(map: Map<string, MapPage[]>, topics: Record<string, string[]> = {}, n = 15): Record<string, string[]> {
  const pools = new Map<string, string[]>();
  const pool = (geo: string) => pools.get(geo) ?? (pools.set(geo, []), pools.get(geo)!);
  for (const [country, keys] of Object.entries(topics)) pool(mapGeo(country)).push(...keys);
  const site = new Map<string, { main: string[]; secondary: string[]; alts: string[] }>();
  for (const pages of map.values()) {
    for (const p of pages) {
      const geo = mapGeo(p.country);
      const s = site.get(geo) ?? { main: [], secondary: [], alts: [] };
      s[p.role].push(p.key);
      s.alts.push(...p.alts);
      site.set(geo, s);
    }
  }
  for (const [geo, s] of site) pool(geo).push(...s.main, ...s.secondary, ...s.alts);
  const out: Record<string, string[]> = {};
  for (const [geo, list] of pools) {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const k of list) {
      const nk = normKey(k);
      if (!nk || seen.has(nk)) continue;
      seen.add(nk);
      keys.push(k.trim());
      if (keys.length >= n) break;
    }
    out[geo] = keys;
  }
  return out;
}

export interface MapKeyStat {
  key: string;
  role: KeyRole;
  url: string;
  cc: string;
  geo: string;
  /** Показы за период: сам ключ карты и его варианты (тот же запрос для Google). */
  impressions: number;
}

/**
 * Ключи карты сайта с показами за период (просьба владелицы 14.11.2026:
 * главный и второстепенные — только те, у которых есть показы, и сколько).
 * Показы запроса идут ключу карты, которому запрос соответствует (keyMarker:
 * та же фраза, её вариант или те же слова). quiet — ключи карты без показов.
 */
export function mapImpressions(pages: MapPage[], queries: { query: string; impressions: number }[]): { main: MapKeyStat[]; secondary: MapKeyStat[]; quiet: MapKeyStat[] } {
  const stats = new Map<MapPage, MapKeyStat>();
  for (const p of pages) stats.set(p, { key: p.key, role: p.role, url: p.url, cc: p.country, geo: mapGeo(p.country), impressions: 0 });
  const mark = keyMarker(pages);
  for (const q of queries) {
    const m = mark(q.query);
    if (m && q.impressions > 0) stats.get(m.page)!.impressions += q.impressions;
  }
  // Один ключ на нескольких страницах карты (одна страна) — одна строка.
  const uniq = (list: MapKeyStat[]) => {
    const seen = new Map<string, MapKeyStat>();
    for (const s of list) {
      const k = `${s.role}\n${s.key}\n${s.cc}`;
      const cur = seen.get(k);
      if (!cur) seen.set(k, { ...s });
      else cur.impressions += s.impressions;
    }
    return [...seen.values()];
  };
  const all = uniq([...stats.values()]);
  const byImpr = (a: MapKeyStat, b: MapKeyStat) => b.impressions - a.impressions || a.key.localeCompare(b.key);
  return {
    main: all.filter((s) => s.role === 'main' && s.impressions > 0).sort(byImpr),
    secondary: all.filter((s) => s.role === 'secondary' && s.impressions > 0).sort(byImpr),
    quiet: all.filter((s) => s.impressions === 0)
  };
}
