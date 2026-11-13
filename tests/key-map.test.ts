import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { importKeyMap, keyMapFor, keyMapAll, keyMapPublicInfo, decryptKeyMap } from '../src/lib/server/key-map';
import { keyMarker, missingKeys, mapSummary, mainLabel, type MapPage } from '../src/lib/utils/key-map';
import { buildKeyMap, encryptKeyMap, readMapHtml } from '../scripts/key-map.mjs';

// Кусок данных «Карты ключей FUT» в том виде, как он лежит в странице карты.
const DATA = {
  updated: '2026-11-09',
  countries: [
    {
      id: 'DE',
      groups: [
        { id: 'П-002', h: 'fifa coins kaufen', r: [['fifa coins kaufen'], ['fifa coin kaufen'], ['coins kaufen fifa']] },
        { id: 'П-010', h: 'ea fc coins', r: [['ea fc coins'], ['coins ea fc']] }
      ],
      pages: [
        { site: 'fut-coin.de', url: '/', key: 'fifa coins kaufen', role: 'основной', group: 'fifa coins kaufen', gid: 'П-002' },
        { site: 'fut-coin.de', url: '/fifa-coins/', key: 'fifa coins', role: 'второстепенный', group: 'fifa coins', gid: null },
        { site: 'fut-coin.de', url: '/kontakt/', key: '', role: 'служебная', group: '', gid: null },
        { site: 'buy-fut-coins.com', url: '/de/', key: 'ea fc coins', role: 'основной', group: 'ea fc coins', gid: 'П-010' },
        { site: 'будущий сайт', url: '—', key: 'fut coins kaufen', role: 'основной (бронь владелицы 06.11.2026)', group: '', gid: 'П-015' }
      ],
      plan: {
        rows: [
          // Внесена на сайт — берём, вместе с вариантами.
          { site: 'fut-coin.de', status: 'есть, открыт', url: '/fc-27-web-app/', kind: 'гайд', todo: 'внесено на сайт 09.11.2026', main: 'fc 27 web app', group: 'web app fc 27', variants: ['fc web app 27'] },
          // Адрес на сайте — в скобках.
          { site: 'buy-fut-coins.com/de', status: 'есть, открыт', url: '/buy-ea-fc-27-coins/', kind: 'внутренняя', todo: 'новая страница — сделана 09.11.2026 (/de/buy-ea-fc-27-coins/)', main: 'buy ea fc 27 coins', group: '', variants: [] },
          // Папка сайта дописывается к адресу.
          { site: 'buy-fut-coins.com/de', status: 'есть, открыт', url: '/fc-coins/', kind: 'внутренняя', todo: 'внесено на сайт 09.11.2026', main: 'fc coins', group: '', variants: [] },
          // Новые сайты и невнесённые правки — нет.
          { site: 'Новый сайт 1', status: 'новый, волна 1', url: '/', kind: 'главная', todo: 'новый сайт', main: 'fut coins kaufen', group: '', variants: [] },
          { site: 'fut-coin.de', status: 'есть, открыт', url: '/later/', kind: 'внутренняя', todo: 'дописать H2', main: 'later key', group: '', variants: [] }
        ]
      }
    },
    { id: 'NL', groups: [], pages: [{ site: 'futcoins.eu/nl', url: '/nl/', key: 'fifa coins', role: 'основной', group: '', gid: null }], plan: { rows: [] } },
    { id: 'PL', groups: [], pages: [{ site: 'futcoins.eu/pl', url: '/pl/fifa-coins/', key: 'fifa coins', role: 'второстепенный', group: '', gid: null }], plan: { rows: [] } }
  ]
};

describe('«Карта ключей FUT» → карта хаба', () => {
  const map = buildKeyMap(DATA);

  it('берёт основной и второстепенные ключи сайтов, без служебных страниц, брони и новых сайтов', () => {
    expect(Object.keys(map.hosts)).toEqual(['buy-fut-coins.com', 'fut-coin.de', 'futcoins.eu']);
    const fc = map.hosts['fut-coin.de'];
    expect(fc.map((p: MapPage) => [p.url, p.key, p.role])).toEqual([
      ['/', 'fifa coins kaufen', 'main'],
      ['/fc-27-web-app/', 'fc 27 web app', 'secondary'],
      ['/fifa-coins/', 'fifa coins', 'secondary']
    ]);
    expect(fc[0].alts).toEqual(['fifa coin kaufen', 'coins kaufen fifa']);
    expect(fc[1].alts).toEqual(['fc web app 27']);
  });

  it('страницы сайта в папке получают полный адрес', () => {
    expect(map.hosts['buy-fut-coins.com'].map((p: MapPage) => p.url)).toEqual(['/de/', '/de/buy-ea-fc-27-coins/', '/de/fc-coins/']);
  });

  it('читает данные из сохранённой страницы карты', () => {
    const html = `<html><script id="data" type="application/json">${JSON.stringify(DATA)}</script></html>`;
    expect(readMapHtml(html).updated).toBe('2026-11-09');
    expect(() => readMapHtml('<html></html>')).toThrow(/нет данных карты/);
  });
});

describe('пометки у ключей', () => {
  const pages: MapPage[] = [
    { country: 'NL', url: '/nl/', key: 'fifa coins', role: 'main', alts: [] },
    { country: 'PL', url: '/pl/fifa-coins/', key: 'fifa coins', role: 'secondary', alts: [] },
    { country: 'DE', url: '/', key: 'fifa coins kaufen', role: 'main', alts: ['fifa coin kaufen'] },
    { country: 'DE', url: '/x/', key: 'fc 27 web app', role: 'secondary', alts: [] }
  ];
  const mark = keyMarker(pages);

  it('та же фраза, вариант из группы и те же слова в другом порядке', () => {
    expect(mark('FIFA Coins Kaufen')).toMatchObject({ role: 'main', same: true });
    expect(mark('fifa coin kaufen')).toMatchObject({ role: 'main', same: false });
    expect(mark('web app fc 27')).toMatchObject({ role: 'secondary', same: false });
    expect(mark('fifa coins kaufen ps5')).toBeNull();
  });

  it('главный ключ важнее второстепенного', () => {
    expect(mark('fifa coins')?.role).toBe('main');
  });

  it('сводка и ключи без показов', () => {
    expect(mapSummary(pages)).toEqual({
      main: [
        { key: 'fifa coins', geo: 'Netherlands', cc: 'NL', url: '/nl/' },
        { key: 'fifa coins kaufen', geo: 'Germany', cc: 'DE', url: '/' }
      ],
      secondary: 2
    });
    expect(mainLabel(mapSummary(pages).main[0], true)).toBe('fifa coins (NL)');
    expect(mainLabel(mapSummary(pages).main[0], false)).toBe('fifa coins');
    expect(missingKeys(pages, ['fifa coin kaufen', 'fifa coins']).map((p) => p.url)).toEqual(['/x/']);
  });
});

describe('зашифрованная карта в хабе', () => {
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

  const page = (key: string, role: 'main' | 'secondary' = 'main'): MapPage => ({ country: 'DE', url: '/', key, role, alts: [] });

  it('расшифровывает своим ключом и берёт сайты в базу', () => {
    const { publicKey } = keyMapPublicInfo(db);
    const enc = encryptKeyMap({ mapUpdated: '2026-11-09', hosts: { 'fut-coin.de': [page('fifa coins kaufen')] } }, publicKey);
    expect(JSON.stringify(enc)).not.toContain('fifa');
    expect(importKeyMap(db, enc)).toBe(1);
    expect(keyMapFor(db, 'www.fut-coin.de')?.[0].key).toBe('fifa coins kaufen');
    expect(keyMapFor(db, 'futcoin.eu')).toBeNull();
    expect(keyMapPublicInfo(db)).toMatchObject({ hosts: 1, mapUpdated: '2026-11-09', mapHash: enc.hash });
  });

  it('уже взятый сайт не меняется, новые добавляются', () => {
    const { publicKey } = keyMapPublicInfo(db);
    importKeyMap(db, encryptKeyMap({ mapUpdated: '2026-11-09', hosts: { 'fut-coin.de': [page('fifa coins kaufen')] } }, publicKey));
    const next = encryptKeyMap({ mapUpdated: '2026-11-12', hosts: { 'fut-coin.de': [page('другой ключ')], 'futcoin.eu': [page('fut coins')] } }, publicKey);
    expect(importKeyMap(db, next)).toBe(1);
    expect(keyMapFor(db, 'fut-coin.de')?.[0].key).toBe('fifa coins kaufen');
    expect(keyMapFor(db, 'futcoin.eu')?.[0].key).toBe('fut coins');
    expect([...keyMapAll(db).keys()].sort()).toEqual(['fut-coin.de', 'futcoin.eu']);
    // Та же карта второй раз — ничего не делаем.
    expect(importKeyMap(db, next)).toBe(0);
  });

  it('ключи темы берутся из каждой новой карты целиком', async () => {
    const { keyMapTopics } = await import('../src/lib/server/key-map');
    const { publicKey } = keyMapPublicInfo(db);
    importKeyMap(db, encryptKeyMap({ mapUpdated: '2026-11-09', hosts: { 'futcoin.it': [page('crediti fc 27')] }, topics: { IT: ['crediti fc 27', 'futcoin'] } }, publicKey));
    expect(keyMapTopics(db)).toEqual({ IT: ['crediti fc 27', 'futcoin'] });
    importKeyMap(db, encryptKeyMap({ mapUpdated: '2026-11-13', hosts: { 'futcoin.it': [page('crediti fc 27')] }, topics: { IT: ['fc 27 coins'], ES: ['monedas fc 27'] } }, publicKey));
    expect(keyMapTopics(db)).toEqual({ IT: ['fc 27 coins'], ES: ['monedas fc 27'] });
  });

  it('карта под чужим ключом или пустая — не берётся', () => {
    const other = openDb(join(dir, 'other.db'));
    const enc = encryptKeyMap({ mapUpdated: null, hosts: { 'fut-coin.de': [page('x')] } }, keyMapPublicInfo(other).publicKey);
    other.close();
    expect(decryptKeyMap(db, enc)).toBeNull();
    expect(importKeyMap(db, enc)).toBeNull();
    expect(importKeyMap(db, { v: 0 })).toBeNull();
    expect(keyMapAll(db).size).toBe(0);
  });
});

describe('ключи темы по странам (для «Ключей гео» в ТЗ)', () => {
  it('коммерческие группы о монетах, от частых к редким, без прошлых сезонов', async () => {
    const { buildTopics } = await import('../scripts/key-map.mjs');
    const g = (h: string, s: number, k = 'com', t = 'Монеты') => ({ h, s, k, t });
    const data = { countries: [{ id: 'IT', groups: [g('crediti fc 26', 1300), g('crediti fc 27', 1740), g('Futcoin', 590), g('fifa coins 26', 500), g('come fare crediti', 900, 'info', 'Заработать монеты'), g('fc 27 web app', 800, 'com', 'Web App'), g('600k fifa coins', 300, 'com', 'Монеты: сумма'), g('crediti fc 27', 10)] }] };
    expect(buildTopics(data)).toEqual({ IT: ['crediti fc 27', 'futcoin', '600k fifa coins'] });
  });
});
