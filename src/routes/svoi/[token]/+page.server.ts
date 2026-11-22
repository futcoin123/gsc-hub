import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { clientIp, rememberTeamIp, teamLinkOk } from '$lib/server/own-visitors';

// Ссылка для сотрудников «я свой»: открыл — IP этого устройства запомнен, его
// визиты на сайты не считаются. Без входа в панель; без верного секрета — 404.
export const load: PageServerLoad = ({ params, request, getClientAddress }) => {
  if (!teamLinkOk(db(), params.token)) throw error(404, 'Not found');
  let socket = '';
  try {
    socket = getClientAddress();
  } catch {
    /* нет адреса сокета */
  }
  return { ip: rememberTeamIp(db(), clientIp(request, socket), 'link'), token: params.token };
};
