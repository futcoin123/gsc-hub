// Метки сайтов: к какому проекту относится сайт (решение владелицы 13.11.2026:
// все сайты, что есть в панели сейчас, — «futcoin»; новые будут с другой
// меткой). Метка стоит у сайта в «Ключах сайтов» и «Группах», уходит в ТЗ (CSV).
// С 17.11.2026 (просьба владелицы: «метку сразу ставь по теме») новый сайт
// получает метку сам, если тема видна: сайт монет FUT — «futcoin» (autoLabel).
import type { Db } from './db';
import { listAllKnownSites } from './google';
import { labelKey } from '$lib/utils/site-label';
import { keyMapAll, keyMapTopics } from './key-map';
import { geoKeywords } from '$lib/utils/key-map';

/** Метка всех сайтов, которые были в панели на 13.11.2026. */
export const FIRST_LABEL = 'futcoin';
const SEED_MARK = 'site-labels-futcoin';

/** Домен сайта без www — ключ метки. Принимает и адрес property (sc-domain:, https://). */
export const labelHost = labelKey;

/** Метка: обрезать пробелы, не длиннее 40 знаков; пустая — снять метку. */
export function cleanLabel(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return s || null;
}

/** Все метки: домен → метка. */
export function siteLabels(db: Db): Record<string, string> {
  const rows = db.prepare('SELECT host, label FROM site_labels').all() as { host: string; label: string }[];
  return Object.fromEntries(rows.map((r) => [r.host, r.label]));
}

export function setSiteLabel(db: Db, hostOrUrl: string, label: unknown, now = Date.now()): void {
  const host = labelHost(hostOrUrl);
  if (!host) throw new Error('нет сайта');
  // Метку поставили или сняли руками — сама панель её больше не трогает.
  db.prepare('INSERT OR IGNORE INTO site_labels_seen (host) VALUES (?)').run(host);
  const l = cleanLabel(label);
  if (l === null) db.prepare('DELETE FROM site_labels WHERE host = ?').run(host);
  else db.prepare('INSERT INTO site_labels (host, label, set_at) VALUES (?, ?, ?) ON CONFLICT(host) DO UPDATE SET label = excluded.label, set_at = excluded.set_at').run(host, l, now);
}

/** Поставить метку FIRST_LABEL всем этим сайтам, у кого метки ещё нет. */
export function labelAll(db: Db, hosts: Iterable<string>, label = FIRST_LABEL, now = Date.now()): number {
  const ins = db.prepare('INSERT OR IGNORE INTO site_labels (host, label, set_at) VALUES (?, ?, ?)');
  let n = 0;
  for (const h of new Set([...hosts].map(labelHost).filter(Boolean))) n += ins.run(h, label, now).changes;
  return n;
}

/** Сайт монет FUT по имени домена: fut, fifa, fc coins, ut coins, crediti, monety… */
const FUT_DOMAIN = /fut|fifa|fc-?coin|coins?-?fc|fc-?2\d|utcoin|ut-coin|crediti|creditfut|monety|\d+k-?coins/;

/** Метка по теме сайта: в «Карте ключей FUT» или домен про монеты FUT — «futcoin»; иначе не знаем. */
export function topicLabel(host: string, futHosts: Set<string>): string | null {
  const h = labelHost(host);
  return futHosts.has(h) || FUT_DOMAIN.test(h) ? FIRST_LABEL : null;
}

/**
 * Новым сайтам — метку по теме (просьба владелицы 17.11.2026). Только сайтам,
 * которым метку ещё не ставили: снятая владелицей метка не возвращается.
 */
export function autoLabel(db: Db, hosts: Iterable<string>, now = Date.now()): number {
  const labeled = new Set(Object.keys(siteLabels(db)));
  const seen = new Set((db.prepare('SELECT host FROM site_labels_seen').all() as { host: string }[]).map((r) => r.host));
  let fut: Set<string> | null = null;
  const ins = db.prepare('INSERT OR IGNORE INTO site_labels (host, label, set_at) VALUES (?, ?, ?)');
  const mark = db.prepare('INSERT OR IGNORE INTO site_labels_seen (host) VALUES (?)');
  let n = 0;
  for (const h of new Set([...hosts].map(labelHost).filter(Boolean))) {
    if (labeled.has(h) || seen.has(h)) continue;
    if (!fut) {
      try {
        fut = new Set(keyMapAll(db).keys());
      } catch {
        fut = new Set();
      }
    }
    const label = topicLabel(h, fut);
    if (!label) continue;
    n += ins.run(h, label, now).changes;
    mark.run(h);
  }
  return n;
}

/** Сайты, которые панель знает без Google: группы, закупки, «Без консоли», счётчик. */
function storedHosts(db: Db): string[] {
  const q = (sql: string) => (db.prepare(sql).all() as { h: string }[]).map((r) => r.h);
  return [
    ...q('SELECT DISTINCT host AS h FROM site_group_hosts'),
    ...q('SELECT DISTINCT site_url AS h FROM site_group_items'),
    ...q('SELECT host AS h FROM manual_sites'),
    ...q('SELECT DISTINCT host AS h FROM button_clicks')
  ];
}

/** Метка по теме всем сайтам, которые панель знает сама (группы, закупки, счётчик). */
export function autoLabelKnown(db: Db, now = Date.now()): number {
  return autoLabel(db, storedHosts(db), now);
}

/**
 * Один раз: всем сайтам, которые есть в панели сейчас (все консоли и всё, что
 * панель знает сама), — метка «futcoin». Сайты, добавленные потом, остаются
 * без метки, пока владелица её не поставит.
 */
export async function seedSiteLabels(db: Db, now = Date.now()): Promise<void> {
  if (db.prepare('SELECT 1 FROM schema_marks WHERE name = ?').get(SEED_MARK)) return;
  const hosts = storedHosts(db);
  try {
    const { sites } = await listAllKnownSites(db);
    for (const s of sites) hosts.push(s.siteUrl);
  } catch {
    /* консоли не ответили — метим то, что панель знает сама */
  }
  // Отметку ставим до записи: две страницы, открытые разом, не посеют дважды.
  if (db.prepare('INSERT OR IGNORE INTO schema_marks (name) VALUES (?)').run(SEED_MARK).changes === 0) return;
  labelAll(db, hosts, FIRST_LABEL, now);
}

/**
 * Ключи под страну для ТЗ группы: метка → страна → ключи (до 15, в ТЗ идут
 * 5–10 на блок). Для «futcoin» — ключи темы и ключи сайтов из «Карты ключей
 * FUT»; у других проектов (WoW…) своего источника пока нет.
 */
export function labelGeoKeys(db: Db): Record<string, Record<string, string[]>> {
  try {
    return { [FIRST_LABEL]: geoKeywords(keyMapAll(db), keyMapTopics(db)) };
  } catch {
    return {};
  }
}
