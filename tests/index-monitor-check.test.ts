// Проверка индексации одного сайта: sitemap → проверка страниц → итог в базе.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const google = vi.hoisted(() => ({ inspect: vi.fn(), sitemaps: vi.fn() }));
vi.mock('../src/lib/server/google', () => ({
  listSitemaps: google.sitemaps,
  bulkInspect: google.inspect,
  listSitesForAllAccounts: async () => ({ sites: [], errors: [] })
}));
vi.mock('../src/lib/server/sitemap', () => ({
  fetchSitemapUrls: async () => ['https://futcoins.co.uk/', 'https://futcoins.co.uk/cheap-fut-coins/', 'https://other.com/']
}));

import { openDb, type Db } from '../src/lib/server/db';
import { upsertAccount } from '../src/lib/server/accounts';
import { checkSiteIndex, indexChecks } from '../src/lib/server/index-monitor';

let dir: string;
let db: Db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
  db = openDb(join(dir, 't.db'));
  upsertAccount(db, { id: 'a1', email: 'x@y', access_token: 't', refresh_token: 'r', expires_at: Date.now() / 1000 + 3600, scope: 's' });
  google.sitemaps.mockResolvedValue([{ path: 'https://futcoins.co.uk/sitemap.xml', errors: '0' }]);
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('проверка индексации сайта', () => {
  it('страницы своего сайта из sitemap, итог сохраняется', async () => {
    google.inspect.mockImplementation(async (_db: unknown, _acc: unknown, _site: string, urls: string[]) =>
      urls.map((u) => ({ inspectionUrl: u, status: 'ok', index: u.endsWith('/cheap-fut-coins/') ? { verdict: 'NEUTRAL', coverageState: 'Discovered - currently not indexed' } : { verdict: 'PASS' } }))
    );
    const c = await checkSiteIndex(db, 'a1', 'sc-domain:futcoins.co.uk', 5);
    expect(google.inspect.mock.calls[0][3]).toEqual(['https://futcoins.co.uk/', 'https://futcoins.co.uk/cheap-fut-coins/']);
    expect(c).toMatchObject({ total: 2, indexed: 1, notIndexed: 1 });
    expect(indexChecks(db).get('sc-domain:futcoins.co.uk')).toMatchObject({ checkedAt: 5, notIndexed: 1, missing: [{ url: 'https://futcoins.co.uk/cheap-fut-coins/', reason: 'Discovered - currently not indexed' }] });
  });

  it('Google не ответил ни по одной странице — прошлый итог остаётся', async () => {
    google.inspect.mockImplementationOnce(async (_d: unknown, _a: unknown, _s: string, urls: string[]) => urls.map((u) => ({ inspectionUrl: u, status: 'ok', index: { verdict: 'PASS' } })));
    await checkSiteIndex(db, 'a1', 'sc-domain:futcoins.co.uk', 5);
    google.inspect.mockImplementationOnce(async (_d: unknown, _a: unknown, _s: string, urls: string[]) => urls.map((u) => ({ inspectionUrl: u, status: 'error', error: '429' })));
    await checkSiteIndex(db, 'a1', 'sc-domain:futcoins.co.uk', 9);
    expect(indexChecks(db).get('sc-domain:futcoins.co.uk')).toMatchObject({ checkedAt: 5, indexed: 2, notIndexed: 0 });
  });

  it('нет консоли — итог с причиной, без запросов к Google', async () => {
    const c = await checkSiteIndex(db, 'нет', 'sc-domain:x.de', 1);
    expect(c.error).toMatch(/консоль/);
    expect(google.inspect).not.toHaveBeenCalled();
  });
});
