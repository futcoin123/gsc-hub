// «Язык» и «Гео» сайта для ТЗ на ссылки: с самого сайта.
//   Язык — атрибут lang у <html> главной сайта или его языковой папки (/it/, /de/);
//          если сайт его не указал — по стране страницы в «Карте ключей FUT».
//   Гео  — страна страницы в «Карте ключей FUT», иначе зона домена (.de, .co.uk),
//          иначе регион в lang (de-AT), иначе Global.
// Названия — ровно из списка владелицы (src/lib/utils/locale-names.ts).
import type { Db } from './db';
import { BROWSER_UA } from './uptime';
import { mapSettledLimit } from './concurrency';
import { keyMapFor } from './key-map';
import { COUNTRY, GLOBAL, MAP_COUNTRY, MAP_LANGUAGE, langRegion, languageName, tldCountry } from '$lib/utils/locale-names';
import type { MapPage } from '$lib/utils/key-map';

const STALE_MS = 7 * 24 * 3600_000;
const TIMEOUT_MS = 8_000;

export interface PageLocale {
  language: string | null;
  geo: string;
}

/** Главная сайта или его языковой папки: https://futcoins.eu/it/x/ → https://futcoins.eu/it/. */
export function sectionOf(page: string): string | null {
  try {
    const u = new URL(page);
    const first = u.pathname.split('/').filter(Boolean)[0] ?? '';
    return /^[a-z]{2}(-[a-z]{2})?$/i.test(first) ? `${u.origin}/${first}/` : `${u.origin}/`;
  } catch {
    return null;
  }
}

/** lang из начала HTML: <html lang="es-ES"> → es-ES. */
export function parseHtmlLang(html: string): string | null {
  const tag = /<html\b[^>]*>/i.exec(html)?.[0] ?? '';
  const m = /\blang\s*=\s*["']?([a-zA-Z]{2,3}(?:[-_][a-zA-Z0-9]{2,8})*)/i.exec(tag);
  return m ? m[1] : null;
}

async function fetchLang(url: string): Promise<{ lang: string | null; error: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) return { lang: null, error: `HTTP ${res.status}` };
    const html = (await res.text()).slice(0, 200_000);
    return { lang: parseHtmlLang(html), error: null };
  } catch (e) {
    return { lang: null, error: (e as Error).message.slice(0, 120) };
  }
}

/** Узнать lang у разделов, которых ещё нет в базе или которые старше недели. */
export async function refreshLangs(db: Db, sections: string[]): Promise<void> {
  const known = new Map(
    (db.prepare('SELECT url, checked_at FROM site_locale').all() as { url: string; checked_at: number }[]).map((r) => [r.url, r.checked_at])
  );
  const due = [...new Set(sections)].filter((s) => Date.now() - (known.get(s) ?? 0) >= STALE_MS);
  const save = db.prepare(
    `INSERT INTO site_locale (url, lang, error, checked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET lang = COALESCE(excluded.lang, site_locale.lang), error = excluded.error, checked_at = excluded.checked_at`
  );
  await mapSettledLimit(due, async (s) => {
    const r = await fetchLang(s);
    save.run(s, r.lang, r.error, Date.now());
  }, 6);
}

const storedLang = (db: Db, section: string) =>
  (db.prepare('SELECT lang FROM site_locale WHERE url = ?').get(section) as { lang: string | null } | undefined)?.lang ?? null;

/** Страница карты, к которой относится адрес: та же папка (или главная). */
function mapPageFor(pages: MapPage[] | null, section: string): MapPage | null {
  if (!pages?.length) return null;
  const path = new URL(section).pathname;
  const same = pages.filter((p) => (sectionOf(new URL(p.url, section).href) ?? '') === section);
  return same.find((p) => p.url === path) ?? same.find((p) => p.role === 'main') ?? same[0] ?? null;
}

/** Язык и гео раздела по уже известным данным (без запросов к сайту). */
export function localeOfSection(db: Db, section: string): PageLocale {
  const host = new URL(section).hostname.toLowerCase().replace(/^www\./, '');
  let pages: MapPage[] | null = null;
  try {
    pages = keyMapFor(db, host);
  } catch {
    pages = null;
  }
  const mp = mapPageFor(pages, section);
  const lang = storedLang(db, section);
  const language = languageName(lang) ?? (mp ? (MAP_LANGUAGE[mp.country] ?? null) : null);
  const code = (mp ? MAP_COUNTRY[mp.country] : null) ?? tldCountry(host) ?? langRegion(lang);
  return { language, geo: (code && COUNTRY[code]) || GLOBAL };
}

/** Язык и гео для адресов страниц: page → { language, geo }. Сначала спрашивает сайты, которых ещё не знает. */
export async function localesFor(db: Db, pages: string[]): Promise<Record<string, PageLocale>> {
  const sections = new Map<string, string>();
  for (const p of pages) {
    const s = sectionOf(p);
    if (s) sections.set(p, s);
  }
  await refreshLangs(db, [...sections.values()]);
  const out: Record<string, PageLocale> = {};
  for (const [p, s] of sections) out[p] = localeOfSection(db, s);
  return out;
}

/** Разделы сайта для строки сайта: главная и главные страницы языковых папок из карты. */
export function siteSections(db: Db, home: string): string[] {
  const root = sectionOf(home);
  if (!root) return [];
  const out = new Set([root]);
  try {
    const host = new URL(home).hostname.toLowerCase().replace(/^www\./, '');
    for (const p of keyMapFor(db, host) ?? []) {
      if (p.role !== 'main') continue;
      const s = sectionOf(new URL(p.url, home).href);
      if (s && s.startsWith(new URL(home).origin)) out.add(s);
    }
  } catch {
    // без карты — только главная
  }
  return [...out];
}
