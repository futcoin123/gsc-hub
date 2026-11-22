import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { normHost } from '$lib/server/button-clicks';
import { counterKit, cleanEventsPath } from '$lib/counter-kit.js';

export type PingStep = 'ok' | 'unreachable' | 'no-kit' | 'no-key' | 'bad-key' | 'no-arrival';

/**
 * «Проверить сайт»: панель стучится на адрес событий сайта, просит проверку
 * связи ({"gsc_ping":1}) и ждёт, дойдёт ли она обратно в панель с ключом сайта.
 * В статистику ничего не попадает — только строка «test» в журнале приёма.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
  requireAdmin(locals);
  const body = (await request.json().catch(() => ({}))) as { h?: string; e?: string };
  const host = normHost(body.h ?? '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw error(400, 'Нужен домен сайта');
  const events = cleanEventsPath(body.e) ?? counterKit(host, url.origin).events;
  const target = `https://${host}${events}`;
  const t0 = Date.now() - 1000;
  const UA = 'Mozilla/5.0 (compatible; GSCHubCheck/1)';
  let res: Response;
  try {
    res = await fetch(target, { headers: { 'user-agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
  } catch (e) {
    return json({ step: 'unreachable' satisfies PingStep, target, detail: (e as Error).message });
  }
  const kit = res.headers.get('x-counter-kit');
  const counter = res.headers.get('x-counter');
  if (!kit) return json({ step: 'no-kit' satisfies PingStep, target, status: res.status, counter });
  if (counter !== 'on') return json({ step: 'no-key' satisfies PingStep, target, kit });
  let pong: string | null = null;
  try {
    const r = await fetch(target, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/json' }, body: '{"gsc_ping":1}', signal: AbortSignal.timeout(12000) });
    pong = r.headers.get('x-counter-ping');
  } catch (e) {
    return json({ step: 'unreachable' satisfies PingStep, target, detail: (e as Error).message });
  }
  // Счётчик v2 сам говорит, что ответила панель.
  if (pong === 'ok' || pong === 'bad-key' || pong === 'no-key') return json({ step: pong satisfies PingStep, target, kit });
  if (pong && pong !== 'wait') return json({ step: 'no-arrival' satisfies PingStep, target, kit, detail: pong });
  const find = db().prepare("SELECT outcome FROM counter_log WHERE host = ? AND kind = 'test' AND last_at >= ? ORDER BY last_at DESC LIMIT 1");
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const row = find.get(host, t0) as { outcome: string } | undefined;
    if (row) return json({ step: (row.outcome === 'ok' ? 'ok' : 'bad-key') satisfies PingStep, target, kit });
  }
  return json({ step: 'no-arrival' satisfies PingStep, target, kit });
};
