// Безанкорные ссылки в группе: два вида текста ссылки.
//   'url'    — текст ссылки = полный адрес: https://futcoins.eu/
//   'domain' — текст ссылки = просто адрес без https://: futcoins.eu
// В базе вид хранится в поле query (ключ у безанкорной ссылки не нужен):
// '' — URL, NAKED_DOMAIN — домен. Настоящих ключей с такими значениями нет:
// у анкорной ссылки ключ всегда непустой и без квадратных скобок.

export type NakedVariant = 'url' | 'domain';
export const NAKED_DOMAIN = '[домен]';

export const nakedQuery = (v: NakedVariant) => (v === 'domain' ? NAKED_DOMAIN : '');
export const nakedVariant = (query: string): NakedVariant => (query === NAKED_DOMAIN ? 'domain' : 'url');

/** Адрес без https:// и, у главной, без косой черты в конце: futcoins.eu, futcoins.eu/it/. */
export function bareAddress(page: string): string {
  const s = page.replace(/^https?:\/\//, '');
  return /^[^/]+\/$/.test(s) ? s.slice(0, -1) : s;
}

/** Каким текстом стоит безанкорная ссылка. */
export const nakedAnchor = (page: string, query: string) => (nakedVariant(query) === 'domain' ? bareAddress(page) : page);

export const NAKED_LABEL: Record<NakedVariant, string> = { url: 'Безанкор (URL)', domain: 'Безанкор (домен)' };
