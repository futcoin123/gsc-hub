// Единый счётчик сайта (с 13.11.2026). Раньше у каждого сайта был свой код,
// написанный руками: где-то без источника, где-то со своим форматом, у всех —
// код посетителя, который менялся между запросами (отказы 100 %). Теперь сайт
// получает два файла, одинаковых по устройству и разных снаружи:
//   1) код страницы — дописывается в конец общего JS сайта: просмотр (с тем,
//      откуда пришёл посетитель), секунды на странице, нажатия. Имена
//      переменных, полей и видов событий — свои у каждого сайта (выводятся из
//      домена); в браузер ничего не пишется (ни cookie, ни storage);
//   2) gsc-counter.js — модуль Pages Functions: принимает события на своём
//      адресе сайта, отсеивает роботов, переводит имена обратно и пересылает
//      в панель с ключом COUNTER_KEY; сам считает переход к оплате (ответ 3xx
//      на другой сайт после нажатия на этом); код посетителя — HMAC ключа от
//      даты и IP: один и тот же весь день на всех серверах Cloudflare, IP из
//      функции не уходит. Проверка связи из панели ({"gsc_ping":1}) доходит
//      до панели и в статистику не попадает.
// Обычный JS без зависимостей: его берут и панель («Кнопки» → «Единый
// счётчик»), и команда scripts/counter-kit.mjs для сессий сайтов.
import { createHash } from 'node:crypto';

export const KIT_VERSION = '1';

const HEAD = String.raw`(function(){if(window.@G@)return;window.@G@=1;var @P@=%EV%;
function @send@(@o@){@o@.#p#=location.pathname;var @b@=JSON.stringify(@o@);try{if(navigator.sendBeacon&&navigator.sendBeacon(@P@,new Blob([@b@],{type:'application/json'})))return}catch(@e@){}try{fetch(@P@,{method:'POST',body:@b@,keepalive:true,credentials:'omit',headers:{'Content-Type':'application/json'}})}catch(@e@){}}
var @nav@={};try{@nav@=(performance.getEntriesByType&&performance.getEntriesByType('navigation')[0])||{}}catch(@e@){}
var @r@='';try{if(document.referrer){var @ru@=new URL(document.referrer);@r@=@ru@.host===location.host?'=':@ru@.host}}catch(@e@){@r@='?'}
if(@nav@.type==='reload'||@nav@.type==='back_forward')@r@='=';
if(@r@===''){try{var @us@=new URLSearchParams(location.search).get('utm_source');if(@us@)@r@='utm:'+@us@.slice(0,40)}catch(@e@){}}
@send@({#k#:$view$,#r#:@r@});
`;
const BLOCKS = [
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
if(@a@.host!==location.host)@send@({#k#:$out$,#l#:@label@(@bt@),#t#:@a@.host+@a@.pathname})},true);
`
];
const TAIL = '})();';

/** @param {RegExp} re */
const tokens = (re) => [...new Set([...[HEAD, ...BLOCKS].join('').matchAll(re)].map((m) => m[1]))];
const IDS = tokens(/@([A-Za-z]+)@/g);
const FIELDS = tokens(/#([a-z]+)#/g);
const KINDS = tokens(/\$([a-z]+)\$/g);

/** Случайные числа из 16 байт (sfc32): у одного сайта — всегда одна и та же последовательность.
 * @param {Uint8Array} x
 * @returns {() => number} */
function rng(x) {
  /** @param {number} i */
  const w = (i) => ((x[i] << 24) | (x[i + 1] << 16) | (x[i + 2] << 8) | x[i + 3]) >>> 0;
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

/**
 * @typedef {object} CounterKit
 * @property {string} host
 * @property {string} events  адрес сайта, куда страница шлёт события
 * @property {string} page    код страницы: дописать в конец общего JS сайта
 * @property {string} module  gsc-counter.js — модуль Pages Functions
 * @property {Record<string, string>} fields  имя поля на странице → обычное
 * @property {Record<string, string>} kinds   вид события на странице → обычный
 * @property {string} version
 */

/** Адрес событий: путь вида /слово/ (буквы, цифры, дефис), не /c и не служебный.
 * @param {string | null | undefined} v
 * @returns {string | null} */
export function cleanEventsPath(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const p = (s.startsWith('/') ? s : '/' + s).replace(/\/?$/, '/');
  return /^\/[a-z0-9][a-z0-9-]{1,30}\/$/i.test(p) && !/^\/(c|api|cdn-cgi|_)/i.test(p) ? p.toLowerCase() : null;
}

/**
 * Файлы счётчика для сайта. Имена и порядок блоков выводятся из домена: у
 * сайта всегда одни и те же, у разных сайтов — разные.
 * @param {string} host
 * @param {string} panelOrigin  адрес панели, например https://panel.example
 * @param {string | null} [eventsPath]  свой адрес событий сайта (/segnale/); нет — придумывается
 * @returns {CounterKit}
 */
export function counterKit(host, panelOrigin, eventsPath) {
  const h = host.toLowerCase().replace(/^www\./, '');
  const seed = createHash('sha256').update(`gsc-hub-kit\n${KIT_VERSION}\n${h}`).digest();
  const rnd = rng(new Uint8Array(seed.subarray(0, 16)));
  const pathRnd = rng(new Uint8Array(seed.subarray(16, 32)));
  const LOW = 'abcdefghijklmnopqrstuvwxyz', LET = LOW + LOW.toUpperCase(), DIG = '0123456789';
  const used = new Set(['do', 'if', 'in', 'var', 'new', 'try', 'for']);
  /** @param {() => string} gen */
  const fresh = (gen) => {
    for (;;) {
      const n = gen();
      if (!used.has(n)) return used.add(n), n;
    }
  };
  /** @param {() => number} r @param {string} s */
  const pick = (r, s) => s[Math.floor(r() * s.length)];
  /** @param {() => number} r @param {number} min @param {number} max */
  const word = (r, min, max) => {
    const n = min + Math.floor(r() * (max - min + 1));
    let w = pick(r, LOW);
    while (w.length < n) w += pick(r, LOW + DIG);
    return w;
  };
  const events = cleanEventsPath(eventsPath) ?? `/${word(pathRnd, 4, 7)}/`;
  /** @type {Record<string, string>} */ const ids = {};
  /** @type {Record<string, string>} */ const fields = {};
  /** @type {Record<string, string>} */ const kinds = {};
  /** @type {Record<string, string>} */ const fback = {};
  /** @type {Record<string, string>} */ const kback = {};
  for (const n of IDS) ids[n] = fresh(() => pick(rnd, LET) + (rnd() < 0.6 ? pick(rnd, LET + DIG + '_') : ''));
  ids.G = fresh(() => '_' + word(rnd, 3, 6));
  for (const n of FIELDS) fback[(fields[n] = fresh(() => word(rnd, 1, 2)))] = n;
  for (const n of KINDS) kback[(kinds[n] = fresh(() => word(rnd, 1, 3)))] = n;
  const order = BLOCKS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const page = (HEAD + order.map((i) => BLOCKS[i]).join('') + TAIL)
    .replace(/@([A-Za-z]+)@/g, (_, n) => ids[n])
    .replace(/#([a-z]+)#/g, (_, n) => fields[n])
    .replace(/\$([a-z]+)\$/g, (_, n) => JSON.stringify(kinds[n]))
    .replace(/%EV%/g, () => JSON.stringify(events));
  return { host: h, events, page, module: kitModule(h, events, panelOrigin, fback, kback), fields: fback, kinds: kback, version: KIT_VERSION };
}

/** @param {unknown} v */
const J = (v) => JSON.stringify(v);

/**
 * @param {string} host
 * @param {string} events
 * @param {string} panelOrigin
 * @param {Record<string, string>} fields
 * @param {Record<string, string>} kinds
 * @returns {string}
 */
function kitModule(host, events, panelOrigin, fields, kinds) {
  return `// GSC Hub — единый счётчик сайта ${host}, версия ${KIT_VERSION}.
// Файл выдаёт панель («Кнопки» → «Единый счётчик»): не править руками, новую
// версию — скачать заново. Подключение в functions/_middleware.js:
//   import { gscCounter } from '../gsc-counter.js';
//   export const onRequest = [gscCounter, /* свой middleware сайта, если есть */];
// Ключ — секрет Pages COUNTER_KEY. Без него ничего не отправляется,
// GET ${events} отвечает x-counter: off.
const SITE = ${J(host)};
const PANEL = ${J(panelOrigin.replace(/\/$/, '') + '/c')};
const EVENTS = ${J(events)};
const VERSION = ${J(KIT_VERSION)};
// Имена полей и видов событий в коде страницы этого сайта → обычные.
const FIELDS = ${J(fields)};
const KINDS = ${J(kinds)};
const PAGE_KINDS = new Set(['view', 'time', 'link', 'out']);
const LABEL = 'Mozilla/5.0 (compatible; site-counter)';
const NOT_PEOPLE = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|inspection|externalhit|embedly|quora|pinterest|ahrefs|semrush|mj12|yandex|baidu|bytespider|petal|gptbot|claude|perplexity|python|curl|wget|httpclient|go-http|java\\/|node|undici|playwright|puppeteer|phantom|selenium|monitor|uptime|pingdom|statuscake|gschubcheck/i;

const enc = new TextEncoder();
let mac = null;
let macFor = '';

// Код посетителя: HMAC ключа от даты (UTC) и IP. Один и тот же у человека весь
// день на любом сервере Cloudflare — панель связывает его просмотры, нажатия
// и переход к оплате (отказы, источник оплаты). Сам IP из функции не уходит.
async function visitor(key, ip) {
  if (macFor !== key) {
    mac = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    macFor = key;
  }
  const day = new Date().toISOString().slice(0, 10);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', mac, enc.encode(day + '|' + (ip || ''))));
  return 'v' + [...sig.slice(0, 8)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function send(ctx, event, who) {
  const key = ctx.env && ctx.env.COUNTER_KEY;
  if (!key) return;
  ctx.waitUntil(
    (who ? Promise.resolve(who) : visitor(key, ctx.request.headers.get('CF-Connecting-IP')))
      .then((id) => fetch(PANEL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Counter-Key': key, 'X-Client-IP': id, 'X-Client-UA': LABEL },
        body: JSON.stringify({ h: SITE, e: JSON.stringify(event) }),
      }))
      .then((r) => { if (r.status !== 204) console.log('gsc-counter: панель ответила ' + r.status); })
      .catch((e) => console.log('gsc-counter: ' + e.message)),
  );
}

const cut = (v, n) => String(v == null ? '' : v).replace(/[\\u0000-\\u001f]/g, ' ').trim().slice(0, n);
const bare = (h) => String(h || '').toLowerCase().replace(/^www\\./, '');

function person(request, url) {
  const ua = request.headers.get('user-agent') || '';
  return bare(url.hostname) === SITE && /mozilla\\//i.test(ua) && !NOT_PEOPLE.test(ua);
}

let lastPing = 0;

async function receive(ctx, url) {
  const { request, env } = ctx;
  const reply = () => new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store, no-transform', 'X-Robots-Tag': 'noindex', 'x-counter': env && env.COUNTER_KEY ? 'on' : 'off', 'x-counter-kit': VERSION },
  });
  if (request.method !== 'POST') return reply();
  let o = null;
  try {
    const raw = await request.text();
    o = raw.length <= 2000 ? JSON.parse(raw) : null;
  } catch {
    return reply();
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return reply();
  // Проверка связи из панели: доходит ли событие до панели с ключом этого сайта.
  if (o.gsc_ping === 1) {
    if (Date.now() - lastPing > 10000) {
      lastPing = Date.now();
      send(ctx, { k: 'test', p: '/' }, 'ping');
    }
    return reply();
  }
  const same = (request.headers.get('sec-fetch-site') || 'same-origin') === 'same-origin' && (!request.headers.get('origin') || request.headers.get('origin') === url.origin);
  if (!same || !person(request, url)) return reply();
  const ev = {};
  for (const [k, v] of Object.entries(o)) if (Object.prototype.hasOwnProperty.call(FIELDS, k)) ev[FIELDS[k]] = v;
  const kind = Object.prototype.hasOwnProperty.call(KINDS, ev.k) ? KINDS[ev.k] : '';
  if (!PAGE_KINDS.has(kind)) return reply();
  const out = { k: kind, p: cut(ev.p, 300) || '/' };
  if (kind === 'view') out.r = cut(ev.r, 120);
  else if (kind === 'time') {
    out.d = Math.min(Math.max(Math.round(Number(ev.d)) || 0, 0), 1800);
    if (!out.d) return reply();
  } else {
    out.l = cut(ev.l, 80);
    out.t = cut(ev.t, 300);
    if (ev.c) out.c = cut(ev.c, 160);
    if (ev.b) out.b = 1;
  }
  send(ctx, out);
  return reply();
}

// Переход к оплате: страница сайта, нажали кнопку — и адрес сайта ответил
// перенаправлением на другой сайт (касса). Только браузер, только с Referer
// этого сайта; свои перенаправления (www, слеш) не в счёт.
function checkout(ctx, url, res) {
  const { request } = ctx;
  if (request.method !== 'GET' || res.status < 300 || res.status >= 400) return;
  const loc = res.headers.get('location');
  if (!loc) return;
  let to;
  try { to = new URL(loc, url); } catch { return; }
  if (bare(to.hostname) === bare(url.hostname)) return;
  const dest = request.headers.get('sec-fetch-dest');
  if (dest && dest !== 'document') return;
  let from = null;
  try { const r = new URL(request.headers.get('referer') || ''); if (bare(r.hostname) === bare(url.hostname)) from = r.pathname; } catch { /* без Referer */ }
  if (!from || !person(request, url)) return;
  const what = [...url.searchParams.values()].map((v) => cut(v, 20)).filter(Boolean).join(' ');
  send(ctx, { k: 'submit', p: cut(from, 300), l: cut(('checkout ' + what).trim(), 80), t: cut(url.pathname, 300) });
}

export async function gscCounter(ctx) {
  const url = new URL(ctx.request.url);
  if (url.pathname === EVENTS || url.pathname === EVENTS.slice(0, -1)) return receive(ctx, url);
  const res = await ctx.next();
  try { checkout(ctx, url, res); } catch { /* счётчик не ломает сайт */ }
  return res;
}

export const onRequest = gscCounter;
`;
}
