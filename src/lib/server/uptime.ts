// Доступность сайтов: открывается ли главная и страница заказа, нет ли ошибки,
// чужого редиректа, заглушки хостинга/регистратора, проверки Cloudflare, и та ли
// там страница (сравнение с запомненным эталоном). Только в панели, без рассылок.
import type { Db } from './db';
import { checkSsl } from './health';
import { listAllKnownSites } from './google';
import { siteHostname } from '$lib/utils/url-filters';
import { getConfigValue } from './config';
import { mapSettledLimit } from './concurrency';
import { refreshDomainDates } from './domain-dates';

export type Level = 'ok' | 'warn' | 'error';
export interface Problem { level: Level; text: string }

export interface FetchResult {
  ok: boolean;
  status: number | null;
  ms: number;
  finalUrl: string;
  chain: string[];
  contentType: string;
  body: string;
  error?: string;
}

export interface CheckData {
  url: string;
  status: number | null;
  ms: number;
  finalUrl: string;
  title: string;
  textLen: number;
  similarity: number | null;
  problems: Problem[];
  googlebot?: { status: number | null; title: string; finalUrl: string } | null;
  ssl?: { daysLeft: number; issuer: string } | null;
}

// Метка GSCHubCheck в конце: сайт видит обычный браузер, а счётчик кнопок
// по ней понимает, что это проверка панели, а не посетитель.
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 GSCHubCheck/1';
const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const MAX_BODY = 2_000_000;

export const baseHost = (h: string) => h.toLowerCase().replace(/^www\./, '');

/** Понятный текст сетевой ошибки. */
export function netError(e: unknown): string {
  const err = e as Error & { cause?: { code?: string; message?: string } };
  if (err.name === 'TimeoutError') return 'не ответил за 15 секунд';
  const code = err.cause?.code ?? '';
  const msg = String(err.cause?.message ?? err.message ?? '');
  if (code === 'ENOTFOUND') return 'не открывается: домен не находится (нет записи DNS — домен не продлён или не настроен)';
  if (code === 'EAI_AGAIN') return 'не открывается: DNS не ответил';
  if (code === 'ECONNREFUSED') return 'не открывается: сервер не принимает соединения';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'не открывается: сервер оборвал соединение';
  if (/CERT|certificate/i.test(code + msg)) return 'не открывается: ошибка SSL-сертификата';
  if (/SSL|TLS|0A000/i.test(msg)) return 'не открывается: ошибка защищённого соединения (SSL/TLS)';
  return `не открывается: ${msg.slice(0, 100)}`;
}

/** Открыть страницу; при сетевой ошибке — ещё раз через 3 секунды (разовая заминка — не падение). */
export async function fetchPage(url: string, ua: string = BROWSER_UA, f: typeof fetch = fetch): Promise<FetchResult> {
  const first = await fetchOnce(url, ua, f);
  if (first.ok || f !== fetch) return first;
  await new Promise((r) => setTimeout(r, 3000));
  return fetchOnce(url, ua, f);
}

async function fetchOnce(url: string, ua: string, f: typeof fetch): Promise<FetchResult> {
  const t0 = Date.now();
  const chain: string[] = [];
  let cur = url;
  try {
    for (let hop = 0; hop < 7; hop++) {
      const res = await f(cur, {
        redirect: 'manual',
        headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en,de;q=0.8,ru;q=0.6' },
        signal: AbortSignal.timeout(15_000)
      });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        chain.push(cur);
        cur = new URL(loc, cur).toString();
        continue;
      }
      const text = (await res.text()).slice(0, MAX_BODY);
      return { ok: true, status: res.status, ms: Date.now() - t0, finalUrl: cur, chain, contentType: res.headers.get('content-type') ?? '', body: text };
    }
    return { ok: false, status: null, ms: Date.now() - t0, finalUrl: cur, chain, contentType: '', body: '', error: 'слишком много перенаправлений' };
  } catch (e) {
    const msg = netError(e);
    return { ok: false, status: null, ms: Date.now() - t0, finalUrl: cur, chain, contentType: '', body: '', error: msg };
  }
}

export function pageTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return (m ? m[1] : '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

export function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Отпечаток текста: хэши троек слов (до 3000). */
export function shingles(text: string): number[] {
  const w = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = new Set<number>();
  for (let i = 0; i + 2 < w.length && out.size < 3000; i++) {
    let h = 2166136261;
    for (const ch of w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    out.add(h >>> 0);
  }
  return [...out];
}

export function similarity(a: number[], b: number[]): number {
  if (!a.length && !b.length) return 1;
  const sa = new Set(a);
  let inter = 0;
  for (const x of b) if (sa.has(x)) inter++;
  return inter / (sa.size + b.length - inter);
}

const PATTERNS: [RegExp, Level, string][] = [
  [/domain (name )?(is |may be )?for sale|buy this domain|this domain (is|may be) for sale|parked (free|domain|by)|sedoparking|afternic|dan\.com\/buy|hugedomains|abovedomains|parkingcrew|bodis\.com|domain parking/i, 'error', 'Заглушка «домен продаётся» — похоже, домен не продлён или припаркован'],
  [/account (has been |is )?suspended|this (site|website|account) (has been |is )?suspended|bandwidth limit exceeded|website (is )?(expired|disabled)/i, 'error', 'Заглушка хостинга: аккаунт приостановлен'],
  [/error 10(0\d|1\d|2\d)\b|error 52[0-9]\b|web server is (down|returning an unknown error)|origin is unreachable|bad gateway/i, 'error', 'Ошибка Cloudflare или сервера на странице'],
  [/attention required! \| cloudflare|checking your browser|just a moment\.\.\.|cf-challenge|challenge-platform/i, 'warn', 'Cloudflare показывает проверку «вы человек?» (возможно, только роботам)'],
  [/welcome to nginx|apache2 (ubuntu |debian )?default page|it works!|<title>index of \//i, 'error', 'Стандартная страница сервера вместо сайта'],
  [/(404|page) not found|страница не найдена|página no encontrada|seite nicht gefunden|page introuvable|pagina non trovata/i, 'warn', 'На странице текст «не найдено»']
];

export interface Baseline { title: string; textLen: number; shingles: number[] }

/** Разбор ответа: уровень и список проблем простыми словами. */
export function analyze(kind: 'home' | 'order', siteHost: string, r: FetchResult, base: Baseline | null): CheckData & { level: Level; shingles: number[] } {
  const problems: Problem[] = [];
  const title = pageTitle(r.body);
  const text = pageText(r.body);
  const sh = shingles(text);
  let sim: number | null = null;
  if (!r.ok) problems.push({ level: 'error', text: `Сайт ${r.error}` });
  else {
    const finalHost = (() => {
      try {
        return baseHost(new URL(r.finalUrl).hostname);
      } catch {
        return '';
      }
    })();
    const foreign = finalHost && finalHost !== baseHost(siteHost);
    if (foreign && kind === 'home') problems.push({ level: 'error', text: `Перенаправляет на другой сайт: ${finalHost}` });
    // Со страницы заказа уход на сайт оплаты — норма; дальше чужую страницу не разбираем.
    if (foreign && kind === 'order') return { url: '', status: r.status, ms: r.ms, finalUrl: r.finalUrl, title, textLen: text.length, similarity: null, problems: [{ level: 'ok', text: `Ведёт на сайт оплаты ${finalHost}` }], level: 'ok', shingles: [] };
    if (r.status !== null && r.status >= 500) problems.push({ level: 'error', text: `Ошибка сервера ${r.status}` });
    else if (r.status !== null && r.status >= 400) problems.push({ level: 'error', text: `Страница отвечает ошибкой ${r.status}` });
    if (r.ms > 6000) problems.push({ level: 'warn', text: `Медленно: ${(r.ms / 1000).toFixed(1)} с` });
    if (!foreign && r.status !== null && r.status < 400) {
      if (!/html/i.test(r.contentType) && r.body.length) problems.push({ level: 'warn', text: `Отдаётся не HTML (${r.contentType || 'без типа'})` });
      // Заголовок, текст и начало кода страницы (описание, скрипты парковки).
      const hay = title + ' ' + text.slice(0, 20000) + ' ' + r.body.slice(0, 5000);
      for (const [re, level, msg] of PATTERNS) if (re.test(hay) || (level === 'warn' && msg.startsWith('Cloudflare') && re.test(r.body.slice(0, 20000)))) problems.push({ level, text: msg });
      if (text.length < 200 && !problems.some((p) => p.level === 'error')) problems.push({ level: 'error', text: 'Страница почти пустая' });
      if (base) {
        sim = similarity(base.shingles, sh);
        if (base.title && title !== base.title) problems.push({ level: 'warn', text: `Заголовок изменился: было «${base.title.slice(0, 80)}», стало «${title.slice(0, 80) || 'пусто'}»` });
        if (base.textLen > 0 && text.length < base.textLen * 0.3) problems.push({ level: 'error', text: `Текста стало намного меньше (${text.length} знаков вместо ~${base.textLen})` });
        else if (sim < 0.35) problems.push({ level: 'warn', text: `Страница сильно изменилась (совпадает ${Math.round(sim * 100)}% текста)` });
      }
    }
  }
  const level: Level = problems.some((p) => p.level === 'error') ? 'error' : problems.some((p) => p.level === 'warn') ? 'warn' : 'ok';
  return { url: '', status: r.status, ms: r.ms, finalUrl: r.finalUrl, title, textLen: text.length, similarity: sim, problems, level, shingles: sh };
}

/** Страница заказа: action формы на главной (тот же сайт, не «/»). */
export function findOrderPath(html: string, pageUrl: string): string | null {
  const re = /<form\b[^>]*\baction\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, '&'), pageUrl);
      if (baseHost(u.hostname) === baseHost(new URL(pageUrl).hostname) && u.pathname !== '/' && !/search|subscribe|newsletter|login|contact/i.test(u.pathname)) return u.pathname;
    } catch {
      /* битый action */
    }
  }
  return null;
}

// ─── Хранение ────────────────────────────────────────────────────────────────

export interface StoredCheck { url: string; host: string; kind: 'home' | 'order'; level: Level; data: CheckData; since: number; checkedAt: number }

/** Последняя проверка каждой страницы сайта (главная, заказ); старые адреса — не в счёт. */
export function listChecks(db: Db): StoredCheck[] {
  const rows = (db.prepare('SELECT url, host, kind, level, data, since, checked_at FROM uptime_checks ORDER BY checked_at DESC').all() as {
    url: string; host: string; kind: 'home' | 'order'; level: Level; data: string; since: number; checked_at: number;
  }[]);
  const seen = new Set<string>();
  const out: StoredCheck[] = [];
  for (const r of rows) {
    const k = `${r.host}\n${r.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ url: r.url, host: r.host, kind: r.kind, level: r.level, data: JSON.parse(r.data), since: r.since, checkedAt: r.checked_at });
  }
  return out;
}

export function history(db: Db, host: string, limit = 30): { url: string; level: Level; summary: string; at: number }[] {
  return db.prepare('SELECT url, level, summary, at FROM uptime_history WHERE host = ? ORDER BY at DESC LIMIT ?').all(host, limit) as {
    url: string; level: Level; summary: string; at: number;
  }[];
}

function getBaseline(db: Db, url: string): Baseline | null {
  const r = db.prepare('SELECT title, text_len, shingles FROM uptime_baseline WHERE url = ?').get(url) as { title: string; text_len: number; shingles: string } | undefined;
  return r ? { title: r.title, textLen: r.text_len, shingles: JSON.parse(r.shingles) } : null;
}

function saveBaseline(db: Db, url: string, b: Baseline): void {
  db.prepare(
    `INSERT INTO uptime_baseline (url, title, text_len, shingles, saved_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET title = excluded.title, text_len = excluded.text_len, shingles = excluded.shingles, saved_at = excluded.saved_at`
  ).run(url, b.title, b.textLen, JSON.stringify(b.shingles), Date.now());
}

/** «Это нормально»: текущий вид страниц сайта становится эталоном. */
export function acceptCurrent(db: Db, host: string): void {
  db.prepare('DELETE FROM uptime_baseline WHERE url IN (SELECT url FROM uptime_checks WHERE host = ?)').run(host);
}

function store(db: Db, host: string, kind: 'home' | 'order', url: string, d: CheckData, level: Level): void {
  const prev = db.prepare('SELECT level, since FROM uptime_checks WHERE url = ?').get(url) as { level: Level; since: number } | undefined;
  const now = Date.now();
  const since = prev && prev.level === level ? prev.since : now;
  db.prepare(
    `INSERT INTO uptime_checks (url, host, kind, level, data, since, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET host = excluded.host, kind = excluded.kind, level = excluded.level, data = excluded.data, since = excluded.since, checked_at = excluded.checked_at`
  ).run(url, host, kind, level, JSON.stringify(d), since, now);
  if (!prev || prev.level !== level) {
    const summary = level === 'ok' ? 'Всё в порядке' : d.problems.filter((p) => p.level !== 'ok').map((p) => p.text).join('; ');
    db.prepare('INSERT INTO uptime_history (url, host, level, summary, at) VALUES (?, ?, ?, ?, ?)').run(url, host, level, summary.slice(0, 500), now);
    db.prepare('DELETE FROM uptime_history WHERE url = ? AND id NOT IN (SELECT id FROM uptime_history WHERE url = ? ORDER BY at DESC LIMIT 100)').run(url, url);
  }
}

async function checkUrl(db: Db, host: string, kind: 'home' | 'order', url: string, f: typeof fetch): Promise<{ data: CheckData; level: Level; html: string }> {
  const r = await fetchPage(url, BROWSER_UA, f);
  const base = getBaseline(db, url);
  const a = analyze(kind, host, r, base);
  const { shingles: sh, level, ...rest } = a;
  const data: CheckData = { ...rest, url };
  // Первая нормальная проверка — эталон «как должно быть».
  if (!base && level !== 'error' && r.ok && r.status !== null && r.status < 400 && sh.length) saveBaseline(db, url, { title: a.title, textLen: a.textLen, shingles: sh });
  return { data, level, html: r.body };
}

/** Проверить сайт: главная (+ как её видит Googlebot, SSL) и страница заказа. */
export async function checkHost(db: Db, host: string, f: typeof fetch = fetch): Promise<void> {
  const homeUrl = `https://${host}/`;
  const home = await checkUrl(db, host, 'home', homeUrl, f);
  try {
    const s = await checkSsl(host);
    if ('ok' in s) {
      home.data.ssl = { daysLeft: s.daysLeft, issuer: s.issuer };
      if (!s.valid) home.data.problems.push({ level: 'error', text: 'SSL-сертификат истёк' });
      else if (s.daysLeft < 14) home.data.problems.push({ level: 'warn', text: `SSL-сертификат истекает через ${s.daysLeft} дн.` });
    } else home.data.problems.push({ level: 'error', text: `SSL: ${s.error}` });
  } catch {
    /* SSL не критичен для остальной проверки */
  }
  // Что видит Google: сильное расхождение с обычным браузером — признак взлома.
  if (home.level !== 'error') {
    const g = await fetchPage(homeUrl, GOOGLEBOT_UA, f);
    const gt = pageTitle(g.body);
    home.data.googlebot = { status: g.status, title: gt, finalUrl: g.finalUrl };
    // Отказ «поддельному Googlebot» (401/403/429) — обычная защита: запрос идёт
    // с нашего сервера, а не с адреса Google. Настоящего Google сайт пускает.
    const refused = g.status === 401 || g.status === 403 || g.status === 429;
    if (refused) home.data.googlebot = { ...home.data.googlebot, title: 'сервер не пускает поддельного Googlebot — это нормальная защита' };
    if (!refused && g.ok) {
      let gHost = '';
      try {
        gHost = baseHost(new URL(g.finalUrl).hostname);
      } catch {
        /* ничего */
      }
      if (gHost && gHost !== baseHost(host)) home.data.problems.push({ level: 'error', text: `Googlebot перенаправляется на другой сайт: ${gHost}` });
      else if (g.status !== null && g.status >= 400) home.data.problems.push({ level: 'warn', text: `Googlebot получает ошибку ${g.status}` });
      else if (gt && home.data.title && gt !== home.data.title) home.data.problems.push({ level: 'warn', text: `Googlebot видит другой заголовок: «${gt.slice(0, 80)}»` });
    }
  }
  const lvl = (d: CheckData): Level => (d.problems.some((p) => p.level === 'error') ? 'error' : d.problems.some((p) => p.level === 'warn') ? 'warn' : 'ok');
  store(db, host, 'home', homeUrl, home.data, lvl(home.data));

  const orderPath = home.html ? findOrderPath(home.html, homeUrl) : null;
  let orderUrl: string | null = null;
  if (orderPath) {
    orderUrl = `https://${host}${orderPath}`;
    const order = await checkUrl(db, host, 'order', orderUrl, f);
    store(db, host, 'order', orderUrl, order.data, order.level);
  }
  // Страница заказа сменилась или пропала: старая запись больше не про этот
  // сайт. Иначе её давняя ошибка висела бы в счётчике у пункта меню.
  db.prepare('DELETE FROM uptime_checks WHERE host = ? AND url != ? AND (? IS NULL OR url != ?)').run(host, homeUrl, orderUrl, orderUrl);
}

// ─── Расписание ──────────────────────────────────────────────────────────────

export const INTERVALS = [6, 12, 24] as const;
export function intervalHours(db: Db): number {
  const v = Number(getConfigValue(db, 'UPTIME_INTERVAL_H'));
  return (INTERVALS as readonly number[]).includes(v) ? v : 24;
}

/** Все домены всех консолей (без www). */
export async function allHosts(db: Db): Promise<string[]> {
  const { sites } = await listAllKnownSites(db);
  const out = new Set<string>();
  for (const s of sites) {
    try {
      out.add(baseHost(siteHostname(s.siteUrl)));
    } catch {
      /* битый адрес */
    }
  }
  return [...out].sort();
}

/** Проверить те сайты, у которых подошёл срок (или все, если force). */
export async function runDue(db: Db, opts: { force?: boolean; hosts?: string[] } = {}): Promise<number> {
  const hosts = opts.hosts ?? (await allHosts(db));
  const last = new Map((db.prepare("SELECT host, MAX(checked_at) AS at FROM uptime_checks WHERE kind = 'home' GROUP BY host").all() as { host: string; at: number }[]).map((r) => [r.host, r.at]));
  const due = opts.force ? hosts : hosts.filter((h) => Date.now() - (last.get(h) ?? 0) >= intervalHours(db) * 3600_000);
  await mapSettledLimit(due, (h) => checkHost(db, h), 4);
  return due.length;
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
export function startUptimeMonitor(getDb: () => Db): void {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runDue(getDb());
      // Даты доменов (регистрация, «оплачен до») — раз в неделю для каждого.
      await refreshDomainDates(getDb(), await allHosts(getDb()));
    } catch (e) {
      console.error('Uptime monitor:', (e as Error).message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), 15 * 60_000);
  timer.unref();
  setTimeout(() => void tick(), 60_000).unref();
}

/** Сколько сайтов сейчас с ошибкой — для пункта меню; считает так же, как таблица. */
export function errorCount(db: Db, hosts?: Set<string>): number {
  const bad = new Set(listChecks(db).filter((c) => c.level === 'error').map((c) => c.host));
  return [...bad].filter((h) => !hosts || hosts.has(h)).length;
}
