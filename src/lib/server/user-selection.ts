// Выбор в шапке (консоли, группа-фильтр) — у каждого вошедшего пользователя
// свой, чтобы двое могли работать параллельно и не переключать друг другу
// консоли. Пока пользователь ничего не менял, действует общий выбор.
import type { Db } from './db';
import { als } from './request-context';

export function currentUserId(): string | null {
  return als.getStore()?.userId ?? null;
}

function read(db: Db, uid: string, kind: string): string | undefined {
  const r = db.prepare('SELECT value FROM user_selection WHERE user_id = ? AND kind = ?').get(uid, kind) as { value: string } | undefined;
  return r?.value;
}

function write(db: Db, uid: string, kind: string, value: string): void {
  db.prepare(
    `INSERT INTO user_selection (user_id, kind, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, kind) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(uid, kind, value, Date.now());
}

/** Свои отмеченные консоли пользователя, или null — своего выбора ещё нет. */
export function userAccounts(db: Db, uid: string | null = currentUserId()): Set<string> | null {
  if (!uid) return null;
  const v = read(db, uid, 'accounts');
  if (v === undefined) return null;
  try {
    const ids = JSON.parse(v);
    return Array.isArray(ids) ? new Set(ids.filter((x): x is string => typeof x === 'string')) : null;
  } catch {
    return null;
  }
}

export function setUserAccounts(db: Db, uid: string, ids: Iterable<string>): void {
  write(db, uid, 'accounts', JSON.stringify([...new Set(ids)]));
}

/** Своя группа-фильтр: число, null — «все сайты», undefined — своего выбора ещё нет. */
export function userGroup(db: Db, uid: string | null = currentUserId()): number | null | undefined {
  if (!uid) return undefined;
  const v = read(db, uid, 'group');
  if (v === undefined) return undefined;
  const n = Number(v);
  return v !== '' && Number.isInteger(n) && n > 0 ? n : null;
}

export function setUserGroup(db: Db, uid: string, id: number | null): void {
  write(db, uid, 'group', id === null ? '' : String(id));
}

/** Ключ кэша, зависящий от выбора: у разных пользователей разные отчёты. */
export function selectionKey(db: Db): string {
  const uid = currentUserId();
  if (!uid) return 'shared';
  const a = userAccounts(db, uid);
  const g = userGroup(db, uid);
  return `${a ? [...a].sort().join(',') : '*'}|${g === undefined ? '*' : g ?? '-'}`;
}

/** Период отчётов из шапки (ключ: 'today' | 'yesterday' | '7' | … | 'YYYY-MM-DD_YYYY-MM-DD'). */
export function userPeriodKey(db: Db, uid: string | null = currentUserId()): string | null {
  return uid ? (read(db, uid, 'period') ?? null) : null;
}

export function setUserPeriodKey(db: Db, uid: string, key: string): void {
  write(db, uid, 'period', key);
}

/** Избранные сайты Dashboard (домены без www) — свои у каждого пользователя. */
export function userFavorites(db: Db, uid: string | null = currentUserId()): string[] {
  if (!uid) return [];
  try {
    const v = JSON.parse(read(db, uid, 'favorites') ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function setUserFavorites(db: Db, uid: string, hosts: Iterable<string>): void {
  write(db, uid, 'favorites', JSON.stringify([...new Set(hosts)].sort()));
}
