import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { createSiteGroup } from '../src/lib/server/site-groups';
import { addGroupItem, addNakedItem, setGroupFixed } from '../src/lib/server/group-items';
import { dateFromGroupName, listGroupPurchases, groupPurchaseMarks, keywordPurchaseMarks, itemsLabel, groupDatesAndLinks } from '../src/lib/server/link-purchases';
import { listSiteEventsForSite } from '../src/lib/server/site-events';
import { windows, sumWindow } from '../src/lib/server/purchase-effect';

describe('закупки из групп', () => {
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

  const item = (query: string, page = 'https://futcoins.eu/', qty = 1) => ({ siteUrl: 'sc-domain:futcoins.eu', query, page, qty });

  it('дата закупки: из названия группы, а после фиксации — день фиксации', () => {
    expect(dateFromGroupName('10-11-26')).toBe('2026-11-10');
    expect(dateFromGroupName('31-02-26')).toBeNull();
    expect(dateFromGroupName('Испания')).toBeNull();
    const g = createSiteGroup(db, '10-11-26');
    addGroupItem(db, g, item('fc 27 coins', 'https://futcoins.eu/', 3));
    expect(listGroupPurchases(db)[0].date).toBe('2026-11-10');
    setGroupFixed(db, g, true);
    expect(listGroupPurchases(db)[0].fixed).toBe(true);
  });

  it('пометки на графике: по сайту — все ссылки, по ключу — только этот анкор', () => {
    const g = createSiteGroup(db, '10-11-26');
    addGroupItem(db, g, item('fc 27 coins', 'https://futcoins.eu/', 3));
    addGroupItem(db, g, item('fut coins'));
    addNakedItem(db, g, 'sc-domain:futcoins.eu', 'https://futcoins.eu/it/', 2, 'domain');
    createSiteGroup(db, '11-11-26'); // пустая группа — не закупка
    const marks = groupPurchaseMarks(db);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ host: 'futcoins.eu', date: '2026-11-10', links: 6 });
    expect(marks[0].label).toBe('Закупка 10-11-26: 6 ссыл. (fc 27 coins ×3, fut coins, безанкор ×2)');
    // Те же закупки — в событиях сайта (графики Dashboard и страницы сайта).
    const ev = listSiteEventsForSite(db, 'sc-domain:futcoins.eu');
    expect(ev.map((e) => [e.date, e.type, e.orderHref])).toEqual([['2026-11-10', 'link_purchase', `/groups?g=${g}`]]);
    // По ключу — закупки на страницу, где он стоит (любым анкором), а не по тексту анкора.
    expect(keywordPurchaseMarks(db, 'sc-domain:futcoins.eu', 'eafc27coins', 'https://futcoins.eu/')[0].label).toBe('Закупка 10-11-26: 4 ссыл. на эту страницу (fc 27 coins ×3, fut coins)');
    expect(keywordPurchaseMarks(db, 'sc-domain:futcoins.eu', 'crediti fifa', 'https://futcoins.eu/it/')[0].label).toBe('Закупка 10-11-26: 2 ссыл. на эту страницу (безанкор ×2)');
    // Тот же анкор на странице другой страны — не эта закупка.
    expect(keywordPurchaseMarks(db, 'sc-domain:futcoins.eu', 'fc 27 coins', 'https://futcoins.eu/pl/')).toEqual([]);
    expect(keywordPurchaseMarks(db, 'sc-domain:other.com', 'fc 27 coins', 'https://futcoins.eu/')).toEqual([]);
  });

  it('для колонки «В группу»: дата закупки и ссылки по сайтам', () => {
    const a = createSiteGroup(db, '09-11-26');
    addGroupItem(db, a, item('fc 27 coins', 'https://futcoins.eu/', 3));
    addGroupItem(db, a, { siteUrl: 'https://www.fut-coin.de/', query: 'fifa coins kaufen', page: 'https://www.fut-coin.de/', qty: 2 });
    const b = createSiteGroup(db, '10-11-26');
    const m = groupDatesAndLinks(db);
    expect(m.get(a)).toEqual({ date: '2026-11-09', links: { 'futcoins.eu': 3, 'fut-coin.de': 2 } });
    expect(m.get(b)).toEqual({ date: '2026-11-10', links: {} });
  });

  it('ссылки на сайт в группе ставят сайт в группу (галочка «В группу»)', () => {
    const g = createSiteGroup(db, '10-11-26');
    addGroupItem(db, g, { siteUrl: 'sc-domain:fccoins.co.uk', query: 'buy fc coins', page: 'https://fccoins.co.uk/', qty: 35 });
    addNakedItem(db, g, 'https://www.futcoin.es/', 'https://www.futcoin.es/', 1);
    const hosts = (db.prepare('SELECT host FROM site_group_hosts WHERE group_id = ? ORDER BY host').all(g) as { host: string }[]).map((r) => r.host);
    expect(hosts).toEqual(['fccoins.co.uk', 'futcoin.es']);
  });

  it('старые группы: сайты со ссылками дописываются в группу при запуске', () => {
    const g = createSiteGroup(db, '09-11-26');
    db.prepare("INSERT INTO site_group_items (group_id, site_url, query, page, added_at, qty, kind) VALUES (?, 'sc-domain:fccoins.co.uk', 'buy fc coins', 'https://fccoins.co.uk/', 0, 5, 'anchor')").run(g);
    db.prepare('DELETE FROM site_group_hosts WHERE group_id = ?').run(g);
    db.prepare("DELETE FROM schema_marks WHERE name = 'group-hosts-from-items'").run();
    db.close();
    db = openDb(join(dir, 'test.db'));
    expect(db.prepare('SELECT host FROM site_group_hosts WHERE group_id = ?').all(g)).toEqual([{ host: 'fccoins.co.uk' }]);
  });

  it('коротко, что купили', () => {
    const it = (query: string, qty: number, kind: 'anchor' | 'naked' = 'anchor') => ({ id: 1, groupId: 1, siteUrl: 's', query, page: 'p', position: null, impressions: null, clicks: null, ctr: null, addedAt: 0, qty, kind });
    expect(itemsLabel([it('a', 1), it('b', 3), it('c', 1), it('d', 1), it('e', 1), it('', 2, 'naked')])).toBe('b ×3, a, c, d, ещё 1, безанкор ×2');
  });
});

describe('до и после закупки', () => {
  it('окна: 7 дней до, после — со следующего дня по последний полный день (до 28)', () => {
    const now = Date.parse('2026-11-12T12:00:00Z'); // последний полный день Google — 11.11
    expect(windows('2026-11-10', now)).toEqual({
      before: { start: '2026-11-03', end: '2026-11-09', days: 7 },
      after: { start: '2026-11-11', end: '2026-11-11', days: 1 }
    });
    expect(windows('2026-11-11', now).after).toBeNull(); // ещё рано
    expect(windows('2026-09-01', now).after).toEqual({ start: '2026-09-02', end: '2026-09-29', days: 28 });
  });
  it('сумма окна: позиция — средняя по показам', () => {
    const rows = [
      { date: '2026-11-03', clicks: 1, impressions: 10, position: 20 },
      { date: '2026-11-04', clicks: 0, impressions: 30, position: 10 },
      { date: '2026-11-11', clicks: 5, impressions: 40, position: 5 }
    ];
    expect(sumWindow(rows, { start: '2026-11-03', end: '2026-11-09', days: 7 })).toEqual({ clicks: 1, impressions: 40, position: 12.5 });
    expect(sumWindow(rows, { start: '2026-11-12', end: '2026-11-20', days: 9 })).toEqual({ clicks: 0, impressions: 0, position: null });
  });
});
