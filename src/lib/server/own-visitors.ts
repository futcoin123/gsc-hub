// Свои визиты и роботы — не в статистику (просьба владелицы 21–22.11.2026:
// «отказы, время на сайте и переходы к оплате должны быть настоящими»).
// Счётчик на сайтах (единый, версия 2) не меняется: всё решает панель по тому,
// что он уже присылает.
//
// Как панель узнаёт своих. Сайт вместо IP присылает код посетителя — HMAC
// ключа счётчика от даты (UTC) и IP. Ключ один на все сайты, и панель его
// знает, поэтому она сама считает код для любого IP. IP своих она запоминает:
//   • каждого, кто заходит в панель (IPv4 — по запросу, IPv6 — браузер
//     спрашивает свой адрес у api64.ipify.org: панель доступна только по IPv4,
//     а сайты на Cloudflare видят IPv6);
//   • по ссылке для сотрудников (без входа в панель, с секретом в адресе);
//   • вписанные руками.
// IP хранится TEAM_IP_DAYS дней с последнего захода. Коды на сегодня и вчера
// (UTC) считаются заново, когда меняется список или день.
//
// По поведению (тот же код посетителя за день):
//   • свои — открывал сайты на двух и более языках, кроме английского
//     (итальянский и польский сайт в один день — это проверка сети, а не
//     покупатель: сайты одной страны конкурируют, разные страны — нет);
//   • робот — ROBOT_VIEWS и больше страниц за ROBOT_MS (человек столько не
//     читает; проверки и сканеры — да).
// Узнали не с первого события — уже записанное за день у этого посетителя
// вычитается: просмотры и нажатия, время, визит и отказ, переход к оплате
// (журнал visitor_events, хранится LEDGER_MS).
import { createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import type { Db } from './db';
import { getConfigValue, setConfigValue } from './config';

export type OwnReason = 'team' | 'robot';

export const TEAM_IP_DAYS = 30;
export const ROBOT_VIEWS = 10;
export const ROBOT_MS = 60_000;
const LEDGER_MS = 2 * 86400_000;

// ─── IP ─────────────────────────────────────────────────────────────────────

/** Свой адрес сети, не из интернета: локальный, частный, служебный. */
function privateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
}

/**
 * IP в том виде, как его видит Cloudflare (CF-Connecting-IP): IPv4 как есть,
 * IPv6 — сжатая запись строчными (2a02:810d::1). null — не IP или не из интернета.
 */
export function cleanIp(raw: unknown): string | null {
  let s = String(raw ?? '').trim();
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(s)) s = s.slice(7);
  const v = isIP(s);
  if (!v) return null;
  if (v === 6) {
    try {
      s = new URL(`http://[${s}]/`).hostname.slice(1, -1);
    } catch {
      return null;
    }
  }
  return privateIp(s) ? null : s;
}

/** IP человека за запросом к панели: панель стоит за Caddy, он пишет адрес в X-Forwarded-For. */
export function clientIp(request: Request, socketAddress: string): string | null {
  const direct = cleanIp(socketAddress);
  if (direct) return direct;
  const xff = (request.headers.get('x-forwarded-for') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  return cleanIp(xff[xff.length - 1]);
}

let ipsVersion = 0;
const noted = new Map<string, number>();

/** Запомнить IP своего (panel — зашёл в панель, browser — адрес от браузера, link — ссылка сотрудника, manual — руками). */
export function rememberTeamIp(db: Db, raw: unknown, source: 'panel' | 'browser' | 'link' | 'manual', now: number = Date.now()): string | null {
  const ip = cleanIp(raw);
  if (!ip) return null;
  // Заход в панель — на каждой странице: в базу не чаще раза в 10 минут.
  const last = noted.get(ip);
  if (source === 'panel' && last && now - last < 10 * 60_000) return ip;
  noted.set(ip, now);
  if (noted.size > 1000) noted.clear();
  const known = db.prepare('SELECT 1 FROM team_ips WHERE ip = ?').get(ip);
  db.prepare(
    `INSERT INTO team_ips (ip, source, first_at, last_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET last_at = excluded.last_at, source = CASE WHEN team_ips.source = 'manual' THEN 'manual' ELSE excluded.source END`
  ).run(ip, source, now, now);
  if (!known) ipsVersion++;
  // Свой с этого IP уже был сегодня на сайтах — вычесть сразу, не дожидаясь
  // его следующего события.
  const key = getConfigValue(db, 'COUNTER_KEY');
  if (key) for (const d of utcDays(now)) markTeam(db, visitorId(key, ip, d), now);
  return ip;
}

const utcDays = (now: number) => [new Date(now).toISOString().slice(0, 10), new Date(now - 86400_000).toISOString().slice(0, 10)];

/** Пометить посетителя своим и вычесть уже записанное за ним (если ещё не помечен). */
function markTeam(db: Db, vid: string, now: number): void {
  if (flagOf(db, vid)) return;
  flag(db, vid, 'team', now);
  undoVisitor(db, vid);
}

export interface TeamIp { ip: string; source: string; firstAt: number; lastAt: number }

export function listTeamIps(db: Db, now: number = Date.now()): TeamIp[] {
  return (db.prepare('SELECT ip, source, first_at, last_at FROM team_ips WHERE last_at >= ? OR source = \'manual\' ORDER BY last_at DESC').all(now - TEAM_IP_DAYS * 86400_000) as { ip: string; source: string; first_at: number; last_at: number }[])
    .map((r) => ({ ip: r.ip, source: r.source, firstAt: r.first_at, lastAt: r.last_at }));
}

export function removeTeamIp(db: Db, ip: string): boolean {
  const ok = db.prepare('DELETE FROM team_ips WHERE ip = ?').run(String(ip)).changes > 0;
  if (ok) ipsVersion++;
  return ok;
}

// ─── Код посетителя ────────────────────────────────────────────────────────

/** Тот же код, что считает gsc-counter.js сайта: 'v' + 16 hex от HMAC-SHA256(ключ, «день UTC|IP»). */
export function visitorId(key: string, ip: string, utcDay: string): string {
  return 'v' + createHmac('sha256', key).update(`${utcDay}|${ip}`).digest().subarray(0, 8).toString('hex');
}

let idCache: { stamp: string; ids: Set<string> } | null = null;

/** Коды своих на сегодня и вчера (UTC) — для текущего ключа счётчика. */
export function teamVisitorIds(db: Db, now: number = Date.now()): Set<string> {
  const key = getConfigValue(db, 'COUNTER_KEY');
  if (!key) return new Set();
  const days = utcDays(now);
  const stamp = `${key}\n${days[0]}\n${ipsVersion}`;
  if (idCache?.stamp === stamp) return idCache.ids;
  const ids = new Set<string>();
  for (const { ip } of listTeamIps(db, now)) for (const d of days) ids.add(visitorId(key, ip, d));
  idCache = { stamp, ids };
  return ids;
}

// ─── Журнал посетителя: что записано в статистику (для вычитания) ─────────

export interface LedgerRow {
  /** click — строка button_clicks, time — page_time, checkout — checkout_sources, visit — visit_stats. */
  what: 'click' | 'time' | 'checkout' | 'visit';
  day: string;
  host: string;
  page?: string;
  kind?: string;
  /** click — подпись, checkout — источник, visit — bounce | engaged. */
  label?: string;
  target?: string;
  /** click, checkout, visit — 1; time — секунды. */
  n?: number;
}

const realVisitor = (vid: string) => /^v[0-9a-f]{16}$/.test(vid);
let ledgerWrites = 0;

export function ledger(db: Db, vid: string, r: LedgerRow, now: number = Date.now()): void {
  if (!realVisitor(vid)) return;
  db.prepare('INSERT INTO visitor_events (visitor, at, day, host, what, page, kind, label, target, n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    vid, now, r.day, r.host, r.what, r.page ?? '', r.kind ?? '', r.label ?? '', r.target ?? '', r.n ?? 1
  );
  if (++ledgerWrites % 500 === 0) {
    db.prepare('DELETE FROM visitor_events WHERE at < ?').run(now - LEDGER_MS);
    db.prepare('DELETE FROM visitor_flags WHERE at < ?').run(now - LEDGER_MS);
  }
}

/** Вычесть из статистики всё, что записано за этим посетителем, и забыть его журнал. */
export function undoVisitor(db: Db, vid: string): number {
  const rows = db.prepare('SELECT day, host, what, page, kind, label, target, n FROM visitor_events WHERE visitor = ?').all(vid) as Required<LedgerRow>[];
  db.transaction(() => {
    for (const r of rows) {
      if (r.what === 'click') {
        const w = [r.day, r.host, r.page, r.kind, r.label, r.target];
        db.prepare('UPDATE button_clicks SET n = n - ? WHERE day = ? AND host = ? AND page = ? AND kind = ? AND label = ? AND target = ?').run(r.n, ...w);
        db.prepare('DELETE FROM button_clicks WHERE n <= 0 AND day = ? AND host = ? AND page = ? AND kind = ? AND label = ? AND target = ?').run(...w);
      } else if (r.what === 'time') {
        db.prepare('UPDATE page_time SET seconds = seconds - ? WHERE day = ? AND host = ? AND page = ?').run(r.n, r.day, r.host, r.page);
        db.prepare('DELETE FROM page_time WHERE seconds <= 0 AND day = ? AND host = ? AND page = ?').run(r.day, r.host, r.page);
      } else if (r.what === 'checkout') {
        db.prepare('UPDATE checkout_sources SET n = n - 1 WHERE day = ? AND host = ? AND source = ?').run(r.day, r.host, r.label);
        db.prepare('DELETE FROM checkout_sources WHERE n <= 0 AND day = ? AND host = ? AND source = ?').run(r.day, r.host, r.label);
      } else if (r.what === 'visit') {
        db.prepare('UPDATE visit_stats SET visits = MAX(visits - 1, 0), bounces = MAX(bounces - ?, 0) WHERE day = ? AND host = ?').run(r.label === 'bounce' ? 1 : 0, r.day, r.host);
      }
    }
    db.prepare('DELETE FROM visitor_events WHERE visitor = ?').run(vid);
  })();
  return rows.length;
}

// ─── Правила ───────────────────────────────────────────────────────────────

// Язык сайта по домену (и по папке /it/, /es/… у сайтов на несколько стран).
// .com, .net, .eu, .ch, .be — неоднозначны: не в счёт.
const TLD_LANG: Record<string, string> = { it: 'it', de: 'de', at: 'de', es: 'es', pl: 'pl', nl: 'nl', fr: 'fr', pt: 'pt', uk: 'en', ie: 'en', us: 'en', se: 'sv', dk: 'da', no: 'no', fi: 'fi', cz: 'cs', sk: 'sk', hu: 'hu', ro: 'ro', gr: 'el', tr: 'tr', br: 'pt', mx: 'es', ar: 'es' };
const FOLDER_LANG = new Set(['it', 'de', 'es', 'pl', 'nl', 'fr', 'pt', 'en', 'sv', 'da', 'no', 'fi', 'cs', 'sk', 'hu', 'ro', 'el', 'tr']);

export function siteLanguage(host: string, page = '/'): string | null {
  const folder = /^\/([a-z]{2})(\/|$)/.exec(page)?.[1];
  if (folder && FOLDER_LANG.has(folder)) return folder;
  return TLD_LANG[host.split('.').pop() ?? ''] ?? null;
}

/** Посетитель уже узнан своим или роботом — его визит при закрытии не пишется. */
export function visitorFlagged(db: Db, vid: string): boolean {
  return realVisitor(vid) && !!flagOf(db, vid);
}

function flagOf(db: Db, vid: string): OwnReason | null {
  const r = db.prepare('SELECT reason FROM visitor_flags WHERE visitor = ?').get(vid) as { reason: OwnReason } | undefined;
  return r?.reason ?? null;
}

function flag(db: Db, vid: string, reason: OwnReason, now: number): void {
  db.prepare('INSERT INTO visitor_flags (visitor, reason, at) VALUES (?, ?, ?) ON CONFLICT(visitor) DO NOTHING').run(vid, reason, now);
}

/**
 * Не считать ли это событие: 'team' — свои, 'robot' — робот, null — считать.
 * Узнали посетителя только что — его прежние события за день уже вычтены.
 */
export function ownVisitor(db: Db, vid: string, host: string, page: string, kind: string, now: number = Date.now()): OwnReason | null {
  if (!realVisitor(vid)) return null;
  if (teamVisitorIds(db, now).has(vid)) {
    markTeam(db, vid, now);
    return 'team';
  }
  const known = flagOf(db, vid);
  if (known) return known;
  if (kind === 'view') {
    const lang = siteLanguage(host, page);
    if (lang && lang !== 'en') {
      const seen = db.prepare("SELECT DISTINCT host, page FROM visitor_events WHERE visitor = ? AND what = 'click' AND kind = 'view'").all(vid) as { host: string; page: string }[];
      if (seen.some((s) => { const l = siteLanguage(s.host, s.page); return l !== null && l !== 'en' && l !== lang; })) {
        markTeam(db, vid, now);
        return 'team';
      }
    }
    const recent = (db.prepare("SELECT COUNT(*) AS n FROM visitor_events WHERE visitor = ? AND what = 'click' AND kind = 'view' AND at > ?").get(vid, now - ROBOT_MS) as { n: number }).n;
    if (recent + 1 >= ROBOT_VIEWS) {
      flag(db, vid, 'robot', now);
      undoVisitor(db, vid);
      return 'robot';
    }
  }
  return null;
}

/** Сколько событий сегодня (по Берлину) не засчитано: своих и роботов — по журналу приёма. */
export function ownSkippedToday(db: Db, today: string): { team: number; robot: number } {
  const rows = db.prepare("SELECT outcome, SUM(n) AS n FROM counter_log WHERE day >= ? AND outcome IN ('team', 'robot') GROUP BY outcome").all(today) as { outcome: string; n: number }[];
  return { team: rows.find((r) => r.outcome === 'team')?.n ?? 0, robot: rows.find((r) => r.outcome === 'robot')?.n ?? 0 };
}

// ─── Ссылка для сотрудников ────────────────────────────────────────────────

/** Секрет ссылки «Я свой»: открыл её — IP этого устройства запомнен как свой. rotate — новая ссылка, старая перестаёт работать. */
export function teamLinkToken(db: Db, rotate = false): string {
  const cur = getConfigValue(db, 'TEAM_LINK_TOKEN');
  if (cur && !rotate) return cur;
  const t = randomBytes(18).toString('base64url');
  setConfigValue(db, 'TEAM_LINK_TOKEN', t);
  return t;
}

export function teamLinkOk(db: Db, token: string): boolean {
  const cur = getConfigValue(db, 'TEAM_LINK_TOKEN');
  return !!cur && token.length === cur.length && token === cur;
}
