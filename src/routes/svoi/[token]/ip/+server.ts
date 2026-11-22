import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { rememberTeamIp, teamLinkOk } from '$lib/server/own-visitors';

/** Страница ссылки сотрудника сообщает IPv6/IPv4 браузера (панель видит только IPv4). */
export const POST: RequestHandler = async ({ params, request }) => {
  if (!teamLinkOk(db(), params.token)) throw error(404, 'Not found');
  const body = (await request.json().catch(() => null)) as { ip?: unknown } | null;
  return json({ ip: rememberTeamIp(db(), body?.ip, 'link') });
};
