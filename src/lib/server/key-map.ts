// «Карта ключей FUT» в хабе: главные и второстепенные ключи сайтов.
//
// Карта лежит в репозитории зашифрованной (src/lib/key-map.enc.json,
// пишет scripts/key-map.mjs): репозиторий открыт всем, а карта — это все
// сайты владелицы с их ключами. Расшифровать её может только этот сервер:
// закрытый ключ создаётся здесь и не покидает базу, открытый отдаётся по
// /key-map/public-key.
//
// Сайт из карты берётся один раз и потом не меняется (правило владелицы
// 09.11.2026). Новая карта добавляет только сайты, которых в хабе ещё нет;
// карту перечитывают раз в 3 дня (задача в Claude).
import { createDecipheriv, createHash, generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import type { Db } from './db';
import bundled from '$lib/key-map.enc.json';
import type { MapPage } from '$lib/utils/key-map';

export interface EncryptedMap {
  v: number;
  hash?: string;
  pub?: string;
  key?: string;
  iv?: string;
  tag?: string;
  data?: string;
}
interface PlainMap {
  mapUpdated: string | null;
  hosts: Record<string, MapPage[]>;
}
interface State {
  private_key: string;
  public_key: string;
  map_hash: string | null;
  map_updated: string | null;
  imported_at: number | null;
}

const fingerprint = (pem: string) => createHash('sha256').update(pem.trim()).digest('hex').slice(0, 16);
const normHost = (h: string) => h.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

function state(db: Db): State {
  const row = db.prepare('SELECT private_key, public_key, map_hash, map_updated, imported_at FROM key_map_state WHERE id = 1').get() as State | undefined;
  if (row) return row;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  db.prepare('INSERT OR IGNORE INTO key_map_state (id, private_key, public_key) VALUES (1, ?, ?)').run(privateKey, publicKey);
  return db.prepare('SELECT private_key, public_key, map_hash, map_updated, imported_at FROM key_map_state WHERE id = 1').get() as State;
}

/** Открытый ключ хаба и что уже взято из карты — для scripts/key-map.mjs. */
export function keyMapPublicInfo(db: Db): { publicKey: string; fingerprint: string; mapHash: string | null; mapUpdated: string | null; hosts: number } {
  syncKeyMap(db);
  const s = state(db);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM key_map_hosts').get() as { n: number }).n;
  return { publicKey: s.public_key, fingerprint: fingerprint(s.public_key), mapHash: s.map_hash, mapUpdated: s.map_updated, hosts: n };
}

export function decryptKeyMap(db: Db, enc: EncryptedMap): PlainMap | null {
  if (enc?.v !== 1 || !enc.key || !enc.iv || !enc.tag || !enc.data) return null;
  const s = state(db);
  // Карту зашифровали ключом другого хаба (или базы до пересоздания) — не наша.
  if (enc.pub !== fingerprint(s.public_key)) return null;
  const aes = privateDecrypt({ key: s.private_key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(enc.key, 'base64'));
  const d = createDecipheriv('aes-256-gcm', aes, Buffer.from(enc.iv, 'base64'));
  d.setAuthTag(Buffer.from(enc.tag, 'base64'));
  const plain = Buffer.concat([d.update(Buffer.from(enc.data, 'base64')), d.final()]).toString('utf8');
  return JSON.parse(plain) as PlainMap;
}

/**
 * Взять из карты сайты, которых в хабе ещё нет. Уже взятые не трогаем.
 * Возвращает, сколько сайтов добавлено (null — карта не для этого хаба или пустая).
 */
export function importKeyMap(db: Db, enc: EncryptedMap): number | null {
  const s = state(db);
  if (enc?.v === 1 && enc.hash && enc.hash === s.map_hash) return 0;
  let map: PlainMap | null;
  try {
    map = decryptKeyMap(db, enc);
  } catch {
    return null;
  }
  if (!map) return null;
  const add = db.prepare('INSERT OR IGNORE INTO key_map_hosts (host, pages, added_at) VALUES (?, ?, ?)');
  let added = 0;
  db.transaction(() => {
    const now = Date.now();
    for (const [host, pages] of Object.entries(map!.hosts ?? {})) {
      if (!Array.isArray(pages) || !pages.length) continue;
      added += add.run(normHost(host), JSON.stringify(pages), now).changes;
    }
    db.prepare('UPDATE key_map_state SET map_hash = ?, map_updated = ?, imported_at = ? WHERE id = 1').run(enc.hash ?? null, map!.mapUpdated ?? null, now);
  })();
  return added;
}

const synced = new WeakSet<Db>();
/** Один раз за запуск сервера: карта из репозитория → база. */
export function syncKeyMap(db: Db, enc: EncryptedMap = bundled as EncryptedMap): void {
  if (synced.has(db)) return;
  synced.add(db);
  importKeyMap(db, enc);
}

/** Ключи сайта из карты; null — сайта в карте пока нет. */
export function keyMapFor(db: Db, host: string): MapPage[] | null {
  syncKeyMap(db);
  const row = db.prepare('SELECT pages FROM key_map_hosts WHERE host = ?').get(normHost(host)) as { pages: string } | undefined;
  return row ? (JSON.parse(row.pages) as MapPage[]) : null;
}

/** Все сайты карты: host → страницы. */
export function keyMapAll(db: Db): Map<string, MapPage[]> {
  syncKeyMap(db);
  const rows = db.prepare('SELECT host, pages FROM key_map_hosts').all() as { host: string; pages: string }[];
  return new Map(rows.map((r) => [r.host, JSON.parse(r.pages) as MapPage[]]));
}
