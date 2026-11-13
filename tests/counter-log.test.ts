// Журнал приёма событий /c: что принято и почему отброшено — и вывод по сайту.
import { beforeEach, afterEach, it, expect, vi, describe } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/lib/server/db';
import { ensureCounterKey } from '../src/lib/server/config';
import { clicksForRange } from '../src/lib/server/button-clicks';
import { counterChecks, counterLogSince, logBucket, logCounter } from '../src/lib/server/counter-log';
import { counterVerdict } from '../src/lib/utils/counter-verdict';

let testDb: Db;
vi.mock('../src/lib/server/db', async (original) => ({ ...(await original<typeof import('../src/lib/server/db')>()), db: () => testDb }));
// В консолях: fut-coins.nl и futcoin.it; other.de — нет.
vi.mock('../src/lib/server/google', () => ({ listAllKnownSites: async () => ({ sites: [{ siteUrl: 'sc-domain:fut-coins.nl' }, { siteUrl: 'sc-domain:futcoin.it' }] }) }));
import { POST } from '../src/routes/c/+server';

const UA = 'Mozilla/5.0 (compatible; site-counter)';
let dir: string;
let key: string;
let n = 0;

async function send(h: string, e: unknown, opts: { key?: string; ua?: string; ip?: string } = {}) {
  n++;
  const request = new Request('https://panel.example/c', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-counter-key': opts.key ?? key, 'x-client-ua': opts.ua ?? UA, 'x-client-ip': opts.ip ?? `u${n}` },
    body: JSON.stringify({ h, e: typeof e === 'string' ? e : JSON.stringify(e) })
  });
  const res = await (POST as unknown as (ev: { request: Request }) => Promise<Response>)({ request });
  expect(res.status).toBe(204);
}

const log = () => counterLogSince(testDb, '2000-01-01');
const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gsc-hub-'));
  testDb = openDb(join(dir, 't.db'));
  key = ensureCounterKey(testDb);
});
afterEach(() => {
  testDb.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('журнал приёма /c', () => {
  it('принятые события: просмотр с источником и без, время, переход к оплате', async () => {
    const ip = 'v-one';
    await send('fut-coins.nl', { k: 'view', p: '/', r: 'www.google.com' }, { ip });
    await send('fut-coins.nl', { k: 'view', p: '/x/' }, { ip });
    await send('fut-coins.nl', { k: 'time', p: '/', d: 12 }, { ip });
    await send('fut-coins.nl', { k: 'submit', p: '/', l: 'checkout ps 500000', t: '/kassa/' }, { ip });
    const rows = log()['fut-coins.nl'];
    const got = Object.fromEntries(rows.map((r) => [`${r.kind}:${r.outcome}`, r.n]));
    expect(got).toEqual({ 'view:ok': 1, 'view-nosrc:ok': 1, 'time:ok': 1, 'submit:ok': 1 });
    expect(clicksForRange(testDb, day(), day()).filter((r) => r.kind === 'view')).toHaveLength(2);
  });

  it('чужой или отозванный ключ у нашего сайта — «bad-key», событие не записано', async () => {
    await send('futcoin.it', { k: 'view', p: '/', r: '' }, { key: 'old-revoked-key' });
    expect(log()['futcoin.it']).toEqual([expect.objectContaining({ kind: 'view', outcome: 'bad-key', n: 1 })]);
    expect(clicksForRange(testDb, day(), day())).toEqual([]);
  });

  it('сайта нет в консолях — принято (ключ верный); бот — «bot»; битое событие — «bad-event»', async () => {
    await send('other.de', { k: 'view', p: '/', r: '' });
    await send('fut-coins.nl', { k: 'view', p: '/', r: '' }, { ua: 'curl/8.0' });
    await send('fut-coins.nl', '{"type":"vue","page":"/"}');
    expect(log()['other.de']).toEqual([expect.objectContaining({ outcome: 'ok' })]);
    expect(log()['fut-coins.nl'].map((r) => `${r.kind}:${r.outcome}`).sort()).toEqual(['event:bad-event', 'view:bot']);
  });

  it('мусор из интернета (чужой сайт и чужой ключ) в журнал не попадает', async () => {
    await send('spam.example', { k: 'view', p: '/' }, { key: 'nope' });
    await send('spam.example', 'not json at all', { key: 'nope' });
    expect(log()).toEqual({});
  });
});

describe('вывод по сайту', () => {
  const t = (ts: number) => String(ts);
  it('нет событий — счётчик ничего не отправляет', () => {
    expect(counterVerdict([], t)[0]).toMatchObject({ level: 'bad', text: expect.stringContaining('ни одного события') });
  });
  it('неверный ключ и нет просмотров при переходах к оплате', () => {
    const v = counterVerdict([
      { kind: 'view', outcome: 'bad-key', n: 5, lastAt: 1 },
      { kind: 'submit', outcome: 'ok', n: 18, lastAt: 2 }
    ], t);
    expect(v.map((f) => f.level)).toEqual(['bad', 'bad']);
    expect(v[0].text).toContain('COUNTER_KEY');
    expect(v[1].text).toContain('Просмотры не приходят — только переходы к оплате');
  });
  it('просмотры без источника — предупреждение про пустые «Откуда» и «Отказы»', () => {
    const v = counterVerdict([
      { kind: 'view-nosrc', outcome: 'ok', n: 9, lastAt: 1 },
      { kind: 'time', outcome: 'ok', n: 9, lastAt: 1 }
    ], t);
    expect(v).toEqual([expect.objectContaining({ level: 'warn', text: expect.stringContaining('без источника') })]);
  });
  it('была только проверка связи — связь есть, посетителей ждём; проверка не считается событием', () => {
    expect(counterVerdict([{ kind: 'test', outcome: 'ok', n: 1, lastAt: 5 }], t)).toEqual([{ level: 'ok', text: 'Связь с панелью есть: проверка прошла 5. Посетителей с тех пор не было.' }]);
    expect(counterVerdict([{ kind: 'test', outcome: 'bad-key', n: 1, lastAt: 5 }], t)[0]).toMatchObject({ level: 'bad', text: expect.stringContaining('COUNTER_KEY') });
    const v = counterVerdict([{ kind: 'test', outcome: 'ok', n: 1, lastAt: 1 }, { kind: 'view', outcome: 'ok', n: 2, lastAt: 2 }, { kind: 'time', outcome: 'ok', n: 2, lastAt: 2 }], t);
    expect(v).toEqual([{ level: 'ok', text: 'Принято 4 событий (последнее 2): просмотры с источником, время.' }]);
  });
  it('всё приходит — одна строка «принято»', () => {
    const v = counterVerdict([
      { kind: 'view', outcome: 'ok', n: 9, lastAt: 1 },
      { kind: 'time', outcome: 'ok', n: 7, lastAt: 1 },
      { kind: 'submit', outcome: 'ok', n: 2, lastAt: 3 },
      { kind: 'click', outcome: 'limit', n: 1, lastAt: 1 }
    ], t);
    expect(v).toEqual([{ level: 'ok', text: 'Принято 18 событий (последнее 3): просмотры с источником, время, переходы к оплате.' }]);
  });
});

describe('проверка счётчиков: с последней удачной проверки связи', () => {
  const H = 3600_000;
  const t0 = Date.UTC(2026, 10, 13, 0, 20); // 01:20 по Берлину: старый счётчик, ключ не подошёл
  const t1 = t0 + 9 * H; // 10:20: сайт переведён, проверка связи прошла
  const t2 = t1 + 2 * H; // 12:20: посетитель

  it('ячейка журнала — день и час по Берлину', () => {
    expect(logBucket(t0)).toBe('2026-11-13 01');
    expect(logBucket(t1)).toBe('2026-11-13 10');
  });

  it('ошибки до проверки связи не в счёт, события после — в счёт', () => {
    logCounter(testDb, 'futcoin.it', 'view', 'bad-key', t0);
    logCounter(testDb, 'futcoin.it', 'view-nosrc', 'ok', t0);
    logCounter(testDb, 'futcoin.it', 'test', 'ok', t1);
    logCounter(testDb, 'futcoin.it', 'view', 'ok', t2);
    logCounter(testDb, 'futcoin.it', 'time', 'ok', t2);
    const c = counterChecks(testDb, '2026-11-07')['futcoin.it'];
    expect(c.since).toBe(t1);
    expect(Object.fromEntries(c.rows.map((r) => [`${r.kind}:${r.outcome}`, r.n]))).toEqual({ 'test:ok': 1, 'view:ok': 1, 'time:ok': 1 });
    const f = counterVerdict(c.rows, (ts) => String(ts), c.since);
    expect(f).toHaveLength(1);
    expect(f[0].level).toBe('ok');
    expect(f[0].text).toContain(`после проверки связи ${t1}`);
  });

  it('после проверки посетителей не было — связь есть, ошибок нет', () => {
    logCounter(testDb, 'fut-coins.nl', 'view', 'bad-key', t0);
    logCounter(testDb, 'fut-coins.nl', 'test', 'ok', t1);
    const c = counterChecks(testDb, '2026-11-07')['fut-coins.nl'];
    const f = counterVerdict(c.rows, (ts) => String(ts), c.since);
    expect(f).toEqual([expect.objectContaining({ level: 'ok', text: expect.stringContaining('Посетителей с тех пор не было') })]);
  });

  it('без проверки связи — весь период, ошибки видны', () => {
    logCounter(testDb, 'other.de', 'view', 'bad-key', t0);
    const c = counterChecks(testDb, '2026-11-07')['other.de'];
    expect(c.since).toBeNull();
    expect(counterVerdict(c.rows, (ts) => String(ts), c.since)[0].level).toBe('bad');
  });
});

describe('переход к оплате без просмотра', () => {
  const H = 3600_000;
  it('засчитывается, только если тот же посетитель до этого был на сайте', async () => {
    const { checkoutVerdict, markSeen } = await import('../src/lib/server/button-clicks');
    const now = Date.UTC(2026, 10, 13, 12, 0);
    expect(checkoutVerdict(testDb, 'v-test', 'fut-coins.nl', now)).toBe('no-visit'); // проверка сайта: сразу кнопка
    markSeen(testDb, 'v-buyer', 'fut-coins.nl', now - 10 * 60_000);
    expect(checkoutVerdict(testDb, 'v-buyer', 'fut-coins.nl', now)).toBe('ok'); // смотрел страницу 10 минут назад
    expect(checkoutVerdict(testDb, 'v-buyer', 'futcoin.it', now)).toBe('no-visit'); // на другом сайте не был
    markSeen(testDb, 'v-old', 'fut-coins.nl', now - 4 * H);
    expect(checkoutVerdict(testDb, 'v-old', 'fut-coins.nl', now)).toBe('no-visit'); // слишком давно
  });

  it('один посетитель — один переход за 30 минут, окно продлевается нажатиями', async () => {
    const { checkoutVerdict, markSeen } = await import('../src/lib/server/button-clicks');
    const M = 60_000;
    const t0 = Date.UTC(2026, 10, 13, 12, 0);
    markSeen(testDb, 'v-tester', 'fccoinsprice.com', t0);
    // Проверка кнопок: сотни нажатий подряд — один переход.
    const got = Array.from({ length: 200 }, (_, i) => checkoutVerdict(testDb, 'v-tester', 'fccoinsprice.com', t0 + i * 3000));
    expect(got.filter((v) => v === 'ok')).toHaveLength(1);
    expect(got.filter((v) => v === 'repeat')).toHaveLength(199);
    // Человек выбрал пакет, вернулся и через 40 минут снова пошёл к оплате — второй переход.
    markSeen(testDb, 'v-buyer', 'fccoinsprice.com', t0);
    expect(checkoutVerdict(testDb, 'v-buyer', 'fccoinsprice.com', t0 + M)).toBe('ok');
    expect(checkoutVerdict(testDb, 'v-buyer', 'fccoinsprice.com', t0 + 5 * M)).toBe('repeat');
    markSeen(testDb, 'v-buyer', 'fccoinsprice.com', t0 + 44 * M);
    expect(checkoutVerdict(testDb, 'v-buyer', 'fccoinsprice.com', t0 + 45 * M)).toBe('ok');
  });

  it('связки переживают перезапуск панели (лежат в базе)', async () => {
    const { checkoutVerdict, markSeen } = await import('../src/lib/server/button-clicks');
    const now = Date.now();
    markSeen(testDb, 'v-keep', 'fut-coins.nl', now - 60_000);
    testDb.close();
    testDb = openDb(join(dir, 't.db'));
    expect(checkoutVerdict(testDb, 'v-keep', 'fut-coins.nl', now)).toBe('ok');
    expect(checkoutVerdict(testDb, 'v-stranger', 'fut-coins.nl', now)).toBe('no-visit');
  });

  it('через /c: повтор в журнале как «repeat», в статистику идёт один переход', async () => {
    const ip = 'v-c';
    await send('fut-coins.nl', { k: 'view', p: '/', r: '' }, { ip });
    for (let i = 0; i < 5; i++) await send('fut-coins.nl', { k: 'submit', p: '/', l: `checkout ps ${100000 * (i + 1)}`, t: '/kassa/' }, { ip });
    await send('fut-coins.nl', { k: 'submit', p: '/', l: 'checkout ps 100000', t: '/kassa/' }, { ip: 'v-nobody' });
    const got = Object.fromEntries(log()['fut-coins.nl'].map((r) => [`${r.kind}:${r.outcome}`, r.n]));
    expect(got['submit:ok']).toBe(1);
    expect(got['submit:repeat']).toBe(4);
    expect(got['submit:no-visit']).toBe(1);
    expect(clicksForRange(testDb, day(), day()).filter((r) => r.kind === 'submit').reduce((a, r) => a + r.n, 0)).toBe(1);
  });

  it('по одному-двум просмотрам отсутствие времени — не поломка', () => {
    const few = [{ kind: 'view', outcome: 'ok', n: 2, lastAt: 1 }];
    expect(counterVerdict(few, String)[0].level).toBe('ok');
    const many = [{ kind: 'view', outcome: 'ok', n: 9, lastAt: 1 }];
    expect(counterVerdict(many, String).some((f) => f.level === 'warn' && f.text.includes('Время на странице не приходит'))).toBe(true);
  });
});
