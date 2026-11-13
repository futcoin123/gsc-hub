// Журнал приёма событий счётчика (/c). Раньше панель на любое событие отвечала
// 204 и молча отбрасывала то, что не подошло, — почему у сайта нули, понять
// было нельзя. Теперь по сайту, дню и виду события пишется, сколько принято и
// сколько отброшено с причиной. Пишем только то, чему можно верить: событие с
// нашим ключом или от нашего сайта — мусор из интернета журнал не раздувает.
import type { Db } from './db';
import { DISPLAY_TIME_ZONE, localToday } from './gsc-calendar';
import type { CounterLogRow } from '$lib/utils/counter-verdict';

export type CounterOutcome = 'ok' | 'bad-key' | 'unknown-site' | 'bot' | 'limit' | 'bad-event' | 'no-visit';

/** Вид события в журнале: просмотр с источником и без, время, переход к оплате, нажатие. */
export function logKind(kind: string, target = ''): string {
  if (kind === 'view') return target ? 'view' : 'view-nosrc';
  if (kind === 'submit' || kind === 'time') return kind;
  return 'click';
}

const KEEP_DAYS = 30;

/** Ячейка журнала: день и час («2026-11-13 10»). Часы нужны, чтобы проверка
 *  счётчика смотрела только на события после последней проверки связи —
 *  ошибки до перевода сайта на новый счётчик не висят весь день. Старые
 *  записи — по дням («2026-11-13»): при сравнении строк день идёт раньше
 *  любого своего часа, поэтому оба вида живут в одной колонке. */
export function logBucket(now: number = Date.now()): string {
  const h = new Intl.DateTimeFormat('en-GB', { timeZone: DISPLAY_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now));
  return `${localToday(now)} ${h.padStart(2, '0')}`;
}
let lastPrune = 0;

export function logCounter(db: Db, host: string, kind: string, outcome: CounterOutcome, now: number = Date.now()): void {
  if (!/^[a-z0-9.-]{1,253}$/.test(host)) return;
  db.prepare(
    `INSERT INTO counter_log (day, host, kind, outcome, n, last_at) VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(day, host, kind, outcome) DO UPDATE SET n = n + 1, last_at = excluded.last_at`
  ).run(logBucket(now), host, kind, outcome, now);
  if (now - lastPrune > 6 * 3600_000) {
    lastPrune = now;
    db.prepare('DELETE FROM counter_log WHERE day < ?').run(localToday(now - KEEP_DAYS * 86400_000));
  }
}

/** Журнал по сайтам с дня startDay (YYYY-MM-DD) включительно: сайт → строки. */
export function counterLogSince(db: Db, startDay: string): Record<string, CounterLogRow[]> {
  const rows = db
    .prepare(
      `SELECT host, kind, outcome, SUM(n) AS n, MAX(last_at) AS last_at FROM counter_log
        WHERE day >= ? GROUP BY host, kind, outcome`
    )
    .all(startDay) as { host: string; kind: string; outcome: string; n: number; last_at: number }[];
  const out: Record<string, CounterLogRow[]> = {};
  for (const r of rows) (out[r.host] ??= []).push({ kind: r.kind, outcome: r.outcome, n: r.n, lastAt: r.last_at });
  return out;
}

export interface CounterCheck {
  rows: CounterLogRow[];
  /** Последняя успешная проверка связи (ключ подошёл): с неё и смотрим события. */
  since: number | null;
}

/** Для «Проверки счётчиков»: по сайту — события с последней успешной проверки
 *  связи (если она была с startDay), иначе с startDay. Строки проверок связи
 *  (kind test) — за весь период, чтобы знать, когда и чем она кончилась. */
export function counterChecks(db: Db, startDay: string): Record<string, CounterCheck> {
  const pings = db
    .prepare("SELECT host, MAX(last_at) AS at FROM counter_log WHERE day >= ? AND kind = 'test' AND outcome = 'ok' GROUP BY host")
    .all(startDay) as { host: string; at: number }[];
  const since = new Map(pings.map((p) => [p.host, p.at]));
  const rows = db
    .prepare(
      `SELECT day, host, kind, outcome, n, last_at FROM counter_log WHERE day >= ?`
    )
    .all(startDay) as { day: string; host: string; kind: string; outcome: string; n: number; last_at: number }[];
  const acc = new Map<string, Map<string, CounterLogRow>>();
  for (const r of rows) {
    const at = since.get(r.host);
    // До проверки связи — не в счёт (кроме самих проверок); ячейка того же часа — в счёт.
    if (at && r.kind !== 'test' && r.day < logBucket(at)) continue;
    const m = acc.get(r.host) ?? new Map<string, CounterLogRow>();
    acc.set(r.host, m);
    const k = `${r.kind}|${r.outcome}`;
    const cur = m.get(k);
    if (cur) {
      cur.n += r.n;
      cur.lastAt = Math.max(cur.lastAt, r.last_at);
    } else m.set(k, { kind: r.kind, outcome: r.outcome, n: r.n, lastAt: r.last_at });
  }
  const out: Record<string, CounterCheck> = {};
  for (const [host, m] of acc) out[host] = { rows: [...m.values()], since: since.get(host) ?? null };
  return out;
}
