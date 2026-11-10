import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { gscCached, gscCacheInvalidate, attachGscCacheStore, detachGscCacheStore, STALE_MAX_MS } from '../src/lib/server/gsc-cache';

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('кэш ответов Search Console', () => {
  afterEach(() => {
    vi.useRealTimers();
    detachGscCacheStore();
    gscCacheInvalidate();
  });

  it('свежий ответ берётся из памяти', async () => {
    const f = vi.fn(async () => 1);
    expect(await gscCached('k', f)).toBe(1);
    expect(await gscCached('k', f)).toBe(1);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('старый ответ показывается сразу, а новый спрашивается в фоне', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let n = 0;
    const f = vi.fn(async () => ++n);
    expect(await gscCached('k', f, 1000)).toBe(1);
    vi.setSystemTime(Date.now() + 2000);
    expect(await gscCached('k', f, 1000)).toBe(1); // старое, без ожидания
    await tick();
    expect(f).toHaveBeenCalledTimes(2);
    expect(await gscCached('k', f, 1000)).toBe(2); // уже новое
  });

  it('слишком старый ответ не показывается — ждём Google', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let n = 0;
    const f = async () => ++n;
    await gscCached('k', f, 1000);
    vi.setSystemTime(Date.now() + 1000 + STALE_MAX_MS + 1);
    expect(await gscCached('k', f, 1000)).toBe(2);
  });

  it('одновременные запросы одного ключа — один поход в Google', async () => {
    let release!: (v: number) => void;
    const f = vi.fn(() => new Promise<number>((r) => (release = r)));
    const a = gscCached('k', f);
    const b = gscCached('k', f);
    release(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('после сброса старого ответа нет, и опоздавший ответ его не вернёт', async () => {
    let release!: (v: number) => void;
    const slow = gscCached('k', () => new Promise<number>((r) => (release = r)));
    gscCacheInvalidate();
    release(1);
    await slow;
    const f = vi.fn(async () => 2);
    expect(await gscCached('k', f)).toBe(2);
    expect(f).toHaveBeenCalledTimes(1);
  });

  describe('копия в базе', () => {
    let dir: string;
    let db: Db;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
      db = openDb(join(dir, 'test.db'));
    });
    afterEach(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('переживает перезапуск: ответы читаются из базы', async () => {
      attachGscCacheStore(db);
      await gscCached('saq:a:site', async () => [{ clicks: 4 }]);
      // «перезапуск»: память нового процесса пуста, база осталась
      detachGscCacheStore();
      gscCacheInvalidate();
      expect(attachGscCacheStore(db)).toBe(1);
      const f = vi.fn(async () => [{ clicks: 5 }]);
      expect(await gscCached('saq:a:site', f)).toEqual([{ clicks: 4 }]);
      expect(f).not.toHaveBeenCalled();
      // кнопка «Refresh» стирает и копию в базе
      gscCacheInvalidate();
      detachGscCacheStore();
      expect(attachGscCacheStore(db)).toBe(0);
    });

    it('сброс по началу ключа чистит и базу', async () => {
      attachGscCacheStore(db);
      await gscCached('sites:a', async () => ['x']);
      await gscCached('saq:a:site', async () => [1]);
      gscCacheInvalidate('sites:');
      const keys = (db.prepare('SELECT key FROM gsc_cache').all() as { key: string }[]).map((r) => r.key);
      expect(keys).toEqual(['saq:a:site']);
    });
  });
});
