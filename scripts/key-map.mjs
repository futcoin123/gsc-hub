#!/usr/bin/env node
// @ts-nocheck — скрипт для запуска руками; данные карты приходят без схемы.
// «Карта ключей FUT» → src/lib/key-map.enc.json (зашифровано для хаба).
//
//   node scripts/key-map.mjs <сохранённая страница карты.html> --hub <адрес хаба>
//
// Из карты берутся только её собственные пометки: у страниц сайтов «основной»
// (главный ключ сайта) и «второстепенный» — вид «Сайты» карты; плюс страницы
// из плана, которые уже внесены на сайт. К каждому ключу — его варианты из
// группы карты (Google считает их тем же запросом).
//
// Репозиторий хаба открыт всем, поэтому карта лежит в нём зашифрованной
// открытым ключом хаба (/key-map/public-key): прочитать её может только
// сервер. Сервер берёт из карты только новые сайты — ключи сайта, который уже
// есть в хабе, не меняются (правило владелицы 09.11.2026).
import { createCipheriv, createHash, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const OUT = fileURLToPath(new URL('../src/lib/key-map.enc.json', import.meta.url));

const norm = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const hostOf = (site) => site.split('/')[0].toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
/** «buy-fut-coins.com/de» → «/de»; у обычного сайта — ''. */
const prefixOf = (site) => {
  const i = site.indexOf('/');
  return i < 0 ? '' : site.slice(i).replace(/\/+$/, '');
};
function fullUrl(site, url, todo = '') {
  // «новая страница — сделана 09.11.2026 (/de/buy-ea-fc-27-coins/)»: адрес на сайте — в скобках.
  const real = /\((\/[^)\s]*)\)/.exec(todo)?.[1];
  if (real) return real;
  const p = prefixOf(site);
  if (!p || url === p + '/' || url.startsWith(p + '/')) return url;
  return p + url;
}

/** Данные карты из сохранённой страницы (тег <script id="data">). */
export function readMapHtml(html) {
  const m = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) throw new Error('В файле нет данных карты (<script id="data">) — это точно страница «Карта ключей FUT»?');
  return JSON.parse(m[1]);
}

/**
 * Карта для хаба: { mapUpdated, hosts: { host: [{ country, url, key, role, alts }] } }.
 * role: 'main' — основной ключ сайта, 'secondary' — второстепенный.
 * @returns {{ mapUpdated: string | null, hosts: Record<string, { country: string, url: string, key: string, role: 'main' | 'secondary', alts: string[] }[]> }}
 */
export function buildKeyMap(data) {
  const hosts = {};
  const add = (host, page) => {
    const list = (hosts[host] ??= []);
    const same = list.find((p) => p.url === page.url && p.country === page.country);
    if (!same) {
      list.push(page);
      return page;
    }
    // Одна страница в обоих видах карты: роль из вида «Сайты», варианты — вместе.
    for (const a of [page.key, ...page.alts]) if (norm(a) !== same.key && !same.alts.includes(norm(a))) same.alts.push(norm(a));
    return same;
  };
  for (const c of data.countries ?? []) {
    const groups = new Map((c.groups ?? []).map((g) => [g.id, g]));
    const groupByHead = new Map((c.groups ?? []).map((g) => [norm(g.h), g]));
    const altsOf = (key, extra, g) => {
      const out = [];
      for (const a of [...(extra ?? []), ...((g?.r ?? []).map((r) => r[0]))]) {
        const n = norm(a);
        if (n && n !== norm(key) && !out.includes(n)) out.push(n);
      }
      return out;
    };
    for (const p of c.pages ?? []) {
      const r = String(p.role ?? '');
      const role = r.startsWith('основной') && !r.includes('бронь') ? 'main' : r.startsWith('второстепенный') ? 'secondary' : null;
      if (!role || !norm(p.key) || !p.url || p.url === '—') continue;
      add(hostOf(p.site), { country: c.id, url: fullUrl(p.site, p.url), key: norm(p.key), role, alts: altsOf(p.key, [], groups.get(p.gid) ?? groupByHead.get(norm(p.group))) });
    }
    for (const r of c.plan?.rows ?? []) {
      if (!String(r.status ?? '').startsWith('есть') || !norm(r.main)) continue;
      if (!/внесено|сделана/.test(String(r.todo ?? ''))) continue;
      const role = String(r.kind ?? '').startsWith('главная') ? 'main' : 'secondary';
      add(hostOf(r.site), { country: c.id, url: fullUrl(r.site, r.url, r.todo), key: norm(r.main), role, alts: altsOf(r.main, r.variants, groupByHead.get(norm(r.group))) });
    }
  }
  const sorted = {};
  for (const h of Object.keys(hosts).sort()) sorted[h] = hosts[h].sort((a, b) => (a.role === b.role ? a.url.localeCompare(b.url) : a.role === 'main' ? -1 : 1));
  return { mapUpdated: data.updated ?? null, hosts: sorted, topics: buildTopics(data) };
}

// Ключи темы для ТЗ групп (колонка «Ключи гео», просьба владелицы 13.11.2026:
// «любые ключи на эту тему, как они звучат в стране»): главные фразы
// коммерческих групп о монетах, от частых к редким, без прошлых сезонов
// (fc 26, fifa 23…). Не больше TOPICS на страну.
export const TOPICS = 15;
const COIN_TOPICS = new Set(['Монеты', 'Монеты по платформе', 'Монеты: сумма']);
const OLD_SEASON = /\b(?:1\d|2[0-6])\b|\b20(?:1\d|2[0-6])\b/;
export function buildTopics(data) {
  const out = {};
  for (const c of data.countries ?? []) {
    const keys = [];
    for (const g of [...(c.groups ?? [])].sort((a, b) => (b.s ?? 0) - (a.s ?? 0))) {
      const h = norm(g.h);
      if (g.k !== 'com' || !COIN_TOPICS.has(g.t) || !h || OLD_SEASON.test(h) || keys.includes(h)) continue;
      keys.push(h);
      if (keys.length >= TOPICS) break;
    }
    if (keys.length) out[c.id] = keys;
  }
  return out;
}

export const fingerprint = (pem) => createHash('sha256').update(pem.trim()).digest('hex').slice(0, 16);
export const mapHash = (map) => createHash('sha256').update(JSON.stringify(map)).digest('hex');

/** RSA-OAEP (SHA-256) прячет ключ AES-256-GCM, им зашифрована карта. */
export function encryptKeyMap(map, publicKeyPem) {
  const plain = Buffer.from(JSON.stringify(map), 'utf8');
  const aes = randomBytes(32);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', aes, iv);
  const data = Buffer.concat([c.update(plain), c.final()]);
  const key = publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aes);
  return {
    v: 1,
    hash: mapHash(map),
    pub: fingerprint(publicKeyPem),
    key: key.toString('base64'),
    iv: iv.toString('base64'),
    tag: c.getAuthTag().toString('base64'),
    data: data.toString('base64')
  };
}

async function main(argv) {
  const file = argv.find((a) => !a.startsWith('--'));
  const hubArg = argv.indexOf('--hub');
  const hub = (hubArg >= 0 ? argv[hubArg + 1] : process.env.HUB_URL ?? '').replace(/\/+$/, '');
  if (!file || !hub) {
    console.error('Запуск: node scripts/key-map.mjs <страница карты.html> --hub https://адрес-хаба');
    process.exit(2);
  }
  const map = buildKeyMap(readMapHtml(readFileSync(file, 'utf8')));
  const res = await fetch(`${hub}/key-map/public-key`);
  if (!res.ok) throw new Error(`Хаб не отдал открытый ключ: HTTP ${res.status}`);
  const hubState = await res.json();
  const pem = hubState.publicKey;
  const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  const hosts = Object.keys(map.hosts);
  console.log(`Карта от ${map.mapUpdated}: ${hosts.length} сайтов, ${hosts.reduce((a, h) => a + map.hosts[h].length, 0)} страниц с ключами.`);
  for (const [c, keys] of Object.entries(map.topics)) console.log(`  ключи темы ${c}: ${keys.length} (${keys.slice(0, 4).join(', ')}…)`);
  for (const h of hosts) {
    const main = map.hosts[h].filter((p) => p.role === 'main').map((p) => p.key);
    console.log(`  ${h}: главный ${main.join(' · ') || '—'}, второстепенных ${map.hosts[h].length - main.length}`);
  }
  if (prev?.v === 1 && prev.hash === mapHash(map) && prev.pub === fingerprint(pem)) {
    console.log('Карта не изменилась — файл не трогаю.');
    return;
  }
  writeFileSync(OUT, JSON.stringify(encryptKeyMap(map, pem)) + '\n');
  console.log(`Записано: ${OUT}. В хабе уже есть сайтов: ${hubState.hosts ?? 0} (их ключи не меняются).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
