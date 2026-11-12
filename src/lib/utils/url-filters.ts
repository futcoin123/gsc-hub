export interface UrlExclusion {
  id: number;
  pattern: string;
  kind: 'exact' | 'mask' | 'not_contains';
}

/** Plain text matches a substring; * matches any text and ? one character.
 * All other characters are literal. No user-provided regular expressions. */
export function urlMatchesMask(url: string, mask: string): boolean {
  const pattern = mask.trim();
  if (!pattern) return true;
  if (!/[?*]/.test(pattern)) return url.toLowerCase().includes(pattern.toLowerCase());
  // Match a substring as a glob with implicit leading/trailing stars.
  // Iterative matching avoids exponential regular-expression backtracking.
  const glob = ('*' + pattern.toLowerCase() + '*').replace(/\*+/g, '*');
  const text = url.toLowerCase();
  let pos = 0, token = 0, star = -1, retry = 0;
  while (pos < text.length) {
    if (glob[token] === '*') { star = token++; retry = pos; }
    else if (glob[token] === '?' || glob[token] === text[pos]) { token++; pos++; }
    else if (star >= 0) { token = star + 1; pos = ++retry; }
    else return false;
  }
  while (glob[token] === '*') token++;
  return token === glob.length;
}

export function urlExcluded(url: string, exclusions: UrlExclusion[]): boolean {
  return exclusions.some((e) => e.kind === 'exact' ? url === e.pattern : e.kind === 'not_contains' ? !urlMatchesMask(url, e.pattern) : urlMatchesMask(url, e.pattern));
}

export function siteHostname(site: string): string {
  const raw = site.startsWith('sc-domain:') ? `https://${site.slice(10)}/` : site;
  return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
}

/** Resolve only a path; the current property fixes the origin. */
export function customPurchaseUrl(input: string, site: string): string {
  const raw = input.trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(raw)) {
    throw new Error('Введи только путь, начинающийся с /, например /page/');
  }
  if (raw.length > 2000) throw new Error('Путь должен быть не длиннее 2000 символов');
  const base = site.startsWith('sc-domain:') ? `https://${site.slice(10)}/` : site;
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new Error('Укажи корректный URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error('Нужен HTTP(S) URL без логина и порта');
  }
  if (siteHostname(url.href) !== siteHostname(site)) throw new Error('URL должен принадлежать этому домену');
  url.hash = '';
  return url.href;
}

/**
 * Страница сайта, вписанная руками: полный адрес (https://site.com/page/),
 * адрес без https:// (site.com/page/) или путь (/page/). Только страницы
 * этого сайта (www. не в счёт); якорь #… отбрасывается.
 */
export function sitePageUrl(input: string, site: string): string {
  const raw = input.trim();
  if (!raw) throw new Error('Впишите страницу: адрес или путь, например /page/');
  if (raw.startsWith('/') && !raw.startsWith('//')) return customPurchaseUrl(raw, site);
  if (raw.length > 2000) throw new Error('Адрес должен быть не длиннее 2000 символов');
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) throw new Error('В адресе недопустимые символы');
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, '')}`);
  } catch {
    throw new Error('Не похоже на адрес страницы');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
    throw new Error('Нужен адрес http(s) без логина и порта');
  }
  let own = '';
  try {
    own = siteHostname(site);
  } catch {
    /* битый сайт — ниже не совпадёт */
  }
  if (!own || siteHostname(url.href) !== own) throw new Error(`Страница должна быть на ${own || 'этом сайте'}`);
  url.hash = '';
  return url.href;
}

/** Анкор, вписанный руками: без лишних пробелов, 1–300 символов. */
export function cleanAnchor(input: string): string {
  const q = input.replace(/\s+/g, ' ').trim();
  if (!q) throw new Error('Впишите ключ (текст ссылки)');
  if (q.length > 300) throw new Error('Ключ длиннее 300 символов');
  if (/^\[.*\]$/.test(q)) throw new Error('Ключ в квадратных скобках не подходит');
  return q;
}
