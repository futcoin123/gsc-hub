// Свои визиты и роботы не в статистику: панель сама узнаёт их по коду
// посетителя от единого счётчика (v2, на сайтах не меняется).
import { beforeEach, afterEach, it, expect, vi, describe } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDb, type Db } from '../src/lib/server/db';
import { ensureCounterKey } from '../src/lib/server/config';
import { checkoutSourcesForRange, clicksForRange, resetVisits, sweepVisits, timeForRange, visitStatsForRange } from '../src/lib/server/button-clicks';
import { counterLogSince } from '../src/lib/server/counter-log';
import { cleanIp, clientIp, rememberTeamIp, removeTeamIp, siteLanguage, teamLinkOk, teamLinkToken, visitorId, listTeamIps } from '../src/lib/server/own-visitors';
import { counterKit } from '../src/lib/counter-kit.js';

let testDb: Db;
vi.mock('../src/lib/server/db', async (original) => ({ ...(await original<typeof import('../src/lib/server/db')>()), db: () => testDb }));
vi.mock('../src/lib/server/google', () => ({ listAllKnownSites: async () => ({ sites: [{ siteUrl: 'sc-domain:futcoin.it' }] }) }));
import { POST } from '../src/routes/c/+server';

const UA = 'Mozilla/5.0 (compatible; site-counter)';
let dir: string;
let key: string;
const utcToday = () => new Date().toISOString().slice(0, 10);
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
const vid = (ip: string) => visitorId(key, ip, utcToday());

/** Событие от сайта, как его шлёт gsc-counter.js: код посетителя вместо IP. */
async function send(h: string, ip: string, e: Record<string, unknown>) {
  const request = new Request('https://panel.example/c', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-counter-key': key, 'x-client-ua': UA, 'x-client-ip': vid(ip) },
    body: JSON.stringify({ h, e: JSON.stringify(e) })
  });
  expect((await (POST as unknown as (ev: { request: Request }) => Promise<Response>)({ request })).status).toBe(204);
}
/** Покупатель: вход из Google, 40 секунд, кнопка, переход к оплате. */
async function buyer(h: string, ip: string) {
  await send(h, ip, { k: 'view', p: '/', r: 'www.google.com' });
  await send(h, ip, { k: 'time', p: '/', d: 40 });
  await send(h, ip, { k: 'link', p: '/', l: 'Vai al pagamento', t: '/pagamento/', b: 1 });
  await send(h, ip, { k: 'submit', p: '/', l: 'checkout ps', t: '/pagamento/' });
}
const stats = () => ({
  clicks: clicksForRange(testDb, day(), day()).reduce((a, r) => a + r.n, 0),
  seconds: timeForRange(testDb, day(), day()).reduce((a, r) => a + r.seconds, 0),
  checkouts: checkoutSourcesForRange(testDb, day(), day()).reduce((a, r) => a + r.n, 0),
  visits: visitStatsForRange(testDb, day(), day(), Date.now() + 40 * 60_000).reduce((a, r) => a + r.visits, 0)
});
const outcomes = (host: string) => Object.fromEntries((counterLogSince(testDb, '2000-01-01')[host] ?? []).map((r) => [`${r.kind}|${r.outcome}`, r.n]));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gsc-own-'));
  testDb = openDb(join(dir, 't.db'));
  key = ensureCounterKey(testDb);
  resetVisits();
});
afterEach(() => {
  vi.unstubAllGlobals();
  testDb.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('адреса и код посетителя', () => {
  it('IP как у Cloudflare: IPv4 как есть, IPv6 сжатый; свои сети и мусор — нет', () => {
    expect(cleanIp('203.0.113.7')).toBe('203.0.113.7');
    expect(cleanIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(cleanIp('2A02:0810:D000:0000:0000:0000:0000:0001')).toBe('2a02:810:d000::1');
    for (const bad of ['10.0.0.5', '192.168.1.2', '172.20.0.3', '127.0.0.1', '::1', 'fd00::1', 'fe80::1', '100.64.1.1', 'nope', '', '1.2.3']) expect(cleanIp(bad), bad).toBeNull();
  });

  it('IP человека за Caddy — из X-Forwarded-For, только если сокет внутренний', () => {
    const r = (xff: string) => new Request('https://hub.example/', { headers: { 'x-forwarded-for': xff } });
    expect(clientIp(r('198.51.100.9'), '172.18.0.3')).toBe('198.51.100.9');
    expect(clientIp(r('1.1.1.1, 198.51.100.9'), '172.18.0.3')).toBe('198.51.100.9');
    // Сокет из интернета — это и есть человек; подделанный X-Forwarded-For не в счёт.
    expect(clientIp(r('198.51.100.9'), '203.0.113.50')).toBe('203.0.113.50');
  });

  it('код посетителя панели совпадает с кодом из gsc-counter.js сайта', async () => {
    const kit = counterKit('futcoin.it', 'https://panel.example', '/segnale/');
    const f = join(dir, 'gsc-counter.mjs');
    writeFileSync(f, kit.module);
    const mod = (await import(pathToFileURL(f).href)) as { gscCounter: (ctx: unknown) => Promise<Response> };
    let sent = '';
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => ((sent = new Headers(init.headers).get('x-client-ip') ?? ''), new Response(null, { status: 204 })));
    const fields = Object.fromEntries(Object.entries(kit.fields).map(([a, b]) => [b, a]));
    const kinds = Object.fromEntries(Object.entries(kit.kinds).map(([a, b]) => [b, a]));
    const waits: Promise<unknown>[] = [];
    await mod.gscCounter({
      request: new Request('https://futcoin.it/segnale/', {
        method: 'POST',
        body: JSON.stringify({ [fields.k]: kinds.view, [fields.p]: '/', [fields.r]: '' }),
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0', 'cf-connecting-ip': '203.0.113.7', 'sec-fetch-site': 'same-origin' }
      }),
      env: { COUNTER_KEY: key }, next: async () => new Response(''), waitUntil: (p: Promise<unknown>) => waits.push(p)
    });
    await Promise.all(waits);
    expect(sent).toBe(visitorId(key, '203.0.113.7', utcToday()));
  });

  it('язык сайта: домен страны или папка /it/; .com, .eu, .ch — неизвестно', () => {
    expect(siteLanguage('futcoin.it')).toBe('it');
    expect(siteLanguage('futcoin.at')).toBe('de');
    expect(siteLanguage('futcoins.co.uk')).toBe('en');
    expect(siteLanguage('futcoins.eu', '/it/crediti/')).toBe('it');
    expect(siteLanguage('futcoins.eu', '/')).toBeNull();
    expect(siteLanguage('fc-coins.net')).toBeNull();
    expect(siteLanguage('futcoin.ch')).toBeNull();
  });
});

describe('свои по IP', () => {
  it('IP из панели известен заранее — ни просмотра, ни времени, ни оплаты', async () => {
    rememberTeamIp(testDb, '198.51.100.20', 'manual');
    await buyer('futcoin.it', '198.51.100.20');
    expect(stats()).toEqual({ clicks: 0, seconds: 0, checkouts: 0, visits: 0 });
    expect(outcomes('futcoin.it')).toEqual({ 'view|team': 1, 'time|team': 1, 'click|team': 1, 'submit|team': 1 });
    // Обычный покупатель рядом считается.
    await buyer('futcoin.it', '203.0.113.99');
    expect(stats()).toEqual({ clicks: 3, seconds: 40, checkouts: 1, visits: 1 });
  });

  it('IP узнали позже — всё, что он успел сегодня, вычитается (и визит не пишется)', async () => {
    await buyer('futcoin.it', '198.51.100.21');
    expect(stats()).toMatchObject({ clicks: 3, seconds: 40, checkouts: 1 });
    rememberTeamIp(testDb, '198.51.100.21', 'browser');
    expect(stats()).toEqual({ clicks: 0, seconds: 0, checkouts: 0, visits: 0 });
  });

  it('визит уже закрыт и записан — вычитается вместе с отказом', async () => {
    await send('futcoin.it', '198.51.100.22', { k: 'view', p: '/', r: 'www.bing.com' });
    sweepVisits(testDb, Date.now() + 31 * 60_000, true);
    expect(visitStatsForRange(testDb, day(), day())).toEqual([{ host: 'futcoin.it', visits: 1, bounces: 1 }]);
    rememberTeamIp(testDb, '198.51.100.22', 'link');
    expect(visitStatsForRange(testDb, day(), day())).toEqual([{ host: 'futcoin.it', visits: 0, bounces: 0 }]);
  });

  it('список IP: руками остаётся, убранный IP снова считается', async () => {
    rememberTeamIp(testDb, '2a02:810:d000::1', 'manual');
    expect(listTeamIps(testDb).map((t) => [t.ip, t.source])).toEqual([['2a02:810:d000::1', 'manual']]);
    expect(rememberTeamIp(testDb, '10.0.0.1', 'manual')).toBeNull();
    removeTeamIp(testDb, '2a02:810:d000::1');
    await send('futcoin.it', '198.51.100.30', { k: 'view', p: '/', r: '' });
    expect(stats().clicks).toBe(1);
  });

  it('ссылка для сотрудников: верный секрет, новая ссылка отменяет старую', () => {
    const a = teamLinkToken(testDb);
    expect(teamLinkToken(testDb)).toBe(a);
    expect(teamLinkOk(testDb, a)).toBe(true);
    const b = teamLinkToken(testDb, true);
    expect(teamLinkOk(testDb, a)).toBe(false);
    expect(teamLinkOk(testDb, b)).toBe(true);
    expect(teamLinkOk(testDb, '')).toBe(false);
  });
});

describe('свои и роботы по поведению', () => {
  it('сайты на двух языках за день — проверка сети: вычитается и первый сайт', async () => {
    await buyer('futcoin.it', '198.51.100.40');
    await send('fut-coins.pl', '198.51.100.40', { k: 'view', p: '/', r: '' });
    await send('fut-coins.pl', '198.51.100.40', { k: 'time', p: '/', d: 15 });
    expect(stats()).toEqual({ clicks: 0, seconds: 0, checkouts: 0, visits: 0 });
    expect(outcomes('fut-coins.pl')).toEqual({ 'view|team': 1, 'time|team': 1 });
  });

  it('английский сайт и итальянский — может быть покупатель, считается', async () => {
    await send('futcoins.co.uk', '198.51.100.41', { k: 'view', p: '/', r: 'www.google.com' });
    await send('futcoin.it', '198.51.100.41', { k: 'view', p: '/', r: 'www.google.com' });
    await send('futcoins.eu', '198.51.100.41', { k: 'view', p: '/', r: 'www.google.com' });
    expect(stats().clicks).toBe(3);
  });

  it('несколько сайтов одной страны — обычный покупатель (сеть конкурирует в выдаче)', async () => {
    await send('futcoins.co.uk', '198.51.100.42', { k: 'view', p: '/', r: 'www.google.com' });
    await send('fut-coins.co.uk', '198.51.100.42', { k: 'view', p: '/', r: 'www.google.com' });
    await send('cheap-fut-coins.co.uk', '198.51.100.42', { k: 'view', p: '/', r: 'www.google.com' });
    expect(stats().clicks).toBe(3);
  });

  it('10 страниц за минуту — робот: все его события вычитаются', async () => {
    for (let i = 1; i <= 12; i++) await send('futcoin.it', '198.51.100.50', { k: 'view', p: `/p${i}/`, r: i === 1 ? 'www.google.com' : '=' });
    expect(stats().clicks).toBe(0);
    // Журнал: 9 приняты (потом вычтены), 10-я и дальше — «робот».
    expect(outcomes('futcoin.it')).toEqual({ 'view|ok': 9, 'view|robot': 3 });
    // 9 страниц — ещё человек.
    for (let i = 1; i <= 9; i++) await send('futcoin.it', '198.51.100.51', { k: 'view', p: `/q${i}/`, r: '=' });
    expect(stats().clicks).toBe(9);
  });
});
