import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { listSiteGroups } from '../src/lib/server/site-groups';
import {
  addManualSites,
  listManualSites,
  removeManualSite,
  createCampaign,
  listCampaigns,
  campaignNameFor,
  setCampaignFixed,
  deleteCampaign,
  addLink,
  listLinks,
  setLinkQty,
  removeLink,
  linkHistory,
  campaignCsv,
  linkText
} from '../src/lib/server/manual-sites';

describe('сайты без консоли', () => {
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

  it('домены списком: адреса и www приводятся к домену, повторы и мусор отдельно', () => {
    const r = addManualSites(db, 'https://www.coins-shop.de/\ncoins-shop.de, fifa-münzen.de\nпривет');
    expect(r.added).toEqual(['coins-shop.de', new URL('https://fifa-münzen.de/').hostname]);
    expect(r.existed).toEqual([]);
    expect(r.rejected).toEqual(['привет']);
    expect(addManualSites(db, 'coins-shop.de').existed).toEqual(['coins-shop.de']);
    expect(listManualSites(db).map((s) => s.host)).toEqual(['coins-shop.de', new URL('https://fifa-münzen.de/').hostname]);
  });

  it('кампания по дате: название из даты, повтор — отказ', () => {
    expect(campaignNameFor('2026-11-12')).toBe('12-11-26');
    const id = createCampaign(db, '2026-11-12');
    expect(listCampaigns(db)[0]).toMatchObject({ id, name: '12-11-26', date: '2026-11-12', fixedAt: null, rows: 0, links: 0 });
    expect(() => createCampaign(db, '2026-11-12')).toThrow(/уже есть/);
    createCampaign(db, '2026-11-12', 'Вторая 12-11');
    createCampaign(db, '2026-10-01');
    expect(listCampaigns(db).map((c) => c.date)).toEqual(['2026-11-12', '2026-11-12', '2026-10-01']);
    expect(() => createCampaign(db, '2026-02-30')).toThrow(/дату/);
  });

  it('ключи и страницы руками: путь, адрес, безанкор; повтор меняет количество', () => {
    addManualSites(db, 'coins-shop.de');
    const c = createCampaign(db, '2026-11-12');
    expect(addLink(db, c, { host: 'coins-shop.de', type: 'anchor', anchor: ' fut  coins ', page: '/fut-coins/', qty: 5 })).toEqual({ prev: null });
    addLink(db, c, { host: 'coins-shop.de', type: 'anchor', anchor: 'buy fut coins', page: 'coins-shop.de', qty: 2 });
    addLink(db, c, { host: 'coins-shop.de', type: 'domain', page: '/', qty: 3 });
    expect(addLink(db, c, { host: 'coins-shop.de', type: 'anchor', anchor: 'fut coins', page: 'https://coins-shop.de/fut-coins/', qty: 7 })).toEqual({ prev: 5 });
    const links = listLinks(db, c);
    expect(links.map((l) => [l.page, linkText(l), l.qty])).toEqual([
      ['https://coins-shop.de/fut-coins/', 'fut coins', 7],
      ['https://coins-shop.de/', 'buy fut coins', 2],
      ['https://coins-shop.de/', 'coins-shop.de', 3]
    ]);
    expect(listCampaigns(db)[0]).toMatchObject({ rows: 3, links: 12 });
  });

  it('ссылка только на сайт из списка и только на его страницы', () => {
    addManualSites(db, 'coins-shop.de');
    const c = createCampaign(db, '2026-11-12');
    expect(() => addLink(db, c, { host: 'other.de', type: 'anchor', anchor: 'k', page: '/', qty: 1 })).toThrow(/из списка/);
    expect(() => addLink(db, c, { host: 'coins-shop.de', type: 'anchor', anchor: 'k', page: 'https://other.de/', qty: 1 })).toThrow(/coins-shop.de/);
    expect(() => addLink(db, c, { host: 'coins-shop.de', type: 'anchor', anchor: '  ', page: '/', qty: 1 })).toThrow(/ключ/);
    expect(() => addLink(db, c, { host: 'coins-shop.de', type: 'anchor', anchor: 'k', page: '/', qty: 0 })).toThrow(/шт/);
  });

  it('зафиксированная — куплено: не меняется, не удаляется, попадает в историю сайта', () => {
    addManualSites(db, 'coins-shop.de\nfut-store.at');
    const old = createCampaign(db, '2026-10-01');
    const c = createCampaign(db, '2026-11-12');
    expect(() => setCampaignFixed(db, c, true)).toThrow(/нет ссылок/);
    addLink(db, old, { host: 'coins-shop.de', type: 'anchor', anchor: 'fut coins', page: '/', qty: 4 });
    addLink(db, c, { host: 'coins-shop.de', type: 'anchor', anchor: 'fut coins', page: '/', qty: 5 });
    addLink(db, c, { host: 'fut-store.at', type: 'url', page: '/', qty: 1 });
    setCampaignFixed(db, old, true);
    const id = listLinks(db, old)[0].id;
    expect(() => setLinkQty(db, old, id, 9)).toThrow(/зафиксирована/);
    expect(() => removeLink(db, old, id)).toThrow(/зафиксирована/);
    expect(() => addLink(db, old, { host: 'fut-store.at', type: 'url', page: '/', qty: 1 })).toThrow(/зафиксирована/);
    expect(() => deleteCampaign(db, old)).toThrow(/зафиксирована/);

    const shop = listManualSites(db).find((s) => s.host === 'coins-shop.de')!;
    expect(shop).toMatchObject({ bought: 4, planned: 5, lastDate: '2026-10-01' });
    setCampaignFixed(db, c, true);
    expect(listManualSites(db).find((s) => s.host === 'coins-shop.de')).toMatchObject({ bought: 9, planned: 0, lastDate: '2026-11-12' });

    const h = linkHistory(db);
    expect(h.map((x) => [x.date, x.campaignName, x.host, x.qty])).toEqual([
      ['2026-11-12', '12-11-26', 'coins-shop.de', 5],
      ['2026-11-12', '12-11-26', 'fut-store.at', 1],
      ['2026-10-01', '01-10-26', 'coins-shop.de', 4]
    ]);
    expect(h.every((x) => x.fixedAt)).toBe(true);
  });

  it('сайт с ссылками из списка не убирается; без ссылок — убирается', () => {
    addManualSites(db, 'coins-shop.de\nempty.de');
    const c = createCampaign(db, '2026-11-12');
    addLink(db, c, { host: 'coins-shop.de', type: 'anchor', anchor: 'k', page: '/', qty: 1 });
    expect(() => removeManualSite(db, 'coins-shop.de')).toThrow(/есть ссылки/);
    removeManualSite(db, 'empty.de');
    expect(listManualSites(db).map((s) => s.host)).toEqual(['coins-shop.de']);
  });

  it('не смешивается с группами сайтов консолей', () => {
    addManualSites(db, 'coins-shop.de');
    createCampaign(db, '2026-11-12');
    expect(listSiteGroups(db)).toEqual([]);
  });

  it('удаление открытой кампании убирает её ссылки', () => {
    addManualSites(db, 'coins-shop.de');
    const c = createCampaign(db, '2026-11-12');
    addLink(db, c, { host: 'coins-shop.de', type: 'anchor', anchor: 'k', page: '/', qty: 1 });
    deleteCampaign(db, c);
    expect(linkHistory(db)).toEqual([]);
    expect(listCampaigns(db)).toEqual([]);
  });

  it('CSV ТЗ: тип, текст безанкорной ссылки, формулы обезврежены', () => {
    addManualSites(db, 'coins-shop.de');
    const c = createCampaign(db, '2026-11-12');
    addLink(db, c, { host: 'coins-shop.de', type: 'anchor', anchor: '=fut coins', page: '/', qty: 2 });
    addLink(db, c, { host: 'coins-shop.de', type: 'domain', page: '/', qty: 1 });
    const csv = campaignCsv({ name: '12-11-26', date: '2026-11-12' }, listLinks(db, c));
    const rows = csv.replace('﻿', '').trim().split('\r\n');
    expect(rows[0]).toBe('Кампания;Дата;Сайт;Тип;Страница;Анкор;Кол-во ссылок;Язык;Гео');
    expect(rows[1]).toBe("12-11-26;2026-11-12;coins-shop.de;Анкор;https://coins-shop.de/;'=fut coins;2;;");
    expect(rows[2]).toBe('12-11-26;2026-11-12;coins-shop.de;Безанкор (домен);https://coins-shop.de/;coins-shop.de;1;;');
  });
});
