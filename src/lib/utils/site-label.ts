// Ключ метки сайта: домен без www — одинаково для property (sc-domain:, https://)
// и для домена из группы («futcoin.it»). Общий для сервера и страницы.
export function labelKey(site: string): string {
  const s = site.trim();
  let h = s;
  try {
    h = new URL(s.startsWith('sc-domain:') ? `https://${s.slice(10)}/` : /^https?:\/\//i.test(s) ? s : `https://${s}/`).hostname;
  } catch {
    /* как есть */
  }
  return h.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
}

export interface BlockRow {
  label: string | null;
  geo: string | null;
  site: string;
  page: string;
  query: string;
}

/**
 * Порядок ТЗ группы (просьба владелицы 13.11.2026): по метке сайта — каждый
 * проект отдельным блоком (futcoin, потом другие), внутри — по стране (вся
 * Италия, потом вся Испания…), дальше сайт, страница, анкор. Сайты без метки и
 * страницы, у которых страна ещё не определилась, — в конце; Global — после стран.
 */
export function blockCompare(a: BlockRow, b: BlockRow): number {
  if (a.label !== b.label) return a.label === null ? 1 : b.label === null ? -1 : a.label.localeCompare(b.label, 'ru');
  if (a.geo !== b.geo) {
    const rank = (g: string | null) => (g === null || g === '' ? 2 : g === 'Global' ? 1 : 0);
    return rank(a.geo) - rank(b.geo) || (a.geo ?? '').localeCompare(b.geo ?? '', 'ru');
  }
  return a.site.localeCompare(b.site) || a.page.localeCompare(b.page) || a.query.localeCompare(b.query, 'ru');
}
