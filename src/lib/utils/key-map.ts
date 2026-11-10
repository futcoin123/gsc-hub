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

/**
 * Коротко для строки сайта: главные ключи (у каждого — страна и папка, нужны,
 * когда главных несколько: сайт с языковыми папками) и сколько второстепенных.
 */
export function mapSummary(pages: MapPage[]): { main: { key: string; geo: string; url: string }[]; secondary: number } {
  const main: { key: string; geo: string; url: string }[] = [];
  for (const p of pages) {
    if (p.role !== 'main' || main.some((m) => m.key === p.key && m.url === p.url)) continue;
    main.push({ key: p.key, geo: mapGeo(p.country), url: p.url });
  }
  return { main, secondary: pages.filter((p) => p.role === 'secondary').length };
}

/** Подпись главного ключа: у сайта с несколькими главными — со страной в скобках. */
export const mainLabel = (m: { key: string; geo: string }, many: boolean) => (many ? `${m.key} (${m.geo})` : m.key);

/** Страницы карты, ни один ключ которых не встретился среди запросов сайта за период. */
export function missingKeys(pages: MapPage[], queries: string[]): MapPage[] {
  const qs = new Set(queries.map(normKey));
  const qw = new Set(queries.map(wordsOf));
  return pages.filter((p) => ![p.key, ...p.alts].some((k) => qs.has(normKey(k)) || qw.has(wordsOf(k))));
}
