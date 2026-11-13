// Метки сайтов: futcoin всем сайтам, что были в панели, ключ — домен без www.
import { beforeEach, afterEach, it, expect, vi, describe } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';

vi.mock('../src/lib/server/google', () => ({
  listAllKnownSites: async () => ({ sites: [{ siteUrl: 'sc-domain:futcoin.it' }, { siteUrl: 'https://www.fccoins.es/' }], errors: [] })
}));
import { seedSiteLabels, siteLabels, setSiteLabel, cleanLabel, labelAll } from '../src/lib/server/site-labels';
import { labelKey, blockCompare } from '../src/lib/utils/site-label';

let db: Db;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
  db = openDb(join(dir, 't.db'));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('метки сайтов', () => {
  it('ключ метки — домен без www из любого вида адреса', () => {
    expect(labelKey('sc-domain:futcoin.it')).toBe('futcoin.it');
    expect(labelKey('https://www.fccoins.es/')).toBe('fccoins.es');
    expect(labelKey('fut-coins.nl')).toBe('fut-coins.nl');
    expect(labelKey('WWW.Futcoin.NL')).toBe('futcoin.nl');
  });

  it('один раз: futcoin всем сайтам консолей и тем, что панель знает сама; новые — без метки', async () => {
    db.prepare('INSERT INTO manual_sites (host, added_at) VALUES (?, ?)').run('600kcoins.com', 1);
    await seedSiteLabels(db);
    expect(siteLabels(db)).toEqual({ 'futcoin.it': 'futcoin', 'fccoins.es': 'futcoin', '600kcoins.com': 'futcoin' });
    // Сайт, добавленный потом, метку сам не получает — второй посев не идёт.
    db.prepare('INSERT INTO manual_sites (host, added_at) VALUES (?, ?)').run('wowgold.co.uk', 2);
    await seedSiteLabels(db);
    expect(siteLabels(db)['wowgold.co.uk']).toBeUndefined();
  });

  it('метку можно поменять и снять; посев не перетирает поставленную руками', async () => {
    setSiteLabel(db, 'https://www.fccoins.es/', '  wow  ');
    await seedSiteLabels(db);
    expect(siteLabels(db)['fccoins.es']).toBe('wow');
    setSiteLabel(db, 'fccoins.es', '');
    expect(siteLabels(db)['fccoins.es']).toBeUndefined();
    expect(cleanLabel('x'.repeat(60))).toHaveLength(40);
    expect(labelAll(db, ['a.com', 'www.a.com'])).toBe(1);
  });

  it('порядок блоков: метка, потом страна; без метки и без страны — в конце', () => {
    const r = (label: string | null, geo: string | null, site = 's') => ({ label, geo, site, page: 'p', query: 'q' });
    const rows = [r(null, 'Italy'), r('wow', 'Spain'), r('futcoin', null), r('futcoin', 'Spain'), r('futcoin', 'Global'), r('futcoin', 'Italy')];
    expect(rows.sort(blockCompare).map((x) => `${x.label}/${x.geo}`)).toEqual([
      'futcoin/Italy', 'futcoin/Spain', 'futcoin/Global', 'futcoin/null', 'wow/Spain', 'null/Italy'
    ]);
  });
});
