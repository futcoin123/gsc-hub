// «Ключи карты»: ключ карты → сайт по карте, позиция, мои другие сайты, закупки.
import { describe, it, expect } from 'vitest';
import { joinMapKeys } from '../src/lib/server/map-keys';
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
      ['futcoins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 18, 5)]],
      ['fut coins', [o('futcoins.co.uk', 'https://futcoins.co.uk/', 12, 40), o('fccoins.co.uk', 'https://fccoins.co.uk/', 8, 30), o('futcoin.es', 'https://futcoin.es/', 3, 9)]],
      ['cheap fut coins', [o('fut-coins.co.uk', 'https://fut-coins.co.uk/cheap-fut-coins-uk/', 6), o('futcoins.co.uk', 'https://futcoins.co.uk/fut-coin/', 15)]]
    ]),
    links: new Map([
      ['futcoins', [l('futcoins.co.uk', 5, true, 100), l('futcoins.co.uk', 3, false), l('fccoins.co.uk', 2, true)]]
    ]),
    geos: new Map([['futcoins.co.uk', ['gbr']], ['fccoins.co.uk', ['gbr']], ['fut-coins.co.uk', ['gbr']], ['futcoin.es', ['esp']]]),
    consoleHosts: new Set(['futcoins.co.uk', 'fccoins.co.uk', 'fut-coins.co.uk', 'futcoin.es'])
  });
  const row = (key: string) => rows.find((r) => r.key === key)!;

  it('по частоте; позиция — по ключу и его вариантам; другие сайты только той же страны', () => {
    expect(rows.map((r) => r.key)).toEqual(['futcoins', 'fc coins', 'cheap fut coins']);
    expect(row('futcoins')).toMatchObject({ host: 'futcoins.co.uk', position: 12, impressions: 40, rankPage: '/', ahrefs: 500 });
    expect(row('futcoins').rivals).toEqual([{ host: 'fccoins.co.uk', page: '/', position: 8, impressions: 30, clicks: 0, mapRole: null, above: true }]);
    expect(row('futcoins').flags).toEqual(['rival-above']);
  });

  it('закупки: куплено, в плане, дата; на другие сайты — отдельно', () => {
    expect(row('futcoins')).toMatchObject({ bought: 5, planned: 3, lastBuy: 100, boughtElsewhere: [{ host: 'fccoins.co.uk', qty: 2 }] });
  });

  it('Google ставит другую страницу; выше — сайт, у которого это главный ключ', () => {
    const r = row('cheap fut coins');
    expect(r.flags).toEqual(['rival-above', 'other-page']);
    expect(r.rankPage).toBe('/fut-coin/');
    expect(r.rivals[0]).toMatchObject({ host: 'fut-coins.co.uk', mapRole: 'main', above: true });
  });

  it('сайта нет в Search Console — отдельная пометка, не «нет в Google»', () => {
    expect(row('fc coins')).toMatchObject({ position: null, flags: ['no-console'] });
  });
});
