// Свои сайты владелицы без Search Console — для «Ключей сайтов» и Dashboard
// (просьба владелицы 17.11.2026: «мне нужны мои сайты, которые я тут делаю —
// fc-coins.net и прочие»). Свои — это сайты с единым счётчиком: от них панель
// принимала события или проверку связи с верным ключом. Сайты раздела «Без
// консоли» сюда не идут: счётчика на них нет.
import type { Db } from './db';
import { countedHosts, normHost } from './button-clicks';
import { listAllKnownSites } from './google';
import { labelKey } from '$lib/utils/site-label';

/** Сайты со счётчиком, которых нет ни в одной консоли (по домену без www). */
export function hostsWithoutConsole(counted: Iterable<string>, consoleHosts: Iterable<string>): string[] {
  const have = new Set([...consoleHosts].map((h) => normHost(h)));
  const out = new Set<string>();
  for (const raw of counted) {
    const h = normHost(raw.trim());
    // Технические адреса и мусор — не сайты.
    if (!h.includes('.') || h.endsWith('.pages.dev') || h === 'localhost' || /^[\d.]+$/.test(h) || have.has(h)) continue;
    out.add(h);
  }
  return [...out].sort();
}

/** Свои сайты со счётчиком без консоли: события и проверки связи против всех сайтов всех консолей. */
export async function counterOnlyHosts(db: Db, shownConsoleHosts: Iterable<string>): Promise<string[]> {
  const keyed = db.prepare('SELECT DISTINCT host FROM counter_key_hosts').all() as { host: string }[];
  const counted = [...countedHosts(db), ...keyed.map((r) => r.host)];
  const known = await listAllKnownSites(db).catch(() => ({ sites: [] as { siteUrl: string }[] }));
  return hostsWithoutConsole(counted, [...shownConsoleHosts, ...known.sites.map((s) => labelKey(s.siteUrl))]);
}
