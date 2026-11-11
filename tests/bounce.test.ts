import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { trackVisit, visitStatsForRange, resetVisits } from '../src/lib/server/button-clicks';

describe('отказы (bounce rate)', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
    resetVisits();
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const t0 = Date.parse('2026-11-12T10:00:00Z');
  const min = 60_000;
  const stats = (now: number) => visitStatsForRange(db, '2026-11-12', '2026-11-12', now);

  it('одна страница без нажатий — отказ; вторая страница или нажатие — нет', () => {
    trackVisit(db, 'a', 'x.com', 'view', 'google.com', t0); // отказ
    trackVisit(db, 'b', 'x.com', 'view', '(direct)', t0);
    trackVisit(db, 'b', 'x.com', 'view', '(internal)', t0 + min); // вторая страница
    trackVisit(db, 'c', 'x.com', 'view', 'bing.com', t0);
    trackVisit(db, 'c', 'x.com', 'submit', '', t0 + 2 * min); // переход к оплате
    trackVisit(db, 'd', 'x.com', 'view', 'chatgpt.com', t0);
    trackVisit(db, 'd', 'x.com', 'button', 'order', t0 + min); // нажатие
    // Визиты ещё идут — не считаются.
    expect(stats(t0 + 5 * min)).toEqual([]);
    // 30 минут тишины — визиты закончились.
    expect(stats(t0 + 40 * min)).toEqual([{ host: 'x.com', visits: 4, bounces: 1 }]);
  });

  it('новый вход того же посетителя закрывает прошлый визит; без источника — не считаем', () => {
    trackVisit(db, 'a', 'x.com', 'view', 'google.com', t0);
    trackVisit(db, 'a', 'x.com', 'view', 'google.com', t0 + 5 * min); // новый вход: прошлый — отказ
    trackVisit(db, 'z', 'y.com', 'view', '', t0); // счётчик без источника
    trackVisit(db, 'z', 'y.com', 'view', '', t0 + min);
    expect(stats(t0 + 60 * min)).toEqual([{ host: 'x.com', visits: 2, bounces: 2 }]);
  });

  it('событие после 30 минут тишины — уже не продолжение визита', () => {
    trackVisit(db, 'a', 'x.com', 'view', 'google.com', t0);
    trackVisit(db, 'a', 'x.com', 'view', '(internal)', t0 + 31 * min);
    expect(stats(t0 + 70 * min)).toEqual([{ host: 'x.com', visits: 1, bounces: 1 }]);
  });
});
