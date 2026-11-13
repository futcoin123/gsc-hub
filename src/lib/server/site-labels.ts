// Метки сайтов: к какому проекту относится сайт (решение владелицы 13.11.2026:
// все сайты, что есть в панели сейчас, — «futcoin»; новые будут с другой
// меткой). Метка стоит у сайта в «Ключах сайтов» и «Группах», уходит в ТЗ (CSV).
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
