// Журнал приёма событий счётчика (/c). Раньше панель на любое событие отвечала
// 204 и молча отбрасывала то, что не подошло, — почему у сайта нули, понять
// было нельзя. Теперь по сайту, дню и виду события пишется, сколько принято и
// сколько отброшено с причиной. Пишем только то, чему можно верить: событие с
// нашим ключом или от нашего сайта — мусор из интернета журнал не раздувает.
import type { Db } from './db';
import { localToday } from './gsc-calendar';
import type { CounterLogRow } from '$lib/utils/counter-verdict';

export type CounterOutcome = 'ok' | 'bad-key' | 'unknown-site' | 'bot' | 'limit' | 'bad-event';

/** Вид события в журнале: просмотр с источником и без, время, переход к оплате, нажатие. */
export function logKind(kind: string, target = ''): string {
  if (kind === 'view') return target ? 'view' : 'view-nosrc';
  if (kind === 'submit' || kind === 'time') return kind;
  return 'click';
}

const KEEP_DAYS = 30;
let lastPrune = 0;

export function logCounter(db: Db, host: string, kind: string, outcome: CounterOutcome, now: number = Date.now()): void {
  if (!/^[a-z0-9.-]{1,253}$/.test(host)) return;
  db.prepare(
    `INSERT INTO counter_log (day, host, kind, outcome, n, last_at) VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(day, host, kind, outcome) DO UPDATE SET n = n + 1, last_at = excluded.last_at`
  ).run(localToday(now), host, kind, outcome, now);
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
