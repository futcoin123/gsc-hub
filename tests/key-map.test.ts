import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { importKeyMap, keyMapFor, keyMapAll, keyMapPublicInfo, decryptKeyMap } from '../src/lib/server/key-map';
import { keyMarker, missingKeys, mapSummary, mainLabel, type MapPage, type MapKey } from '../src/lib/utils/key-map';
import { buildKeyMap, buildHeadline, encryptKeyMap, readMapHtml } from '../scripts/key-map.mjs';

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

  it('ключи без показов', () => {
    expect(missingKeys(pages, ['fifa coin kaufen', 'fifa coins']).map((p) => p.url)).toEqual(['/x/']);
  });
});

describe('строка сайта: главный и до 3 продающих второстепенных с запросами («Сент.»)', () => {
  // Строка группы: [ключ, сент., ср., Ahrefs, примечание, магазины, не серая, источник].
  const g = (id: string, h: string, k: 'com' | 'info', rows: unknown[][]) => ({ id, h, k, r: rows });
  const plan = (url: string, kind: string, main: string, group: string, sep: number, extra: Record<string, unknown> = {}) => ({ site: 'futcoins.co.uk', status: 'есть, открыт', url, kind, todo: 'внесено на сайт 09.11.2026', done: true, main, group, sep, avg: sep, variants: [], ...extra });
  const data = {
    countries: [
      {
        id: 'UK',
        groups: [
          g('П-007', 'fut coins', 'com', [['fut coins', 1650, 1660, 500, 10, '', 1, 'Ahrefs']]),
          g('П-035', 'fut coins cheap', 'com', [['cheap fut coins', 100, 160, 200, 10, '', 1, 'Ahrefs']]),
          g('П-114', 'fut coins pc', 'com', [['fut coins pc', 10, 20, 0, 10, '', 1, 'Ahrefs']]),
          g('П-115', 'fut coins xbox', 'com', [['fut coins xbox', 20, 20, 0, 10, '', 1, 'Ahrefs']]),
          g('И-388', 'fut coins ps5', 'info', [['fut coins ps5', 0, 10, 0, 10, '', 1, 'Ahrefs']]),
          g('И-001', 'fc 27 web app', 'info', [['fc 27 web app', 215090, 19250, 0, 10, '', 1, 'Ahrefs']]),
          g('И-110', 'comfort trade', 'info', [['comfort trade', 30, 20, 20, 10, '', 1, 'Ahrefs']]),
          g('П-090', 'fut coins sale', 'com', [['fut coins sale', 0, 10, 0, 10, '', 1, 'Ahrefs']]),
          g('П-002', 'fifa coins', 'com', [['fifa coins', 4400, 4000, 800, 10, '', 1, 'Ahrefs'], ['fifa coin', 4400, 4000, 0, 'Google: один запрос', '', 0, 'DataForSEO']])
        ],
        plan: {
          rows: [
            plan('/', 'главная', 'futcoins', 'fut coins', 1650),
            plan('/fut-coin/', 'внутренняя', 'fut coin', 'fut coins', 1650),
            plan('/cheap-fut-coins/', 'цены', 'cheap fut coins', 'fut coins cheap', 100),
            plan('/fut-coins-pc/', 'платформы', 'fut coins pc', 'fut coins pc', 10),
            plan('/fut-coins-xbox/', 'платформы', 'fut coins xbox', 'fut coins xbox', 20),
            // Инфо-страницы, гайды и ключи без запросов — нет.
            plan('/fut-coins-ps5/', 'платформы', 'fut coins ps5', 'fut coins ps5', 0),
            plan('/fc-27-web-app/', 'гайд', 'fc 27 web app', 'fc 27 web app', 215090),
            plan('/comfort-trade/', 'инструкция', 'comfort trade', 'comfort trade', 30),
            plan('/sale/', 'внутренняя', 'fut coins sale', 'fut coins sale', 0),
            // Страница ещё не сделана — нет.
            plan('/later/', 'внутренняя', 'fifa coins', 'fifa coins', 4400, { done: false })
          ]
        },
        pages: [
          // У сайта из «Плана» вид «Сайты» не используется.
          { site: 'futcoins.co.uk', url: '/x/', key: 'fifa coins', role: 'второстепенный', gid: 'П-002' },
          // Сайт без «Плана» — по виду «Сайты»: продающие (П-) с запросами, серая строка — как строка выше.
          { site: 'fccoinshub.co.uk', url: '/', key: 'fifa coin', role: 'основной', gid: 'П-002' },
          { site: 'fccoinshub.co.uk', url: '/cheap/', key: 'cheap fut coins', role: 'второстепенный', gid: 'П-035' },
          { site: 'fccoinshub.co.uk', url: '/app/', key: 'fc 27 web app', role: 'второстепенный', gid: 'И-001' }
        ]
      }
    ]
  };
  const h = buildHeadline(data);
  const row = (host: string) => h[host].map((k: MapKey) => [k.role, k.key, k.volume]);

  it('вид «План»: главный и до трёх продающих с запросами, по убыванию; гайды, инфо и нули — нет', () => {
    expect(row('futcoins.co.uk')).toEqual([
      ['main', 'futcoins', 1650],
      ['secondary', 'fut coin', 1650],
      ['secondary', 'cheap fut coins', 100],
      ['secondary', 'fut coins xbox', 20]
    ]);
    expect(h['futcoins.co.uk'][0]).toMatchObject({ country: 'UK', url: '/', avg: 1650 });
  });

  it('сайт без «Плана» — по виду «Сайты», цифра «Сент.» из группы', () => {
    expect(row('fccoinshub.co.uk')).toEqual([
      ['main', 'fifa coin', 4400],
      ['secondary', 'cheap fut coins', 100]
    ]);
  });

  it('сводка для строки сайта и подпись главного', () => {
    const keys: MapKey[] = [
      { country: 'NL', url: '/nl/', key: 'fifa coins', role: 'main', volume: 670, avg: 600 },
      { country: 'NL', url: '/nl/web/', key: 'fc coins', role: 'secondary', volume: 670, avg: 500 },
      { country: 'US', url: '/', key: 'fc coins for sale', role: 'main', volume: 30, avg: 20 }
    ];
    const s = mapSummary(keys);
    expect(s.main.map((m) => [m.key, m.cc, m.geo, m.volume])).toEqual([
      ['fifa coins', 'NL', 'Netherlands', 670],
      ['fc coins for sale', 'US', 'United States', 30]
    ]);
    expect(s.secondary.map((m) => [m.key, m.cc, m.volume])).toEqual([['fc coins', 'NL', 670]]);
    expect(mainLabel(s.main[0], true)).toBe('fifa coins (NL)');
    expect(mainLabel(s.main[0], false)).toBe('fifa coins');
    // Запись старой карты без цифр — 0, а не ошибка.
    expect(mapSummary([{ country: 'UK', url: '/', key: 'futcoins', role: 'main' } as unknown as MapKey]).main[0]).toMatchObject({ volume: 0, avg: 0 });
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

  it('главный и второстепенные для строки сайта — из каждой новой карты целиком, и у взятых сайтов', async () => {
    const { keyMapHeadline } = await import('../src/lib/server/key-map');
    const { publicKey } = keyMapPublicInfo(db);
    const k = (key: string, role: 'main' | 'secondary', volume: number) => ({ country: 'ES', url: '/', key, role, volume, avg: volume });
    importKeyMap(db, encryptKeyMap({ mapUpdated: '2026-11-09', hosts: { 'futcoin.es': [page('comprar monedas fc 27')] }, headline: { 'futcoin.es': [k('comprar monedas fc 27', 'main', 0)] } }, publicKey));
    expect(keyMapHeadline(db).get('futcoin.es')).toEqual([k('comprar monedas fc 27', 'main', 0)]);
    importKeyMap(db, encryptKeyMap({ mapUpdated: '2026-11-14', hosts: { 'futcoin.es': [page('comprar monedas fc 27')] }, headline: { 'www.futcoin.es': [k('comprar monedas fc 27', 'main', 590), k('monedas fc 27', 'secondary', 790)] } }, publicKey));
    expect(keyMapHeadline(db).get('futcoin.es')?.map((x) => [x.key, x.volume])).toEqual([['comprar monedas fc 27', 590], ['monedas fc 27', 790]]);
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
