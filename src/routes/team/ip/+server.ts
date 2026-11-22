import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { rememberTeamIp } from '$lib/server/own-visitors';

// Браузер того, кто зашёл в панель, сообщает свой IP (IPv6 и IPv4 — от
// api64.ipify.org / api.ipify.org): панель доступна только по IPv4, а сайты на
// Cloudflare видят IPv6. По IP панель узнаёт своих на сайтах (own-visitors.ts).
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(403, 'forbidden');
  const body = (await request.json().catch(() => null)) as { ip?: unknown } | null;
  return json({ ip: rememberTeamIp(db(), body?.ip, 'browser') });
};
