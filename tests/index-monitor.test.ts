// Индексация сайтов раз в 3 дня: итог страниц, страницы своего property, срок.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { summarize, ownUrls, dueSites, indexChecks, INDEX_EVERY_MS, type IndexCheck } from '../src/lib/server/index-monitor';
import type { InspectedUrl } from '../src/lib/server/google';

const ok = (url: string, verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'NEUTRAL', coverageState = ''): InspectedUrl => ({ inspectionUrl: url, status: 'ok', index: { verdict, coverageState } });

describe('индексация сайта', () => {
  it('в индексе — PASS и PARTIAL; не в индексе — с причиной Google; ошибки — отдельно', () => {
    const c = summarize('sc-domain:futcoins.co.uk', [
      ok('https://futcoins.co.uk/', 'PASS', 'Submitted and indexed'),
      ok('https://futcoins.co.uk/a/', 'PARTIAL'),
      ok('https://futcoins.co.uk/cheap-fut-coins/', 'NEUTRAL', 'Discovered - currently not indexed'),
      ok('https://futcoins.co.uk/b/', 'FAIL', 'Not found (404)'),
      { inspectionUrl: 'https://futcoins.co.uk/c/', status: 'error', error: '429' }
    ], 1);
    expect(c).toMatchObject({ total: 5, indexed: 2, notIndexed: 2, failed: 1, error: null });
    expect(c.missing).toEqual([
      { url: 'https://futcoins.co.uk/cheap-fut-coins/', reason: 'Discovered - currently not indexed' },
      { url: 'https://futcoins.co.uk/b/', reason: 'Not found (404)' }
    ]);
  });

  it('из sitemap — только страницы этого property; у папки — только её', () => {
    const urls = ['https://futcoins.eu/', 'https://futcoins.eu/it/', 'https://www.futcoins.eu/nl/', 'https://other.com/', 'мусор', 'https://futcoins.eu/'];
    expect(ownUrls('sc-domain:futcoins.eu', urls)).toEqual(['https://futcoins.eu/', 'https://futcoins.eu/it/', 'https://www.futcoins.eu/nl/']);
    expect(ownUrls('https://futcoins.eu/it/', urls)).toEqual(['https://futcoins.eu/it/']);
  });

  it('срок: не проверенные и проверенные больше 3 дней назад, старые первыми', () => {
    const now = 10 * INDEX_EVERY_MS;
    const at = (siteUrl: string, checkedAt: number): [string, IndexCheck] => [siteUrl, { siteUrl, checkedAt, total: 1, indexed: 1, notIndexed: 0, failed: 0, missing: [], error: null }];
    const checks = new Map<string, IndexCheck>([at('a', now - INDEX_EVERY_MS - 1), at('b', now - 1000), at('c', now - 5 * INDEX_EVERY_MS)]);
    expect(dueSites([{ siteUrl: 'a' }, { siteUrl: 'b' }, { siteUrl: 'c' }, { siteUrl: 'd' }], checks, now).map((s) => s.siteUrl)).toEqual(['d', 'c', 'a']);
  });
});

describe('хранение итогов', () => {
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
  it('пустая база — нет итогов', () => {
    expect(indexChecks(db).size).toBe(0);
  });
});
