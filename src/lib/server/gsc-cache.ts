// TTL cache for GSC read responses.
//
// The fan-out endpoints (dashboard, today, site pages) fire one Search Console
// request per site per window, and with a portfolio that is minutes of waiting
// and a pile of quota on every view. The data itself changes slowly — a 60
// minute cache trades "this very second" for "usable", which for this tool is
// the right trade.
//
// Stale-while-revalidate: an expired answer that is less than STALE_MAX_MS old
// is returned at once and refreshed in the background, so switching back to a
// period seen earlier is instant (owner's complaint 10.11.2026: «Сегодня» and
// «7 дней» took long to load). Concurrent misses for one key share one request.
//
// With attachGscCacheStore(db) (the server does it at start) every answer is
// also written to SQLite and read back after a restart: a deploy used to start
// cold and every page then waited for Google again. Tests stay memory-only.
// Bound the map so a long-running process with many sites/windows cannot grow
// it forever — eviction is oldest-first.
import type { Db } from './db';

const DEFAULT_TTL_MS = 60 * 60 * 1000;
/** How old an expired answer may be and still be shown while it refreshes. */
export const STALE_MAX_MS = 12 * 60 * 60 * 1000;
const MAX_ENTRIES = 5_000;

interface Entry {
  at: number;
  expires: number;
  value: unknown;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
let disk: Db | null = null;
/** Bumped by invalidate: a refresh started before it must not write back. */
let generation = 0;

function evictOverflow() {
  // Map iterates in insertion order, so the first keys are the oldest.
  for (const key of store.keys()) {
    if (store.size <= MAX_ENTRIES) break;
    store.delete(key);
    disk?.prepare('DELETE FROM gsc_cache WHERE key = ?').run(key);
  }
}

function put(key: string, value: unknown, ttlMs: number) {
  const now = Date.now();
  const e: Entry = { at: now, expires: now + ttlMs, value };
  // Delete-then-set also upgrades a stale entry's position.
  store.delete(key);
  store.set(key, e);
  evictOverflow();
  if (disk) {
    try {
      disk
        .prepare('INSERT INTO gsc_cache (key, at, expires, value) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at, expires = excluded.expires, value = excluded.value')
        .run(key, e.at, e.expires, JSON.stringify(value));
    } catch {
      // the copy on disk is a convenience; memory still has the answer
    }
  }
}

function fetchOnce<T>(key: string, fetcher: () => Promise<T>, ttlMs: number): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const gen = generation;
  const p = fetcher()
    .then((value) => {
      if (gen === generation) put(key, value, ttlMs);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function gscCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) {
    // Refresh insertion order so a hot entry is never the first one evicted.
    store.delete(key);
    store.set(key, hit);
    return hit.value as T;
  }
  if (hit && now - hit.expires < STALE_MAX_MS) {
    // Old but recent enough: show it now, ask Google in the background.
    fetchOnce(key, fetcher, ttlMs).catch(() => {});
    return hit.value as T;
  }
  return fetchOnce(key, fetcher, ttlMs);
}

/**
 * Keep answers in SQLite too and load the recent ones back (after a restart).
 * Called once at server start.
 */
export function attachGscCacheStore(db: Db): number {
  disk = db;
  const now = Date.now();
  db.prepare('DELETE FROM gsc_cache WHERE expires < ?').run(now - STALE_MAX_MS);
  const rows = db.prepare('SELECT key, at, expires, value FROM gsc_cache ORDER BY at').all() as { key: string; at: number; expires: number; value: string }[];
  let n = 0;
  for (const r of rows) {
    try {
      store.set(r.key, { at: r.at, expires: r.expires, value: JSON.parse(r.value) });
      n++;
    } catch {
      // a broken row is skipped; the next request refills it
    }
  }
  evictOverflow();
  return n;
}

/** For tests: forget the SQLite copy. */
export function detachGscCacheStore(): void {
  disk = null;
}

/**
 * Drop everything, or only keys starting with `prefix` (`sites:acc123`).
 * Dropped answers are gone for good (no stale copy): the Refresh buttons
 * promise fresh numbers.
 */
export function gscCacheInvalidate(prefix = ''): number {
  let n = 0;
  if (prefix === '') {
    n = store.size;
    store.clear();
    inflight.clear();
    generation++;
    disk?.prepare('DELETE FROM gsc_cache').run();
    return n;
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      inflight.delete(key);
      n++;
    }
  }
  generation++;
  disk?.prepare("DELETE FROM gsc_cache WHERE substr(key, 1, ?) = ?").run(prefix.length, prefix);
  return n;
}

export function gscCacheSize(): number {
  return store.size;
}
