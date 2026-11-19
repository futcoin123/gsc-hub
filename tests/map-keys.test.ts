// «Ключи карты»: ключ карты → сайт по карте, позиция, мои другие сайты, закупки.
import { describe, it, expect } from 'vitest';
import { joinMapKeys, previousRange } from '../src/lib/server/map-keys';
import type { QueryOwner } from '../src/lib/server/google';
import type { QueryLink } from '../src/lib/server/group-items';
import type { MapKey, MapPage } from '../src/lib/utils/key-map';

const o = (host: string, page: string, position: number, impressions = 10, clicks = 0): QueryOwner => ({ host, siteUrl: `sc-domain:${host}`, page, accountId: 'a', position, impressions, clicks });
const l = (host: string, qty: number, fixed: boolean, at = 1): QueryLink => ({ host, groupId: 1, groupName: 'g', qty, at, itemId: 1, fixed });

const headline = new Map<string, MapKey[]>([
  ['futcoins.co.uk', [
    { country: 'UK', url: '/', key: 'futcoins', role: 'main', volume: 1650, avg: 1660, ahrefs: 500 },
    { country: 'UK', url: '/cheap-fut-coins/', key: 'cheap fut coins', role: 'secondary', volume: 100, avg: 160, ahrefs: 200 }
  ]],
  ['fc-coins.net', [{ country: 'US', url: '/', key: 'fc coins', role: 'main', volume: 1020, avg: 900, ahrefs: 900 }]]
]);
const pages = new Map<string, MapPage[]>([
  ['futcoins.co.uk', [{ country: 'UK', url: '/', key: 'futcoins', role: 'main', alts: ['fut coins'] }]],
  ['fut-coins.co.uk', [{ country: 'UK', url: '/cheap-fut-coins-uk/', key: 'cheap fut coins', role: 'main', alts: [] }]]
]);

describe('ключи карты', () => {
  const rows = joinMapKeys({
    headline,
    pages,
    owners: new Map([
      // «fut coins» — вариант «futcoins»: у futcoins.co.uk там больше показов.
      ['gbr\tfutcoins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 18, 5)]],
      ['gbr\tfut coins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 12, 40), o('fccoins.co.uk', 'https://fccoins.co.uk/', 8, 30)]],
      // futcoin.es 3-й — но в Испании: в британскую строку не попадает.
      ['esp\tfut coins', [o('futcoin.es', 'https://futcoin.es/', 3, 9)]],
      ['gbr\tcheap fut coins', [o('fut-coins.co.uk', 'https://fut-coins.co.uk/cheap-fut-coins-uk/', 6), { ...o('futcoins.co.uk', 'https://futcoins.co.uk/fut-coin/', 15, 30), pages: [{ page: 'https://futcoins.co.uk/fut-coin/', position: 15, impressions: 30, clicks: 0 }, { page: 'https://futcoins.co.uk/cheap-fut-coins/', position: 25, impressions: 4, clicks: 1 }] }]]
    ]),
    links: new Map([
      ['futcoins', [l('futcoins.co.uk', 5, true, 100), l('futcoins.co.uk', 3, false), l('fccoins.co.uk', 2, true)]]
    ]),
    geos: new Map([['futcoins.co.uk', ['gbr']], ['fccoins.co.uk', ['gbr']], ['fut-coins.co.uk', ['gbr']], ['futcoin.es', ['esp']]]),
    consoleHosts: new Set(['futcoins.co.uk', 'fccoins.co.uk', 'fut-coins.co.uk', 'futcoin.es']),
    siteUrls: new Map([['futcoins.co.uk', 'sc-domain:futcoins.co.uk']])
  });
  const row = (key: string) => rows.find((r) => r.key === key)!;

  it('по частоте; позиция — по ключу и его вариантам в стране ключа; другие сайты — только с показами в этой стране', () => {
    expect(rows.map((r) => r.key)).toEqual(['futcoins', 'fc coins', 'cheap fut coins']);
    expect(row('futcoins')).toMatchObject({ host: 'futcoins.co.uk', position: 12, impressions: 40, rankPage: '/', ahrefs: 500 });
    expect(row('futcoins').rivals).toEqual([{ host: 'fccoins.co.uk', page: '/', position: 8, impressions: 30, clicks: 0, mapRole: null, mapCountry: null, above: true }]);
    expect(row('futcoins').flags).toEqual(['rival-above']);
  });

  it('закупки: куплено, в плане, дата; на другие сайты — отдельно', () => {
    expect(row('futcoins')).toMatchObject({ bought: 5, planned: 3, lastBuy: 100, boughtElsewhere: [{ host: 'fccoins.co.uk', qty: 2 }] });
  });

  it('Google ставит другую страницу; выше — сайт, у которого это главный ключ', () => {
    const r = row('cheap fut coins');
    expect(r.flags).toEqual(['rival-above', 'other-page']);
    expect(r.rankPage).toBe('/fut-coin/');
    // Страница по карте тоже видна по ключу — её собственное место.
    expect(r.mapPage).toEqual({ position: 25, impressions: 4, clicks: 1 });
    expect(row('futcoins').mapPage).toBeNull();
    expect(r.rivals[0]).toMatchObject({ host: 'fut-coins.co.uk', mapRole: 'main', mapCountry: 'UK', above: true });
  });

  it('сайта нет в Search Console — отдельная пометка, не «нет в Google»', () => {
    expect(row('fc coins')).toMatchObject({ position: null, flags: ['no-console'] });
  });

  it('закупка: property сайта, страница по карте полным адресом, ключ с вариантами', () => {
    expect(row('futcoins')).toMatchObject({ siteUrl: 'sc-domain:futcoins.co.uk', page: 'https://futcoins.co.uk/', queries: ['futcoins', 'fut coins'] });
    // Страница по карте, а не та, что ставит Google.
    expect(row('cheap fut coins').page).toBe('https://futcoins.co.uk/cheap-fut-coins/');
    // Сайта нет в консоли — адрес как у сайтов «Без консоли».
    expect(row('fc coins')).toMatchObject({ siteUrl: 'https://fc-coins.net/', page: 'https://fc-coins.net/', queries: ['fc coins'] });
  });

  it('адрес страницы — с www, если Google показывает сайт с www', () => {
    const [r] = joinMapKeys({
      headline: new Map([['futcoin.at', [{ country: 'AT', url: '/fuer-playstation/', key: 'fifa coins ps5', role: 'secondary', volume: 30, avg: 30, ahrefs: null }]]]),
      pages: new Map(),
      owners: new Map([['aut\tfifa coins ps5', [o('futcoin.at', 'https://www.futcoin.at/', 8)]]]),
      links: new Map(),
      geos: null,
      consoleHosts: null
    });
    expect(r.page).toBe('https://www.futcoin.at/fuer-playstation/');
  });

  it('без прошлого отрезка сравнения нет', () => {
    expect(row('futcoins')).toMatchObject({ prevPosition: null, prevImpressions: 0 });
  });
});

describe('ключи карты: сравнение с прошлым отрезком', () => {
  it('«Сегодня» — со вчера, «Вчера» — с позавчера, 7 дней — с прошлыми 7', () => {
    expect(previousRange({ startDate: '2026-11-19', endDate: '2026-11-19', days: 1 })).toEqual({ startDate: '2026-11-18', endDate: '2026-11-18' });
    expect(previousRange({ startDate: '2026-11-18', endDate: '2026-11-18', days: 1 })).toEqual({ startDate: '2026-11-17', endDate: '2026-11-17' });
    expect(previousRange({ startDate: '2026-11-12', endDate: '2026-11-18', days: 7 })).toEqual({ startDate: '2026-11-05', endDate: '2026-11-11' });
  });

  const one = (input: Partial<Parameters<typeof joinMapKeys>[0]>) =>
    joinMapKeys({
      headline: new Map([['futcoins.co.uk', [{ country: 'UK', url: '/', key: 'futcoins', role: 'main', volume: 1650, avg: 1660, ahrefs: 500 }]]]),
      pages: new Map([['futcoins.co.uk', [{ country: 'UK', url: '/', key: 'futcoins', role: 'main', alts: ['fut coins'] }]]]),
      owners: new Map(),
      links: new Map(),
      geos: null,
      consoleHosts: null,
      ...input
    })[0];

  it('позиция за период и тогда — по ключу и вариантам, строка с большими показами', () => {
    const r = one({
      owners: new Map([['gbr\tfutcoins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 12, 40)]]]),
      prevOwners: new Map([
        ['gbr\tfutcoins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 18, 5)]],
        ['gbr\tfut coins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 15, 30), o('fccoins.co.uk', 'https://fccoins.co.uk/', 3, 9)]]
      ])
    });
    expect(r).toMatchObject({ position: 12, impressions: 40, prevPosition: 15, prevImpressions: 30 });
    // Другие сайты прошлого отрезка в «Мои другие сайты» не попадают.
    expect(r.rivals).toEqual([]);
  });

  it('выпал: тогда был, за период показов нет', () => {
    const r = one({ prevOwners: new Map([['gbr\tfutcoins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 9, 7)]]]) });
    expect(r).toMatchObject({ position: null, prevPosition: 9, flags: ['not-ranking'] });
  });

  it('другие сайты — из своего окна (7 дней), «выше» — к позиции за период', () => {
    const r = one({
      owners: new Map([['gbr\tfutcoins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 10, 40)]]]),
      rivalOwners: new Map([['gbr\tfutcoins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 20, 90), o('fccoins.co.uk', 'https://fccoins.co.uk/', 14, 30), o('futcoins.eu', 'https://futcoins.eu/', 6, 5)]]])
    });
    expect(r.position).toBe(10);
    expect(r.rivals.map((x) => [x.host, x.above])).toEqual([['futcoins.eu', true], ['fccoins.co.uk', false]]);
    expect(r.flags).toEqual(['rival-above']);
  });

  it('другой сайт выше в стране ключа, а по карте этот ключ у него — для другой страны', () => {
    const r = joinMapKeys({
      headline: new Map([['fut-coins.es', [{ country: 'ES', url: '/', key: 'fut coins', role: 'main', volume: 150, avg: 150, ahrefs: 150 }]]]),
      pages: new Map([['futcoins.co.uk', [{ country: 'UK', url: '/', key: 'futcoins', role: 'main', alts: ['fut coins'] }]]]),
      owners: new Map([['esp\tfut coins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 5.6), o('fut-coins.es', 'https://fut-coins.es/', 29.3)]]]),
      links: new Map(),
      geos: null,
      consoleHosts: null
    })[0];
    expect(r.rivals[0]).toMatchObject({ host: 'futcoins.co.uk', position: 5.6, mapRole: 'main', mapCountry: 'UK', above: true });
  });
});
