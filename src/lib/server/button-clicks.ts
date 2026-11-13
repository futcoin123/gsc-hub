// Счётчик нажатий кнопок на ваших сайтах. Сайт подключает /c.js, тот при
// нажатии шлёт GET /c?… — здесь только +1 к суммам за день (по Германии).
import { createHash } from 'node:crypto';
import type { Db } from './db';
import { localToday } from './gsc-calendar';
import { storedSource } from '$lib/utils/traffic-source';

export const CLICK_KINDS = ['submit', 'button', 'out', 'link', 'view'] as const;
export type ClickKind = (typeof CLICK_KINDS)[number];

export interface ClickEvent {
  host: string;
  page: string;
  kind: ClickKind;
  label: string;
  target: string;
}

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export const normHost = (h: string) => h.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');

/**
 * Разобрать параметры запроса счётчика. Сайт берём из Referer (его выставляет
 * браузер), а если сайт его не отправляет — из параметра h.
 */
export function parseClick(params: URLSearchParams, referer: string | null): ClickEvent | null {
  let host = '';
  try {
    host = normHost(new URL(referer ?? '').hostname);
  } catch {
    host = normHost(clean(params.get('h'), 253));
  }
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  const kind = params.get('k') as ClickKind;
  if (!host || !(CLICK_KINDS as readonly string[]).includes(kind)) return null;
  let page = clean(params.get('p'), 300) || '/';
  if (!page.startsWith('/')) page = '/' + page;
  // У просмотра target — откуда пришёл посетитель (см. traffic-source.ts).
  const target = kind === 'view' && params.has('r') ? storedSource(clean(params.get('r'), 120)) : clean(params.get('t'), 300);
  return { host, page, kind, label: clean(params.get('l'), 80) || '(без текста)', target };
}

export function recordClick(db: Db, e: ClickEvent, day: string = localToday()): void {
  db.prepare(
    `INSERT INTO button_clicks (day, host, page, kind, label, target, n) VALUES (?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(day, host, page, kind, label, target) DO UPDATE SET n = n + 1`
  ).run(day, e.host, e.page, e.kind, e.label, e.target);
}

/** Время на странице: d — секунды показа на экране с прошлой отправки (не больше 30 минут). */
export function parseTime(params: URLSearchParams, referer: string | null): { host: string; page: string; seconds: number } | null {
  const e = parseClick(new URLSearchParams({ ...Object.fromEntries(params), k: 'view' }), referer);
  const d = Math.round(Number(params.get('d')));
  if (!e || !Number.isFinite(d) || d <= 0) return null;
  return { host: e.host, page: e.page, seconds: Math.min(d, 1800) };
}

export function recordTime(db: Db, t: { host: string; page: string; seconds: number }, day: string = localToday()): void {
  db.prepare(
    `INSERT INTO page_time (day, host, page, seconds) VALUES (?, ?, ?, ?)
     ON CONFLICT(day, host, page) DO UPDATE SET seconds = seconds + excluded.seconds`
  ).run(day, t.host, t.page, t.seconds);
}

export function timeForRange(db: Db, startDate: string, endDate: string): { host: string; page: string; seconds: number }[] {
  return db
    .prepare('SELECT host, page, SUM(seconds) AS seconds FROM page_time WHERE day >= ? AND day <= ? GROUP BY host, page')
    .all(startDate, endDate) as { host: string; page: string; seconds: number }[];
}

/** Сколько событий сайт уже прислал сегодня — потолок от накрутки. */
export function clicksToday(db: Db, host: string, day: string = localToday()): number {
  const r = db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM button_clicks WHERE host = ? AND day = ?').get(host, day) as { n: number };
  return r.n;
}

export interface ClickRow { host: string; page: string; kind: ClickKind; label: string; target: string; n: number }

export function clicksForRange(db: Db, startDate: string, endDate: string): ClickRow[] {
  return db
    .prepare(
      `SELECT host, page, kind, label, target, SUM(n) AS n FROM button_clicks
       WHERE day >= ? AND day <= ? GROUP BY host, page, kind, label, target ORDER BY n DESC`
    )
    .all(startDate, endDate) as ClickRow[];
}

/**
 * Домены, от которых счётчик уже принимал события. Приём не должен зависеть
 * от того, ответил ли Google прямо сейчас: если консоль временно недоступна,
 * события её сайтов всё равно записываются.
 */
export function countedHosts(db: Db): Set<string> {
  const rows = db.prepare('SELECT DISTINCT host FROM button_clicks UNION SELECT DISTINCT host FROM page_time').all() as { host: string }[];
  return new Set(rows.map((r) => r.host));
}

// ─── Переход к оплате: после просмотра и один раз за 30 минут ───────────────
// Переход к оплате единый счётчик сайта считает по 302 на кассу. Настоящий
// покупатель сначала открывает страницу сайта (просмотр уходит при загрузке),
// а проверки и роботы часто идут сразу на кнопку: их просмотр перехвачен или
// не отправлен вовсе. Поэтому переход к оплате засчитывается, только если тот
// же посетитель (код вместо IP) в последние SEEN_MS что-то прислал с этого
// сайта. И не чаще раза в CHECKOUT_REPEAT_MS: человек, который трижды выбрал
// пакет и вернулся, — один переход, а проверка кнопок сайта (сотни нажатий
// подряд с одного адреса) — тоже один. Окно скользит: каждое нажатие его
// продлевает. Связки — в базе (counter_visitors), перезапуск панели их не
// стирает (13.11.2026: в памяти они пропадали при каждой выкладке панели, и
// проверка кнопок fccoinsprice.com дала 143 «перехода»).
const SEEN_MS = 3 * 3600_000;
export const CHECKOUT_REPEAT_MS = 30 * 60_000;
let marks = 0;

function visitorAt(db: Db, ip: string, host: string, kind: 'seen' | 'checkout'): number | null {
  const r = db.prepare('SELECT at FROM counter_visitors WHERE visitor = ? AND host = ? AND kind = ?').get(ip, host, kind) as { at: number } | undefined;
  return r ? r.at : null;
}
function setVisitorAt(db: Db, ip: string, host: string, kind: 'seen' | 'checkout', now: number): void {
  db.prepare('INSERT INTO counter_visitors (visitor, host, kind, at) VALUES (?, ?, ?, ?) ON CONFLICT(visitor, host, kind) DO UPDATE SET at = excluded.at').run(ip, host, kind, now);
}

/** Посетитель прислал с сайта просмотр, время или нажатие. */
export function markSeen(db: Db, ip: string, host: string, now: number = Date.now()): void {
  if (!ip || ip === 'worker' || ip === 'ping') return;
  setVisitorAt(db, ip, host, 'seen', now);
  if (++marks % 200 === 0) db.prepare('DELETE FROM counter_visitors WHERE at < ?').run(now - SEEN_MS);
}

/** Засчитать ли переход к оплате: ok; no-visit — посетитель не был на сайте;
 *  repeat — тот же посетитель уже переходил к оплате меньше 30 минут назад. */
export function checkoutVerdict(db: Db, ip: string, host: string, now: number = Date.now()): 'ok' | 'no-visit' | 'repeat' {
  if (!ip || ip === 'worker') return 'ok';
  const seen = visitorAt(db, ip, host, 'seen');
  if (seen === null || now - seen >= SEEN_MS) return 'no-visit';
  const prev = visitorAt(db, ip, host, 'checkout');
  setVisitorAt(db, ip, host, 'checkout', now);
  return prev !== null && now - prev < CHECKOUT_REPEAT_MS ? 'repeat' : 'ok';
}

// ─── Переход к оплате по источнику ──────────────────────────────────────────
// Сайт посетителю ничего не запоминает, поэтому источник перехода к оплате
// панель берёт у входа того же посетителя (тот же адрес от Worker'а) на этот
// же сайт за последние 30 минут. Связка живёт только в памяти панели.
const ENTRY_MS = 30 * 60_000;
const entries = new Map<string, { src: string; at: number }>();

/** Просмотр с источником (не переход внутри сайта) — запомнить, откуда пришёл. */
export function rememberEntry(ip: string, host: string, target: string, now: number = Date.now()): void {
  if (!ip || ip === 'worker' || !target || target === '(internal)') return;
  entries.set(`${ip}\n${host}`, { src: target, at: now });
  if (entries.size > 50_000) for (const [k, v] of entries) if (now - v.at > ENTRY_MS) entries.delete(k);
}

/** Откуда пришёл посетитель, который сейчас перешёл к оплате; '' — неизвестно. */
export function entrySource(ip: string, host: string, now: number = Date.now()): string {
  if (!ip || ip === 'worker') return '';
  const e = entries.get(`${ip}\n${host}`);
  return e && now - e.at < ENTRY_MS ? e.src : '';
}

// ─── Отказы (bounce rate) ───────────────────────────────────────────────────
// Визит — вход на сайт (просмотр с источником, не переход внутри сайта) и всё,
// что тот же посетитель делал на этом сайте дальше без перерыва в 30 минут.
// Отказ — визит, в котором не было ни второй страницы, ни нажатия (кнопки,
// ссылки, перехода к оплате), как Bounce rate в старом Google Analytics.
// Визит считается, когда закончился: новый вход или 30 минут тишины. Посетитель
// узнаётся так же, как для источника переходов к оплате (код вместо IP), и
// только в памяти панели; в базу пишутся лишь суммы за день по сайту.
const visits = new Map<string, { host: string; day: string; at: number; engaged: boolean }>();
let lastSweep = 0;

function closeVisit(db: Db, v: { host: string; day: string; engaged: boolean }): void {
  db.prepare(
    `INSERT INTO visit_stats (day, host, visits, bounces) VALUES (?, ?, 1, ?)
     ON CONFLICT(day, host) DO UPDATE SET visits = visits + 1, bounces = bounces + excluded.bounces`
  ).run(v.day, v.host, v.engaged ? 0 : 1);
}

/** Закрыть визиты, в которых 30 минут ничего не происходило. */
export function sweepVisits(db: Db, now: number = Date.now(), force = false): void {
  if (!force && now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of visits) {
    if (now - v.at >= ENTRY_MS) {
      visits.delete(k);
      closeVisit(db, v);
    }
  }
}

/** Событие посетителя — для отказов. target у просмотра: источник ('(internal)' — переход внутри сайта, '' — неизвестно). */
export function trackVisit(db: Db, ip: string, host: string, kind: string, target: string, now: number = Date.now()): void {
  sweepVisits(db, now);
  if (!ip || ip === 'worker') return;
  const k = `${ip}\n${host}`;
  const cur = visits.get(k);
  if (kind === 'view' && target !== '' && target !== '(internal)') {
    // Новый вход: прошлый визит этого посетителя на этом сайте закончился.
    if (cur) closeVisit(db, cur);
    visits.set(k, { host, day: localToday(now), at: now, engaged: false });
    return;
  }
  if (!cur || now - cur.at >= ENTRY_MS) return;
  if (kind === 'view' || kind === 'button' || kind === 'link' || kind === 'out' || kind === 'submit') {
    cur.engaged = true;
    cur.at = now;
  }
}

/** Визиты и отказы по сайтам за дни входа. */
export function visitStatsForRange(db: Db, startDate: string, endDate: string, now: number = Date.now()): { host: string; visits: number; bounces: number }[] {
  sweepVisits(db, now, true);
  return db
    .prepare('SELECT host, SUM(visits) AS visits, SUM(bounces) AS bounces FROM visit_stats WHERE day >= ? AND day <= ? GROUP BY host')
    .all(startDate, endDate) as { host: string; visits: number; bounces: number }[];
}

/** Для тестов: забыть визиты в памяти. */
export function resetVisits(): void {
  visits.clear();
  lastSweep = 0;
}

export function recordCheckoutSource(db: Db, host: string, source: string, day: string = localToday()): void {
  db.prepare(
    `INSERT INTO checkout_sources (day, host, source, n) VALUES (?, ?, ?, 1)
     ON CONFLICT(day, host, source) DO UPDATE SET n = n + 1`
  ).run(day, host, source || '(unknown)');
}

export function checkoutSourcesForRange(db: Db, startDate: string, endDate: string): { host: string; source: string; n: number }[] {
  return db
    .prepare('SELECT host, source, SUM(n) AS n FROM checkout_sources WHERE day >= ? AND day <= ? GROUP BY host, source')
    .all(startDate, endDate) as { host: string; source: string; n: number }[];
}

/** Когда от сайта последний раз приходили данные — проверка установки. */
export function lastSeen(db: Db): Record<string, string> {
  const rows = db.prepare('SELECT host, MAX(day) AS day FROM button_clicks GROUP BY host').all() as { host: string; day: string }[];
  return Object.fromEntries(rows.map((r) => [r.host, r.day]));
}

// Ограничение частоты в памяти: с одного IP не больше LIMIT событий за окно,
// повтор того же нажатия в течение DEDUPE_MS не считаем (двойной клик).
const WINDOW_MS = 10 * 60_000;
const LIMIT = 120;
const DEDUPE_MS = 3_000;
const perIp = new Map<string, { n: number; reset: number }>();
const recent = new Map<string, number>();

export function allowClick(ip: string, e: ClickEvent, now: number = Date.now()): boolean {
  const cur = perIp.get(ip);
  if (!cur || cur.reset < now) perIp.set(ip, { n: 1, reset: now + WINDOW_MS });
  else if (++cur.n > LIMIT) return false;
  const k = `${ip}\n${e.host}\n${e.page}\n${e.kind}\n${e.label}\n${e.target}`;
  const last = recent.get(k);
  recent.set(k, now);
  if (perIp.size > 50_000 || recent.size > 50_000) {
    for (const [key, v] of perIp) if (v.reset < now) perIp.delete(key);
    for (const [key, t] of recent) if (now - t > DEDUPE_MS) recent.delete(key);
  }
  return !(last && now - last < DEDUPE_MS);
}

/** Старый общий скрипт /c.js отключён: он связывал сайты одним внешним адресом. */
export function counterScript(_origin: string): string {
  return '/* GSC Hub: этот счётчик отключён — подсчёт идёт через Cloudflare Worker сайта. */\n';
}

/** Боты и проверялки: их просмотры не считаем. */
export function isBotUA(ua: string): boolean {
  if (!ua || !/mozilla\//i.test(ua)) return true;
  return /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|inspectiontool|facebookexternalhit|embedly|quora|pinterest|ahrefs|semrush|mj12|yandex|baidu|bytespider|petal|gptbot|claude|perplexity|python|curl|wget|httpclient|go-http|java\/|gschubcheck|uptime|monitor|pingdom|statuscake/i.test(ua);
}

/** Класс ссылки, по которому она считается кнопкой (кнопки на разных языках, рекламные ссылки). */
const BUTTON_CLASS = /(^|[\s_-])(btn|button|boton|bouton|knop|pulsante|kick|cta)|sponsored/i;

/**
 * Событие от Cloudflare Worker сайта: { h: хост, e: JSON события из страницы }.
 * Событие: { k, p, l?, t?, d? }.
 */
export function parseWorkerEvent(
  body: unknown
): { click: ClickEvent } | { time: { host: string; page: string; seconds: number } } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { h?: unknown; e?: unknown };
  let ev: Record<string, unknown>;
  try {
    ev = typeof b.e === 'string' ? JSON.parse(b.e) : (b.e as Record<string, unknown>);
  } catch {
    return null;
  }
  if (!ev || typeof ev !== 'object') return null;
  const params = new URLSearchParams();
  params.set('h', String(b.h ?? ''));
  for (const k of ['k', 'p', 'l', 't', 'd', 'r']) if (ev[k] !== undefined && ev[k] !== null) params.set(k, String(ev[k]));
  // Счётчик сайта не решает сам, кнопка ли это: присылает класс ссылки (c) и
  // признак кнопки (b), решаем здесь — словаря кнопок в странице нет.
  if (params.get('k') === 'link' && (ev.b || BUTTON_CLASS.test(String(ev.c ?? '')))) params.set('k', 'button');
  if (params.get('k') === 'submit' && !params.get('l')) params.set('l', 'форма');
  if (params.get('k') === 'time') {
    const t = parseTime(params, null);
    return t ? { time: t } : null;
  }
  const c = parseClick(params, null);
  return c ? { click: c } : null;
}

/** Старый общий путь событий. Новый Worker у каждого сайта берёт свой (см. counterVariant). */
export const SITE_PATH = '/_e';

/**
 * Код счётчика для страницы — заготовка с метками:
 *   @имя@   — имя переменной или свойства,
 *   #поле#  — название поля в событии,
 *   $вид$   — вид события ('view', 'link'…), в кавычках,
 *   %EV%    — адрес, куда слать события, %SK% — ключ в sessionStorage.
 * Блоки между head и tail друг от друга не зависят: у каждого сайта свой порядок.
 * Просмотр несёт r — откуда пришёл посетитель: домен прошлого сайта, '' — без
 * адреса (прямой заход), '=' — переход внутри сайта, обновление или «Назад».
 * «Перешли к оплате» записывается на ту страницу, где нажали кнопку, и только
 * когда после отправки формы реально открылась страница из её action.
 * Что считать кнопкой, решает панель (по классу ссылки), — в странице этого нет.
 */
const COUNTER_HEAD = String.raw`(function(){if(window.@G@)return;window.@G@=1;var @P@=%EV%;
function @send@(@o@){if(!@o@.#p#)@o@.#p#=location.pathname;var @b@=JSON.stringify(@o@);try{if(navigator.sendBeacon&&navigator.sendBeacon(@P@,new Blob([@b@],{type:'application/json'})))return}catch(@e@){}try{fetch(@P@,{method:'POST',body:@b@,keepalive:true,headers:{'Content-Type':'application/json'}})}catch(@e@){}}
var @nav@={};try{@nav@=(performance.getEntriesByType&&performance.getEntriesByType('navigation')[0])||{}}catch(@e@){}
var @r@='';try{if(document.referrer){var @ru@=new URL(document.referrer);@r@=@ru@.host===location.host?'=':@ru@.host}}catch(@e@){@r@='?'}
if(@nav@.type==='reload'||@nav@.type==='back_forward')@r@='=';
if(@r@===''){try{var @us@=new URLSearchParams(location.search).get('utm_source');if(@us@)@r@='utm:'+@us@}catch(@e@){}}
@send@({#k#:$view$,#r#:@r@});
try{var @s@=JSON.parse(sessionStorage.getItem(%SK%)||'null');sessionStorage.removeItem(%SK%);if(@s@&&@nav@.type!=='reload'&&Date.now()-@s@.@sat@<600000&&location.pathname===@s@.@sa@)@send@({#k#:$submit$,#l#:@s@.@sl@,#t#:@s@.@sa@,#p#:@s@.@sf@||@s@.@sa@})}catch(@e@){}
`;
const COUNTER_BLOCKS = [
  String.raw`var @sh@=document.visibilityState==='visible'?Date.now():0,@acc@=0;
function @flush@(){if(@sh@){@acc@+=Date.now()-@sh@;@sh@=0}var @d@=Math.round(@acc@/1000);if(@d@<1)return;@acc@=0;@send@({#k#:$time$,#d#:@d@})}
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden')@flush@();else @sh@=Date.now()});
addEventListener('pagehide',@flush@);
`,
  String.raw`function @label@(@el@){return((@el@&&(@el@.getAttribute('data-track')||@el@.getAttribute('aria-label')||@el@.innerText||@el@.value||@el@.title))||'').trim().slice(0,80)}
`,
  String.raw`function @where@(@h@){try{var @u@=new URL(@h@,location.href);return @u@.host===location.host?@u@.pathname+@u@.search+@u@.hash:@u@.host+@u@.pathname}catch(@e@){return @h@||''}}
`,
  String.raw`document.addEventListener('click',function(@ev@){var @el@=@ev@.target&&@ev@.target.closest&&@ev@.target.closest('a,button,[data-track],input[type=submit]');if(!@el@)return;
if((@el@.tagName==='BUTTON'&&(@el@.type||'submit')==='submit'&&@el@.form)||(@el@.tagName==='INPUT'&&@el@.form))return;
var @h@=@el@.getAttribute('href')||'',@k@=$link$;
if(@el@.tagName==='A'&&@h@&&!/^(#|javascript:|mailto:|tel:)/i.test(@h@)){try{if(new URL(@h@,location.href).host!==location.host)@k@=$out$}catch(@e@){}}
var @o@={#k#:@k@,#l#:@label@(@el@),#t#:@h@?@where@(@h@):''};
if(@k@===$link$){@o@.#c#=((@el@.getAttribute('class')||'')+' '+(@el@.getAttribute('rel')||'')).slice(0,160);if(@el@.tagName==='BUTTON'||@el@.hasAttribute('data-track'))@o@.#b#=1}
@send@(@o@)},true);
`,
  String.raw`document.addEventListener('submit',function(@ev@){var @f@=@ev@.target;if(!@f@||@f@.tagName!=='FORM')return;var @bt@=@ev@.submitter||@f@.querySelector('button[type=submit],button:not([type]),input[type=submit]');var @a@;try{@a@=new URL(@f@.getAttribute('action')||location.pathname,location.href)}catch(@e@){return}
if(@a@.host!==location.host){@send@({#k#:$out$,#l#:@label@(@bt@),#t#:@a@.host+@a@.pathname});return}
try{sessionStorage.setItem(%SK%,JSON.stringify({@sa@:@a@.pathname,@sf@:location.pathname,@sl@:@label@(@bt@),@sat@:Date.now()}))}catch(@e@){}},true);
`
];
const COUNTER_TAIL = '})();';

const tokenList = (re: RegExp) => [...new Set([...[COUNTER_HEAD, ...COUNTER_BLOCKS].join('').matchAll(re)].map((m) => m[1]))];

const COUNTER_IDS = tokenList(/@([A-Za-z]+)@/g);
const COUNTER_FIELDS = tokenList(/#([a-z]+)#/g);
const COUNTER_KINDS = tokenList(/\$([a-z]+)\$/g);

/** Случайные числа от 16 байт (sfc32): у одного сайта — всегда одна и та же последовательность. */
function counterRng(x: Uint8Array): () => number {
  const w = (i: number) => ((x[i] << 24) | (x[i + 1] << 16) | (x[i + 2] << 8) | x[i + 3]) >>> 0;
  let a = w(0), b = w(4), c = w(8), d = w(12);
  const next = () => {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}

interface CounterNames { ids: Record<string, string>; fields: Record<string, string>; kinds: Record<string, string>; events: string; storage: string; order?: number[] }

function buildCounter(m: CounterNames): string {
  const blocks = m.order ? m.order.map((i) => COUNTER_BLOCKS[i]) : COUNTER_BLOCKS;
  return (COUNTER_HEAD + blocks.join('') + COUNTER_TAIL)
    .replace(/@([A-Za-z]+)@/g, (_, n: string) => m.ids[n] ?? n)
    .replace(/#([a-z]+)#/g, (_, n: string) => m.fields[n] ?? n)
    .replace(/\$([a-z]+)\$/g, (_, n: string) => JSON.stringify(m.kinds[n] ?? n))
    .replace(/%EV%/g, () => JSON.stringify(m.events))
    .replace(/%SK%/g, () => JSON.stringify(m.storage));
}

export interface CounterVariant {
  /** Адрес файла счётчика на сайте. */
  script: string;
  /** Адрес на сайте, куда страница шлёт события. */
  events: string;
  /** Сам файл счётчика. */
  js: string;
  /** Название поля / вида события у этого сайта → обычное. */
  back: Record<string, string>;
  kback: Record<string, string>;
}

/**
 * Вариант счётчика из 32 байт: свой адрес файла и событий, свои имена, названия
 * полей, виды событий и порядок блоков. Адреса выводятся первыми — правка
 * заготовки (новая переменная) их не сдвигает, открытые у посетителей страницы
 * продолжают слать туда же.
 */
function makeVariant(bytes: Uint8Array): CounterVariant {
  const paths = counterRng(bytes.subarray(0, 16));
  const rnd = counterRng(bytes.subarray(16, 32));
  const LOW = 'abcdefghijklmnopqrstuvwxyz', LET = LOW + LOW.toUpperCase(), DIG = '0123456789';
  const used = new Set(['do', 'if', 'in']);
  const fresh = (gen: () => string) => {
    for (;;) {
      const n = gen();
      if (!used.has(n)) return used.add(n), n;
    }
  };
  const from = (r: () => number) => ({
    pick: <T,>(s: ArrayLike<T>): T => s[Math.floor(r() * s.length)],
    word(min: number, max: number) {
      const n = min + Math.floor(r() * (max - min + 1));
      let w = this.pick(LOW);
      while (w.length < n) w += this.pick(LOW + DIG);
      return w;
    }
  });
  const P = from(paths), R = from(rnd);
  const script = '/' + P.pick(['assets', 'static', 'js', 'lib', 'res', 'media', 'inc', 'build', 'dist', 'files']) + '/' + fresh(() => P.word(6, 9)) + '.js';
  const events = '/' + P.pick(['api', 'x', 'q', 'v', 'm', 'i', 'u', 'w', 'data', 'srv']) + '/' + fresh(() => P.word(5, 8));
  const storage = fresh(() => P.word(4, 8));
  const ids: Record<string, string> = {}, fields: Record<string, string> = {}, kinds: Record<string, string> = {};
  const back: Record<string, string> = {}, kback: Record<string, string> = {};
  for (const n of COUNTER_IDS) ids[n] = fresh(() => R.pick(LET) + (rnd() < 0.55 ? R.pick(LET + DIG + '_') : ''));
  ids.G = fresh(() => '_' + R.word(3, 5));
  for (const n of COUNTER_FIELDS) back[(fields[n] = fresh(() => R.word(1, 2)))] = n;
  for (const n of COUNTER_KINDS) kback[(kinds[n] = fresh(() => R.word(1, 3)))] = n;
  const order = COUNTER_BLOCKS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return { script, events, back, kback, js: buildCounter({ ids, fields, kinds, events, storage, order }) };
}

const VARIANT_SALT = 'gsc-hub-counter\n';
const variantCache = new Map<string, CounterVariant>();

/** Вариант счётчика сайта для ключа, который стоит в его Worker (COUNTER_KEY). */
export function counterVariant(host: string, key: string): CounterVariant {
  const h = normHost(host);
  const ck = key + '\n' + h;
  let v = variantCache.get(ck);
  if (!v) {
    v = makeVariant(new Uint8Array(createHash('sha256').update(VARIANT_SALT + ck).digest()));
    if (variantCache.size >= 500) variantCache.clear();
    variantCache.set(ck, v);
  }
  return v;
}

/** Что Worker сайта берёт из панели: где лежит файл счётчика, куда слать события, сам файл. */
export function siteCounterConfig(host: string, key: string): { script: string; events: string; js: string } {
  const { script, events, js } = counterVariant(host, key);
  return { script, events, js };
}

/** Событие страницы с названиями этого сайта → JSON с обычными названиями (k, p, l, t, d, r, c, b). */
export function decodeCounterEvent(v: CounterVariant, body: string): string | null {
  let o: unknown;
  try {
    o = JSON.parse(body);
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(o)) if (Object.hasOwn(v.back, k)) out[v.back[k]] = val;
  if (typeof out.k === 'string' && Object.hasOwn(v.kback, out.k)) out.k = v.kback[out.k];
  return out.k ? JSON.stringify(out) : null;
}

/**
 * Тело от Worker → вход для parseWorkerEvent. Новый Worker присылает событие
 * страницы как есть ({ h, b }) — переводим его здесь ключом, с которым он пришёл.
 * Готовые события ({ h, e }: переход к оплате, старые Worker) — без изменений.
 */
export function workerEventInput(body: unknown, key: string | null): unknown {
  if (!body || typeof body !== 'object') return body;
  const { h, b } = body as { h?: unknown; b?: unknown };
  if (typeof b !== 'string') return body;
  if (!key || b.length > 4000) return null;
  return { h, e: decodeCounterEvent(counterVariant(String(h ?? ''), key), b) };
}

/** Код счётчика с обычными именами (для проверок). На сайты уходит только вариант. */
export function pageSnippet(path: string = SITE_PATH): string {
  return buildCounter({ ids: { G: '__ghc' }, fields: {}, kinds: {}, events: path, storage: '__ghs' });
}

/**
 * Код Cloudflare Worker. Ставится один раз: файл счётчика, его адрес и адрес
 * событий Worker берёт из панели (GET /c/site) и обновляет сам, а события
 * страницы пересылает как есть — переводит их панель. Поэтому всё, что
 * меняется в счётчике, меняется только в панели.
 */
export function workerScript(panelOrigin: string): string {
  return `// GSC Hub — счётчик просмотров, времени и кнопок для сайта (Cloudflare Worker).
// Ставится один раз. Файл счётчика Worker берёт из панели и раз в 10 минут
// обновляет сам: у каждого сайта он свой (адрес, имена внутри, названия полей),
// и при обновлениях счётчика этот код менять не нужно.
// Если панель не отвечает, сайт работает как обычно — только без подсчёта.
// На сайте меняется только одно: в <head> HTML-страниц добавляется
// <script src="…" defer> — файл с адреса самого сайта (его отдаёт этот Worker),
// поэтому защита сайта (Content-Security-Policy: script-src 'self') его пропускает.
// Ключ панели — в секрете Worker COUNTER_KEY (Settings → Variables and Secrets), не в коде.
const PANEL = ${JSON.stringify(panelOrigin + '/c')};
const FRESH_MS = 10 * 60 * 1000; // настройки сайта обновляются раз в 10 минут
const RETRY_MS = 60 * 1000; // панель не ответила — снова спросим через минуту
const WAIT_MS = 1000; // первую страницу из-за панели держим не дольше секунды, остальные не держим
const SITES = new Map();

function loadConfig(env, host) {
  return fetch(PANEL + '/site?h=' + encodeURIComponent(host), {
    headers: { 'X-Counter-Key': env.COUNTER_KEY || '' },
    signal: AbortSignal.timeout(5000),
    cf: { cacheEverything: true, cacheTtlByStatus: { '200-299': 600, '300-599': 0 } }
  })
    .then((r) => (r.status === 200 ? r.json() : null))
    .then((c) => (c && typeof c.script === 'string' && typeof c.events === 'string' && typeof c.js === 'string' ? c : null))
    .catch(() => null);
}

/**
 * Настройки сайта. Есть (пусть и старые) — сразу, обновление идёт в фоне.
 * Нет никаких — панель ждёт только первая страница и не дольше WAIT_MS;
 * следующие, пока панель молчит, открываются без счётчика и без ожидания.
 */
async function siteConfig(env, ctx, host) {
  let s = SITES.get(host);
  if (!s) SITES.set(host, (s = { cfg: null, next: 0, pending: null, waited: false }));
  if (Date.now() >= s.next && !s.pending) {
    s.pending = loadConfig(env, host).then((cfg) => {
      if (cfg) s.cfg = cfg;
      s.next = Date.now() + (cfg ? FRESH_MS : RETRY_MS);
      s.pending = null;
      return s.cfg;
    });
    ctx.waitUntil(s.pending);
  }
  if (s.cfg || !s.pending || s.waited) return s.cfg;
  s.waited = true;
  return Promise.race([s.pending, new Promise((r) => setTimeout(() => r(null), WAIT_MS))]);
}

function forward(env, ctx, request, host, data) {
  if (!env.COUNTER_KEY) return;
  ctx.waitUntil(
    fetch(PANEL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Counter-Key': env.COUNTER_KEY,
        'X-Client-IP': request.headers.get('CF-Connecting-IP') || '',
        'X-Client-UA': request.headers.get('User-Agent') || ''
      },
      body: JSON.stringify(Object.assign({ h: host }, data))
    }).catch(() => {})
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase().replace(/^www\\./, '').replace(/\\.$/, '');
    const cfg = await siteConfig(env, ctx, host);
    if (cfg && url.pathname === cfg.script) {
      return new Response(cfg.js, { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
    }
    if (cfg && url.pathname === cfg.events) {
      if (request.method === 'POST') {
        const b = await request.text();
        if (b.length <= 4000) forward(env, ctx, request, host, { b });
      }
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }
    const res = await fetch(request);
    const isPage = request.method === 'GET' && request.headers.get('Sec-Fetch-Dest') === 'document';
    // Переход к оплате сразу перенаправлением на другой сайт (касса): страница
    // сайта не открывается, поэтому считаем здесь — «дошли до оплаты».
    const loc = res.headers.get('Location');
    if (isPage && res.status >= 300 && res.status < 400 && loc) {
      try {
        const to = new URL(loc, url);
        if (to.hostname.replace(/^www\\./, '') !== url.hostname.replace(/^www\\./, '')) {
          const target = (url.pathname + url.search).slice(0, 300);
          // Страница, где нажали кнопку, — из Referer (если это этот же сайт).
          let from = url.pathname;
          try {
            const ref = new URL(request.headers.get('Referer') || '');
            if (ref.hostname === url.hostname) from = ref.pathname;
          } catch (e) {}
          forward(env, ctx, request, host, { e: JSON.stringify({ k: 'submit', p: from, l: 'Переход к оплате', t: target }) });
        }
      } catch (e) {}
      return res;
    }
    if (!cfg || request.method !== 'GET' || !(res.headers.get('Content-Type') || '').includes('text/html')) return res;
    return new HTMLRewriter()
      .on('head', { element(el) { el.append('<script src="' + cfg.script + '" defer></script>', { html: true }); } })
      .transform(res);
  }
};
`;
}
