import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const calls: { dimensions: string[]; filters: unknown }[] = [];
vi.mock('../src/lib/server/google', () => ({
  listAllKnownSites: async () => ({ sites: [{ siteUrl: 'sc-domain:futcoins.eu', accountId: 'acc1' }], errors: [] }),
  searchAnalyticsQuery: async (_db: unknown, _acc: unknown, _site: string, body: { dimensions: string[]; dimensionFilterGroups?: unknown }) => {
    calls.push({ dimensions: body.dimensions, filters: body.dimensionFilterGroups });
    const d = body.dimensions.join(',');
    if (d === 'date') return [{ keys: ['2026-11-05'], clicks: 2, impressions: 100, position: 30 }, { keys: ['2026-11-11'], clicks: 6, impressions: 200, position: 20 }];
    if (d === 'query,page,date')
      return [
        // тот же анкор на странице другой страны — не должен попасть в /nl/
        { keys: ['fifa coins', 'https://futcoins.eu/pl/fifa-coins/', '2026-11-05'], clicks: 0, impressions: 50, position: 5 },
        { keys: ['fifa coins', 'https://futcoins.eu/nl/', '2026-11-05'], clicks: 0, impressions: 10, position: 40 },
        { keys: ['fifa coins', 'https://futcoins.eu/nl/#faq', '2026-11-11'], clicks: 1, impressions: 20, position: 25 }
      ];
    return [];
  }
}));
vi.mock('../src/lib/server/accounts', async (orig) => ({ ...(await orig<object>()), getAccount: () => ({ id: 'acc1' }) }));

import { openDb, type Db } from '../src/lib/server/db';
import { purchaseEffect } from '../src/lib/server/purchase-effect';

describe('до и после: анкор считается на той странице, куда ведёт ссылка', () => {
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

  it('fifa coins на /nl/ не смешивается с /pl/', async () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    const r = await purchaseEffect(db, {
      groupId: 1, name: '10-11-26', date: '2026-11-10', fixed: false,
      items: [{ id: 1, groupId: 1, siteUrl: 'sc-domain:futcoins.eu', query: 'fifa coins', page: 'https://futcoins.eu/nl/', position: null, impressions: null, clicks: null, ctr: null, addedAt: 0, qty: 2, kind: 'anchor' }]
    }, now);
    const s = r.sites[0];
    expect(s.error).toBeNull();
    expect(s.before).toEqual({ clicks: 2, impressions: 100, position: 30 });
    expect(s.after).toEqual({ clicks: 6, impressions: 200, position: 20 });
    expect(s.items[0].before).toEqual({ clicks: 0, impressions: 10, position: 40 });
    expect(s.items[0].after).toEqual({ clicks: 1, impressions: 20, position: 25 });
    const q = calls.find((c) => c.dimensions.join(',') === 'query,page,date');
    expect(JSON.stringify(q?.filters)).toContain('futcoins\\\\.eu/nl');
  });
});
