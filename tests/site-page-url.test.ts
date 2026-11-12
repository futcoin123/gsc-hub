import { describe, it, expect } from 'vitest';
import { sitePageUrl, cleanAnchor } from '../src/lib/utils/url-filters';

describe('страница сайта, вписанная руками', () => {
  it('полный адрес, без https:// и путь', () => {
    expect(sitePageUrl('https://fut-coins.de/fifa-coins/', 'sc-domain:fut-coins.de')).toBe('https://fut-coins.de/fifa-coins/');
    expect(sitePageUrl('  fut-coins.de/fifa-coins/  ', 'sc-domain:fut-coins.de')).toBe('https://fut-coins.de/fifa-coins/');
    expect(sitePageUrl('fut-coins.de', 'sc-domain:fut-coins.de')).toBe('https://fut-coins.de/');
    expect(sitePageUrl('/fifa-coins/', 'sc-domain:fut-coins.de')).toBe('https://fut-coins.de/fifa-coins/');
    expect(sitePageUrl('/de/', 'https://www.fut-coins.de/')).toBe('https://www.fut-coins.de/de/');
  });

  it('www. не в счёт, якорь отбрасывается', () => {
    expect(sitePageUrl('https://www.fccoins.eu/fc-27-coins/#buy', 'https://fccoins.eu/')).toBe('https://www.fccoins.eu/fc-27-coins/');
  });

  it('чужой сайт и не адреса — отказ', () => {
    for (const bad of ['', '   ', 'https://other.com/', 'fut coins', 'javascript:alert(1)', 'ftp://fut-coins.de/', 'https://u:p@fut-coins.de/', 'https://fut-coins.de:8080/', 'https://fut-coins.de.evil.com/']) {
      expect(() => sitePageUrl(bad, 'sc-domain:fut-coins.de'), bad).toThrow();
    }
  });
});

describe('анкор, вписанный руками', () => {
  it('сжимает пробелы', () => {
    expect(cleanAnchor('  buy   fut  coins ')).toBe('buy fut coins');
  });
  it('пустой, слишком длинный и [в скобках] — отказ', () => {
    expect(() => cleanAnchor('   ')).toThrow();
    expect(() => cleanAnchor('x'.repeat(301))).toThrow();
    expect(() => cleanAnchor('[домен]')).toThrow();
  });
});
