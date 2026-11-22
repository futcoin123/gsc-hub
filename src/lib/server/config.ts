import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './db';

export type ConfigKey =
  | 'GOOGLE_CLIENT_ID'
  | 'GOOGLE_CLIENT_SECRET'
  | 'AUTH_SECRET'
  | 'LOGIN_ENABLED'
  | 'MAGICLINKS_API_TOKEN'
  | 'MAGICLINKS_API_BASE'
  | 'MAGIC369_API_TOKEN'
  | 'MAGIC369_API_BASE'
  | 'BACKLINK_PROXY_URL'
  | 'BACKLINK_AUTO_ENABLED'
  | 'NEURALINDEXER_API_TOKEN'
  | 'DATAFORSEO_LOGIN'
  | 'DATAFORSEO_PASSWORD'
  | 'COUNTER_KEY'
  | 'TEAM_LINK_TOKEN'
  | 'UPTIME_INTERVAL_H';

function envVal(key: ConfigKey): string | undefined {
  const v = process.env[key];
  return v && v.trim() !== '' ? v : undefined;
}

export function getConfigValue(db: Db, key: ConfigKey): string | undefined {
  const e = envVal(key);
  if (e !== undefined) return e;
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as
    | { value: string } | undefined;
  return row?.value;
}

export function configSource(db: Db, key: ConfigKey): 'env' | 'db' | 'none' {
  if (envVal(key) !== undefined) return 'env';
  const row = db.prepare('SELECT 1 FROM app_config WHERE key = ?').get(key);
  return row ? 'db' : 'none';
}

export function setConfigValue(db: Db, key: ConfigKey, value: string): void {
  db.prepare(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, Date.now());
}

/** Убирает значение из базы. Значение из окружения так не снять — там оно и живёт. */
export function clearConfigValue(db: Db, key: ConfigKey): void {
  db.prepare('DELETE FROM app_config WHERE key = ?').run(key);
}

export function setConfigValues(db: Db, values: Partial<Record<ConfigKey, string>>): void {
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) setConfigValue(db, k as ConfigKey, v);
  }
}

export function getGoogleClientId(db: Db): string | undefined {
  return getConfigValue(db, 'GOOGLE_CLIENT_ID');
}
export function getGoogleClientSecret(db: Db): string | undefined {
  return getConfigValue(db, 'GOOGLE_CLIENT_SECRET');
}
export function isSetupComplete(db: Db): boolean {
  return !!getGoogleClientId(db) && !!getGoogleClientSecret(db);
}
export function ensureAuthSecret(db: Db): string {
  const existing = getConfigValue(db, 'AUTH_SECRET');
  if (existing) return existing;
  const secret = randomBytes(32).toString('base64');
  setConfigValue(db, 'AUTH_SECRET', secret);
  return secret;
}

/** Секретный ключ счётчика: Cloudflare Worker сайтов отправляет его вместе с событиями. */
const keyHash = (k: string) => createHash('sha256').update(k).digest('hex');

function rememberKey(db: Db, key: string): void {
  db.prepare('INSERT OR IGNORE INTO counter_keys (hash, prefix, created_at) VALUES (?, ?, ?)').run(keyHash(key), key.slice(0, 6), Date.now());
}

/**
 * Текущий ключ (его показываем для новых сайтов). rotate — выдать новый;
 * старые продолжают приниматься, пока их не отозвать.
 */
export function ensureCounterKey(db: Db, rotate = false): string {
  const existing = getConfigValue(db, 'COUNTER_KEY');
  if (existing && !rotate) {
    rememberKey(db, existing);
    return existing;
  }
  const key = randomBytes(24).toString('base64url');
  setConfigValue(db, 'COUNTER_KEY', key);
  rememberKey(db, key);
  return key;
}

/** Ключ принимается: любой выданный и не отозванный. Отмечает, с какого сайта он пришёл. */
export function counterKeyOk(db: Db, given: string | null, host?: string): boolean {
  if (!given || given.length > 200) return false;
  const current = getConfigValue(db, 'COUNTER_KEY');
  if (current) rememberKey(db, current);
  const h = keyHash(given);
  const row = db.prepare('SELECT revoked_at FROM counter_keys WHERE hash = ?').get(h) as { revoked_at: number | null } | undefined;
  if (!row || row.revoked_at) return false;
  const now = Date.now();
  db.prepare('UPDATE counter_keys SET last_used_at = ? WHERE hash = ?').run(now, h);
  if (host)
    db.prepare('INSERT INTO counter_key_hosts (hash, host, last_at) VALUES (?, ?, ?) ON CONFLICT(hash, host) DO UPDATE SET last_at = excluded.last_at').run(h, host, now);
  return true;
}

export interface CounterKeyInfo { hash: string; prefix: string; createdAt: number; revokedAt: number | null; lastUsedAt: number | null; current: boolean; hosts: string[] }

export function listCounterKeys(db: Db): CounterKeyInfo[] {
  const current = getConfigValue(db, 'COUNTER_KEY');
  const cur = current ? keyHash(current) : '';
  const rows = db.prepare('SELECT hash, prefix, created_at, revoked_at, last_used_at FROM counter_keys ORDER BY created_at DESC').all() as {
    hash: string; prefix: string; created_at: number; revoked_at: number | null; last_used_at: number | null;
  }[];
  const hosts = db.prepare('SELECT host FROM counter_key_hosts WHERE hash = ? ORDER BY last_at DESC').pluck();
  return rows.map((r) => ({
    hash: r.hash, prefix: r.prefix, createdAt: r.created_at, revokedAt: r.revoked_at, lastUsedAt: r.last_used_at,
    current: r.hash === cur, hosts: hosts.all(r.hash) as string[]
  }));
}

/** Отозвать ключ (текущий отозвать нельзя — сначала выдать новый). */
export function revokeCounterKey(db: Db, hash: string): boolean {
  const current = getConfigValue(db, 'COUNTER_KEY');
  if (current && keyHash(current) === hash) return false;
  return db.prepare('UPDATE counter_keys SET revoked_at = ? WHERE hash = ? AND revoked_at IS NULL').run(Date.now(), hash).changes > 0;
}
