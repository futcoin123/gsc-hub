import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { createSiteGroup, setSiteGroupHosts, setHostDone, listSiteGroups, deleteSiteGroup } from '../src/lib/server/site-groups';
import {
  todayGroupName,
  addGroupItem,
  removeGroupItem,
  listGroupItems,
  setGroupFixed,
  itemMarks,
  groupItemsCsv,
  setItemQty,
  addNakedItem,
  siteHistory
} from '../src/lib/server/group-items';

const item = (q: string, page = 'https://a.com/p/', site = 'sc-domain:a.com') => ({
  siteUrl: site, query: q, page, position: 7.3, impressions: 23, clicks: 1, ctr: 0.043
});

describe('ключи группы (закупка)', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 't.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('название на сегодня — ДД-ММ-ГГ', () => {
    expect(todayGroupName(new Date(2026, 9, 28))).toBe('28-10-26');
    expect(todayGroupName(new Date(2027, 0, 5))).toBe('05-01-27');
  });

  it('добавление без повторов и удаление', () => {
    const g = createSiteGroup(db, '28-10-26');
    addGroupItem(db, g, item('wingaga promo kód'));
    addGroupItem(db, g, item('wingaga promo kód'));
    addGroupItem(db, g, item('wingaga bonus'));
    expect(listGroupItems(db, g)).toHaveLength(2);
    expect(listSiteGroups(db)[0].items).toBe(2);
    removeGroupItem(db, g, 'https://a.com/p/', 'wingaga bonus');
    expect(listGroupItems(db, g).map((i) => i.query)).toEqual(['wingaga promo kód']);
  });

  it('зафиксированную группу менять нельзя, после открытия — можно', () => {
    const g = createSiteGroup(db, 'A');
    addGroupItem(db, g, item('k1'));
    setGroupFixed(db, g, true);
    expect(listSiteGroups(db)[0].fixedAt).toBeTypeOf('number');
    expect(() => addGroupItem(db, g, item('k2'))).toThrow(/зафиксирована/);
    expect(() => removeGroupItem(db, g, 'https://a.com/p/', 'k1')).toThrow(/зафиксирована/);
    setGroupFixed(db, g, false);
    addGroupItem(db, g, item('k2'));
    expect(listGroupItems(db, g)).toHaveLength(2);
  });

  it('«Пройден» у сайта и сохранение отметки при смене состава', () => {
    const g = createSiteGroup(db, 'A');
    setSiteGroupHosts(db, g, ['a.com', 'b.com']);
    setHostDone(db, g, 'https://www.a.com/', true);
    expect(listSiteGroups(db)[0].done).toEqual(['a.com']);
    setSiteGroupHosts(db, g, ['a.com', 'c.com']);
    expect(listSiteGroups(db)[0]).toMatchObject({ hosts: ['a.com', 'c.com'], done: ['a.com'] });
    expect(() => setHostDone(db, g, 'zzz.com', true)).toThrow(/нет в группе/);
    setHostDone(db, g, 'a.com', false);
    expect(listSiteGroups(db)[0].done).toEqual([]);
  });

  it('пометки: все группы связки, от старых к новым, с фильтром по сайту', () => {
    const a = createSiteGroup(db, '01-10-26');
    const b = createSiteGroup(db, '28-10-26');
    addGroupItem(db, a, item('k1'));
    addGroupItem(db, b, item('k1'));
    addGroupItem(db, b, item('k9', 'https://b.com/', 'https://b.com/'));
    const marks = itemMarks(db, 'sc-domain:a.com');
    expect(Object.keys(marks)).toEqual(['https://a.com/p/\nk1']);
    expect(marks['https://a.com/p/\nk1'].map((m) => m.name)).toEqual(['01-10-26', '28-10-26']);
    expect(Object.keys(itemMarks(db))).toHaveLength(2);
  });

  it('удаление группы удаляет её ключи', () => {
    const g = createSiteGroup(db, 'A');
    addGroupItem(db, g, item('k1'));
    deleteSiteGroup(db, g);
    expect(itemMarks(db)).toEqual({});
  });

  it('CSV для Excel: BOM, «;», без исполнения формул', () => {
    const g = createSiteGroup(db, '28-10-26');
    addGroupItem(db, g, item('=HYPERLINK("x")'));
    const csv = groupItemsCsv('28-10-26', listGroupItems(db, g));
    expect(csv.startsWith('﻿')).toBe(true);
    const [head, row] = csv.slice(1).split('\r\n');
    expect(head).toBe('Группа;Сайт;Язык;Гео;Тип;Анкор;Страница;Кол-во ссылок;Позиция;Показы;Клики;CTR %');
    expect(row).toBe('28-10-26;sc-domain:a.com;;;Анкор;"\'=HYPERLINK(""x"")";https://a.com/p/;1;7,3;23;1;4,3');
  });

  it('количество ссылок: по умолчанию 1, меняется, ограничено 1..1000', () => {
    const g = createSiteGroup(db, 'A');
    addGroupItem(db, g, { ...item('k1'), qty: 3 });
    addGroupItem(db, g, item('k2'));
    expect(listGroupItems(db, g).map((i) => [i.query, i.qty])).toEqual([['k1', 3], ['k2', 1]]);
    setItemQty(db, g, 'https://a.com/p/', 'k2', 5);
    setItemQty(db, g, 'https://a.com/p/', 'k1', 0);
    expect(listGroupItems(db, g).map((i) => i.qty)).toEqual([1, 5]);
    setItemQty(db, g, 'https://a.com/p/', 'k1', 99999);
    expect(listGroupItems(db, g)[0].qty).toBe(1000);
    expect(itemMarks(db)['https://a.com/p/\nk2'][0].qty).toBe(5);
  });

  it('безанкорные: повтор той же страницы прибавляет, нужен полный адрес', () => {
    const g = createSiteGroup(db, 'A');
    addNakedItem(db, g, 'sc-domain:a.com', 'https://a.com/', 2);
    addNakedItem(db, g, 'sc-domain:a.com', 'https://a.com/', 3);
    expect(() => addNakedItem(db, g, 'sc-domain:a.com', 'a.com', 1)).toThrow(/https/);
    const [n] = listGroupItems(db, g);
    expect(n).toMatchObject({ kind: 'naked', query: '', page: 'https://a.com/', qty: 5 });
    // Пометка безанкорной ссылки — с пустым ключом: с ключами не путается.
    expect(Object.keys(itemMarks(db))).toEqual(['https://a.com/\n']);
    const csv = groupItemsCsv('A', listGroupItems(db, g)).slice(1).split('\r\n')[1];
    expect(csv).toBe('A;sc-domain:a.com;;;Безанкор (URL);https://a.com/;https://a.com/;5;;;;');
  });

  it('безанкорные двух видов: полный адрес и просто домен — разные строки', () => {
    const g = createSiteGroup(db, 'A');
    addNakedItem(db, g, 'sc-domain:a.com', 'https://a.com/', 2, 'url');
    addNakedItem(db, g, 'sc-domain:a.com', 'https://a.com/', 1, 'domain');
    addNakedItem(db, g, 'sc-domain:a.com', 'https://a.com/it/', 1, 'domain');
    const rows = listGroupItems(db, g);
    expect(rows.map((r) => [r.page, r.query, r.qty])).toEqual([
      ['https://a.com/', '', 2],
      ['https://a.com/', '[домен]', 1],
      ['https://a.com/it/', '[домен]', 1]
    ]);
    const csv = groupItemsCsv('A', rows).slice(1).split('\r\n');
    expect(csv[2]).toBe('A;sc-domain:a.com;;;Безанкор (домен);a.com;https://a.com/;1;;;;');
    expect(csv[3]).toBe('A;sc-domain:a.com;;;Безанкор (домен);a.com/it/;https://a.com/it/;1;;;;');
  });

  it('история сайта: все группы, новые сверху, только этот сайт', () => {
    const a = createSiteGroup(db, '01-10-26');
    addGroupItem(db, a, item('k1'));
    const b = createSiteGroup(db, '28-10-26');
    addNakedItem(db, b, 'sc-domain:a.com', 'https://a.com/', 2);
    addGroupItem(db, b, item('k9', 'https://b.com/', 'https://b.com/'));
    setGroupFixed(db, a, true);
    const h = siteHistory(db, 'sc-domain:a.com');
    expect(h.map((x) => [x.groupName, x.kind, x.qty])).toEqual([['28-10-26', 'naked', 2], ['01-10-26', 'anchor', 1]]);
    expect(h[1].fixedAt).toBeTypeOf('number');
  });
});

import { groupOverlaps, linksByQuery } from '../src/lib/server/group-items';

describe('пересечения ключей между сайтами', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 't.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('ключ у двух сайтов в группе — пересечение с количеством по сайтам', () => {
    const g = createSiteGroup(db, '28-10-26');
    addGroupItem(db, g, { ...item('Cricket Road Game', 'https://cricket-road.app/game/', 'https://cricket-road.app/'), qty: 20 });
    addGroupItem(db, g, { ...item('cricket road game', 'https://www.cricket-road.games/', 'sc-domain:cricket-road.games'), qty: 5 });
    addGroupItem(db, g, item('только один сайт'));
    const o = groupOverlaps(listGroupItems(db, g));
    expect(o).toEqual([{ query: 'Cricket Road Game', sites: [{ host: 'cricket-road.app', qty: 20 }, { host: 'cricket-road.games', qty: 5 }] }]);
  });

  it('ссылки по ключу на всех сайтах, без учёта регистра и диакритики', () => {
    const a = createSiteGroup(db, 'A');
    addGroupItem(db, a, { ...item('código bono', 'https://x.co/p', 'https://x.co/'), qty: 3 });
    addNakedItem(db, a, 'https://x.co/', 'https://x.co/', 9);
    const m = linksByQuery(db);
    expect(m.get('codigo bono')).toMatchObject([{ host: 'x.co', groupName: 'A', qty: 3 }]);
    expect(m.has('')).toBe(false);
  });
});
