import { describe, it, expect } from 'vitest';
import { checkoutLeads, checkoutSplit } from '../src/lib/utils/checkout-lead';

const pathOf = (u: string) => new URL(u).pathname;

describe('переходы к оплате — один раз на страницу', () => {
  // futcoin.nl: 1 переход на «/», у страницы шесть ключей — число только у одного.
  const rows = [
    { query: 'fifa coins kopen', page: 'https://futcoin.nl/', clicks: 5, impressions: 58 },
    { query: 'futcoin', page: 'https://futcoin.nl/', clicks: 5, impressions: 56 },
    { query: 'ea fc coins kopen', page: 'https://futcoin.nl/', clicks: 6, impressions: 32 },
    { query: 'fut coins kopen', page: 'https://futcoin.nl/', clicks: 4, impressions: 41 },
    { query: 'fc 27 coins', page: 'https://futcoin.nl/fc-27/', clicks: 0, impressions: 9 }
  ];

  it('ключ с наибольшими кликами, при равенстве — с показами', () => {
    const l = checkoutLeads(rows, pathOf);
    expect(l.get('/')).toBe('ea fc coins kopen');
    expect(l.get('/fc-27/')).toBe('fc 27 coins');
    expect(checkoutLeads(rows.filter((r) => r.query !== 'ea fc coins kopen'), pathOf).get('/')).toBe('fifa coins kopen');
  });

  it('итог делится на страницы с ключами и остальные', () => {
    expect(checkoutSplit({ '/': 1, '/checkout/': 6, '/fc-27/': 3 }, new Set(['/', '/fc-27/']))).toEqual({ withKeys: 4, other: 6 });
  });
});
