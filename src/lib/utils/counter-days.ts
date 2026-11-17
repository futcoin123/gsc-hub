// Входы на сайт по дням по счётчику на сайте — для графика сайта без Search
// Console на Dashboard (просьба владелицы 17.11.2026: видеть прогресс сайтов
// «Без консоли»). g — из Google, other — из других поисковиков, ИИ, с других
// сайтов и соцсетей; прямые заходы и переходы внутри сайта не считаются, как в
// колонках Dashboard.
import { sourceOf } from './traffic-source';

export interface CounterDay {
  date: string;
  g: number;
  other: number;
}

const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/** Дни от start до end включительно, у каждого сайта — каждый день (без входов — нули). */
export function counterDays(rows: { day: string; host: string; target: string; n: number }[], hosts: string[], start: string, end: string): Map<string, CounterDay[]> {
  const dates: string[] = [];
  for (let d = start; d <= end && dates.length < 1000; d = nextDay(d)) dates.push(d);
  const out = new Map<string, Map<string, CounterDay>>();
  for (const h of hosts) out.set(h, new Map(dates.map((d) => [d, { date: d, g: 0, other: 0 }])));
  for (const r of rows) {
    const day = out.get(r.host)?.get(r.day);
    if (!day || !r.target) continue;
    const src = sourceOf(r.target);
    if (!src || src.group === 'direct') continue;
    if (src.key === 'Google') day.g += r.n;
    else day.other += r.n;
  }
  return new Map([...out].map(([h, m]) => [h, [...m.values()]]));
}
