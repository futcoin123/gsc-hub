import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { sectionOf, parseHtmlLang, localesFor, siteSections } from '../src/lib/server/site-locale';
import { importKeyMap, keyMapPublicInfo } from '../src/lib/server/key-map';
import { languageName, langRegion, tldCountry, COUNTRY } from '../src/lib/utils/locale-names';
import { encryptKeyMap } from '../scripts/key-map.mjs';

describe('названия языков и стран — как в списке владелицы', () => {
  it('язык по lang', () => {
    expect(languageName('es-ES')).toBe('Spanish');
    expect(languageName('de')).toBe('German');
    expect(languageName('en-GB')).toBe('English');
    expect(languageName('zh-TW')).toBe('Chinese (Traditional)');
    expect(languageName('zh-CN')).toBe('Chinese (Simplified)');
    expect(languageName('nb')).toBe('Norwegian');
    expect(languageName('')).toBeNull();
  });
  it('страны: точные написания', () => {
    expect(COUNTRY.CZ).toBe('Czech Republic');
    expect(COUNTRY.CI).toBe("Côte d'Ivoire");
    expect(COUNTRY.GB).toBe('United Kingdom');
    expect(COUNTRY.US).toBe('United States');
    expect(COUNTRY.TR).toBe('Turkey');
    expect(COUNTRY.VI).toBe('United States Virgin Islands');
    expect(Object.keys(COUNTRY)).toHaveLength(231);
  });
  it('страна по зоне домена и по региону в lang', () => {
    expect(tldCountry('fut-coin.de')).toBe('DE');
    expect(tldCountry('futcoins.co.uk')).toBe('GB');
    expect(tldCountry('futcoins.eu')).toBeNull();
    expect(tldCountry('futcoin.gg')).toBeNull();
    expect(langRegion('de-AT')).toBe('AT');
    expect(langRegion('en')).toBeNull();
  });
});

describe('язык и гео сайта', () => {
  let dir: string;
  let db: Db;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
    db = openDb(join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('раздел — главная или языковая папка; lang из <html>', () => {
    expect(sectionOf('https://futcoins.eu/it/codici-backup-ea/')).toBe('https://futcoins.eu/it/');
    expect(sectionOf('https://fut-coin.de/fifa-coins/')).toBe('https://fut-coin.de/');
    expect(parseHtmlLang('<!doctype html><html class="x" lang="es-ES"><head>')).toBe('es-ES');
    expect(parseHtmlLang('<html><head>')).toBeNull();
  });

  it('язык с сайта, гео из карты, иначе по зоне, иначе Global; сайт спрашивается один раз', async () => {
    const { publicKey } = keyMapPublicInfo(db);
    importKeyMap(db, encryptKeyMap({ mapUpdated: '2026-11-09', hosts: {
      'futcoins.eu': [
        { country: 'US', url: '/', key: 'fc coins for sale', role: 'main', alts: [] },
        { country: 'IT', url: '/it/', key: 'acquistare crediti fut', role: 'main', alts: [] }
      ]
    } }, publicKey));
    const lang: Record<string, string> = {
      'https://futcoins.eu/': '<html lang="en">',
      'https://futcoins.eu/it/': '<html lang="it">',
      'https://fut-coin.de/': '<html lang="de">',
      'https://example.com/': '<html>'
    };
    const f = vi.fn(async (u: string) => new Response(lang[u] ?? '', { status: lang[u] ? 200 : 404 }));
    vi.stubGlobal('fetch', f);
    const r = await localesFor(db, ['https://futcoins.eu/ea-backup-codes/', 'https://futcoins.eu/it/x/', 'https://fut-coin.de/fifa-coins/', 'https://example.com/a/']);
    expect(r['https://futcoins.eu/ea-backup-codes/']).toEqual({ language: 'English', geo: 'United States' });
    expect(r['https://futcoins.eu/it/x/']).toEqual({ language: 'Italian', geo: 'Italy' });
    expect(r['https://fut-coin.de/fifa-coins/']).toEqual({ language: 'German', geo: 'Germany' });
    expect(r['https://example.com/a/']).toEqual({ language: null, geo: 'Global' });
    expect(f).toHaveBeenCalledTimes(4);
    await localesFor(db, ['https://futcoins.eu/it/x/']);
    expect(f).toHaveBeenCalledTimes(4);
    // Строка сайта: главная и языковые папки из карты.
    expect(siteSections(db, 'https://futcoins.eu/')).toEqual(['https://futcoins.eu/', 'https://futcoins.eu/it/']);
  });
});
