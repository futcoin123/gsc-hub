// Единый счётчик целиком: код страницы (в имитации браузера) → gsc-counter.js
// сайта (как Pages Function) → настоящая ручка панели /c → база панели.
import { beforeEach, afterEach, it, expect, vi, describe } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { openDb, type Db } from '../src/lib/server/db';
import { ensureCounterKey } from '../src/lib/server/config';
import { clicksForRange, timeForRange, visitStatsForRange, resetVisits } from '../src/lib/server/button-clicks';
import { counterLogSince } from '../src/lib/server/counter-log';
import { counterKit, cleanEventsPath } from '../src/lib/counter-kit.js';

let testDb: Db;
vi.mock('../src/lib/server/db', async (original) => ({ ...(await original<typeof import('../src/lib/server/db')>()), db: () => testDb }));
vi.mock('../src/lib/server/google', () => ({ listAllKnownSites: async () => ({ sites: [{ siteUrl: 'sc-domain:futcoin.it' }] }) }));
import { POST as panelPOST } from '../src/routes/c/+server';

const SITE = 'futcoin.it';
const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
let dir: string;
let key: string;
let panelCalls: { ip: string; body: string }[];
let n = 0;

type Mod = { gscCounter: (ctx: unknown) => Promise<Response> };
/** Свежий экземпляр модуля — как отдельный сервер Cloudflare. */
async function loadModule(code: string): Promise<Mod> {
  const f = join(dir, `gsc-counter-${++n}.mjs`);
  writeFileSync(f, code);
  return import(pathToFileURL(f).href);
}

/** Запрос к сайту через модуль; ответ сайта «дальше» — next. */
async function site(mod: Mod, path: string, init: { method?: string; body?: string; headers?: Record<string, string>; next?: () => Response; env?: Record<string, string> } = {}) {
  const waits: Promise<unknown>[] = [];
  const request = new Request(`https://${SITE}${path}`, { method: init.method ?? 'GET', body: init.body, headers: { 'user-agent': BROWSER, 'cf-connecting-ip': '203.0.113.7', ...init.headers } });
  const res = await mod.gscCounter({ request, env: init.env ?? { COUNTER_KEY: key }, next: async () => (init.next ? init.next() : new Response('<html></html>', { headers: { 'content-type': 'text/html' } })), waitUntil: (p: Promise<unknown>) => waits.push(p) });
  await Promise.all(waits);
  return res;
}

/** Код страницы в имитации браузера: что он отправил и обработчики событий. */
function runPage(page: string, opts: { referrer?: string; search?: string; path?: string } = {}) {
  const beacons: Promise<{ url: string; body: string }>[] = [];
  const listeners: Record<string, ((e: unknown) => void)[]> = {};
  const clock = { t: 1_000_000 };
  const doc = {
    referrer: opts.referrer ?? '',
    visibilityState: 'visible',
    addEventListener: (t: string, f: (e: unknown) => void) => (listeners[t] ??= []).push(f)
  };
  const win: Record<string, unknown> = {
    document: doc,
    location: { pathname: opts.path ?? '/', host: SITE, href: `https://${SITE}${opts.path ?? '/'}${opts.search ?? ''}`, search: opts.search ?? '' },
    navigator: { sendBeacon: (url: string, blob: Blob) => (beacons.push(blob.text().then((body) => ({ url, body }))), true) },
    performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    Blob, URL, URLSearchParams, JSON, Math, Object, String, Number,
    Date: { now: () => clock.t },
    addEventListener: (t: string, f: (e: unknown) => void) => (listeners['win:' + t] ??= []).push(f)
  };
  win.window = win;
  vm.runInNewContext(page, win);
  return { beacons, listeners, doc, clock, fire: (t: string, e: unknown = {}) => (listeners[t] ?? []).forEach((f) => f(e)) };
}

/** Отправить то, что страница послала, через модуль сайта (как браузер на адрес событий). */
async function deliver(mod: Mod, beacons: Promise<{ url: string; body: string }>[], events: string) {
  for (const b of await Promise.all(beacons.splice(0))) {
    expect(b.url).toBe(events);
    const res = await site(mod, events, { method: 'POST', body: b.body, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', origin: `https://${SITE}` } });
    expect(res.status).toBe(204);
  }
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gsc-kit-'));
  testDb = openDb(join(dir, 't.db'));
  key = ensureCounterKey(testDb);
  resetVisits();
  panelCalls = [];
  // Модуль сайта стучится в панель — направляем прямо в ручку /c.
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    expect(url).toBe('https://panel.example/c');
    const headers = new Headers(init.headers);
    panelCalls.push({ ip: headers.get('x-client-ip') ?? '', body: String(init.body) });
    return (panelPOST as unknown as (ev: { request: Request }) => Promise<Response>)({ request: new Request(url, init) });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  testDb.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('единый счётчик: код и файлы', () => {
  it('у сайта всегда один и тот же вариант, у разных сайтов — разные имена', () => {
    const a = counterKit(SITE, 'https://panel.example', '/segnale/');
    const b = counterKit(SITE, 'https://panel.example', '/segnale/');
    const c = counterKit('fut-coins.de', 'https://panel.example', '/puls/');
    expect(a.page).toBe(b.page);
    expect(a.fields).not.toEqual(c.fields);
    expect(a.page).not.toMatch(/sessionStorage|localStorage|document\.cookie|sslip|panel\.example/);
    expect(a.page).toContain('"/segnale/"');
    expect(a.module).toContain('const SITE = "futcoin.it"');
    expect(Object.values(a.fields).sort()).toEqual(['b', 'c', 'd', 'k', 'l', 'p', 'r', 't']);
  });
  it('адрес событий — одно-два слова сайта (у старых сайтов остаётся свой)', () => {
    expect(cleanEventsPath('segnale')).toBe('/segnale/');
    expect(cleanEventsPath('/Puls')).toBe('/puls/');
    expect(cleanEventsPath('/api/v')).toBe('/api/v/');
    for (const bad of ['/c/', '/c/x', '/a b/', '/../', '/cdn-cgi/x', '/a/b/c/', '']) expect(cleanEventsPath(bad), bad).toBeNull();
  });

  it('новая версия не меняет имена у сайта (futcoin.it на версии 1 работает с этими же)', () => {
    const k = counterKit(SITE, 'https://panel.example', '/segnale/');
    expect(k.fields).toEqual({ dz: 'p', ju: 'k', k: 'r', t: 'd', i: 'l', dw: 't', od: 'c', o: 'b' });
    expect(k.kinds).toEqual({ yg: 'view', kra: 'time', nl: 'link', b: 'out' });
  });
});

describe('единый счётчик: страница → сайт → панель', () => {
  it('просмотр из Google, время, кнопка и переход к оплате — записаны в панели', async () => {
    const kit = counterKit(SITE, 'https://panel.example', '/segnale/');
    const mod = await loadModule(kit.module);
    const p = runPage(kit.page, { referrer: 'https://www.google.com/' });
    // Нажатие на кнопку-ссылку и 12 секунд на странице.
    const el = { tagName: 'A', innerText: 'Vai al pagamento', closest: () => el, hasAttribute: () => false, getAttribute: (a: string) => ({ href: '/pagamento/?p=ps&n=250000', class: 'btn btn-pri' } as Record<string, string>)[a] ?? null };
    p.fire('click', { target: el });
    p.clock.t += 12_000;
    p.doc.visibilityState = 'hidden';
    p.fire('visibilitychange');
    await deliver(mod, p.beacons, kit.events);
    // Переход: /pagamento/ отвечает 302 на кассу, Referer — главная сайта.
    await site(mod, '/pagamento/?p=ps&n=250000', { headers: { 'sec-fetch-dest': 'document', referer: `https://${SITE}/` }, next: () => new Response(null, { status: 302, headers: { location: 'https://cassa.example/offer/1' } }) });

    const rows = clicksForRange(testDb, today(), today());
    expect(rows.find((r) => r.kind === 'view')).toMatchObject({ host: SITE, page: '/', target: 'google.com', n: 1 });
    expect(rows.find((r) => r.kind === 'button')).toMatchObject({ label: 'Vai al pagamento', target: '/pagamento/?p=ps&n=250000' });
    expect(rows.find((r) => r.kind === 'submit')).toMatchObject({ page: '/', label: 'checkout ps 250000', target: '/pagamento/' });
    expect(timeForRange(testDb, today(), today())).toEqual([{ host: SITE, page: '/', seconds: 12 }]);
    // В панель не уходит ни IP, ни браузер.
    for (const c of panelCalls) expect(c.ip).toMatch(/^v[0-9a-f]{16}$/);
    expect(panelCalls.map((c) => c.body).join()).not.toContain('203.0.113.7');
  });

  it('код посетителя один и тот же на разных серверах — вторая страница не отказ', async () => {
    const kit = counterKit(SITE, 'https://panel.example', '/segnale/');
    const [one, two] = [await loadModule(kit.module), await loadModule(kit.module)];
    const first = runPage(kit.page, { referrer: 'https://www.bing.com/' });
    await deliver(one, first.beacons, kit.events);
    const second = runPage(kit.page, { referrer: `https://${SITE}/`, path: '/crediti-fifa-27/' });
    await deliver(two, second.beacons, kit.events);
    expect(new Set(panelCalls.map((c) => c.ip)).size).toBe(1);
    const stats = visitStatsForRange(testDb, today(), today(), Date.now() + 40 * 60_000);
    expect(stats).toEqual([{ host: SITE, visits: 1, bounces: 0 }]);
  });

  it('ChatGPT без адреса, но с utm_source — источник chatgpt', async () => {
    const kit = counterKit(SITE, 'https://panel.example', '/segnale/');
    const mod = await loadModule(kit.module);
    const p = runPage(kit.page, { search: '?utm_source=chatgpt.com' });
    await deliver(mod, p.beacons, kit.events);
    expect(clicksForRange(testDb, today(), today())[0]).toMatchObject({ kind: 'view', target: 'utm:chatgpt.com' });
  });

  it('роботы, чужие сайты и запросы не со страницы — не считаются', async () => {
    const kit = counterKit(SITE, 'https://panel.example', '/segnale/');
    const mod = await loadModule(kit.module);
    const p = runPage(kit.page, { referrer: 'https://www.google.com/' });
    const [b] = await Promise.all(p.beacons);
    await site(mod, kit.events, { method: 'POST', body: b.body, headers: { 'user-agent': 'Mozilla/5.0 HeadlessChrome/130', 'sec-fetch-site': 'same-origin' } });
    await site(mod, kit.events, { method: 'POST', body: b.body, headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } });
    // Переход к оплате без Referer сайта и свой редирект www — не оплата.
    await site(mod, '/pagamento/?p=ps&n=1', { headers: { 'sec-fetch-dest': 'document' }, next: () => new Response(null, { status: 302, headers: { location: 'https://cassa.example/' } }) });
    await site(mod, '/x/', { headers: { 'sec-fetch-dest': 'document', referer: `https://${SITE}/` }, next: () => new Response(null, { status: 301, headers: { location: `https://www.${SITE}/x/` } }) });
    expect(panelCalls).toEqual([]);
  });

  it('без ключа — ничего не отправляется, сайт говорит x-counter: off', async () => {
    const kit = counterKit(SITE, 'https://panel.example', '/segnale/');
    const mod = await loadModule(kit.module);
    const res = await site(mod, kit.events, { env: {} });
    expect(res.headers.get('x-counter')).toBe('off');
    expect(res.headers.get('x-counter-kit')).toBe(kit.version);
    expect((await site(mod, kit.events)).headers.get('x-counter')).toBe('on');
    const p = runPage(kit.page);
    const [b] = await Promise.all(p.beacons);
    await site(mod, kit.events, { method: 'POST', body: b.body, env: {}, headers: { 'sec-fetch-site': 'same-origin' } });
    expect(panelCalls).toEqual([]);
  });

  it('проверка связи: ответ панели виден снаружи, в статистику не попадает', async () => {
    const kit = counterKit(SITE, 'https://panel.example', '/segnale/');
    const ping = { method: 'POST', body: '{"gsc_ping":1}', headers: { 'user-agent': 'Mozilla/5.0 (compatible; GSCHubCheck/1)' } };
    const ok = await site(await loadModule(kit.module), kit.events, ping);
    expect(ok.headers.get('x-counter-ping')).toBe('ok');
    expect(counterLogSince(testDb, '2000-01-01')[SITE]).toEqual([expect.objectContaining({ kind: 'test', outcome: 'ok', n: 1 })]);
    expect(clicksForRange(testDb, today(), today())).toEqual([]);
    // старый ключ в секрете сайта — так было у futcoin.it
    const bad = await site(await loadModule(kit.module), kit.events, { ...ping, env: { COUNTER_KEY: 'old-revoked-key' } });
    expect(bad.headers.get('x-counter-ping')).toBe('bad-key');
    const none = await site(await loadModule(kit.module), kit.events, { ...ping, env: {} });
    expect(none.headers.get('x-counter-ping')).toBe('no-key');
  });

  it('сайт не в Search Console, но ключ верный — событие принято', async () => {
    const kit = counterKit('new-site.de', 'https://panel.example', '/puls/');
    const code = kit.module;
    const mod = await loadModule(code);
    const p = runPage(kit.page, { referrer: 'https://www.google.de/' });
    const [b] = await Promise.all(p.beacons);
    const waits: Promise<unknown>[] = [];
    await mod.gscCounter({
      request: new Request('https://new-site.de/puls/', { method: 'POST', body: b.body, headers: { 'user-agent': BROWSER, 'sec-fetch-site': 'same-origin' } }),
      env: { COUNTER_KEY: key }, next: async () => new Response(''), waitUntil: (w: Promise<unknown>) => waits.push(w)
    });
    await Promise.all(waits);
    expect(clicksForRange(testDb, today(), today())[0]).toMatchObject({ host: 'new-site.de', kind: 'view', target: 'google.de' });
  });
});
