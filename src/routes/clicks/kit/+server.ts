import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdmin } from '$lib/server/guard';
import { normHost } from '$lib/server/button-clicks';
import { counterKit, cleanEventsPath } from '$lib/counter-kit.js';

/**
 * Единый счётчик для сайта: ?h=домен&e=/адрес-событий/
 *   f=json   — код страницы и модуль (для страницы «Кнопки»);
 *   f=module — gsc-counter.js файлом; f=page — код страницы файлом.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const host = normHost(url.searchParams.get('h') ?? '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) throw error(400, 'Нужен домен сайта');
  const e = url.searchParams.get('e');
  if (e && !cleanEventsPath(e)) throw error(400, 'Адрес событий — одно слово: буквы, цифры, дефис, например /segnale/');
  const kit = counterKit(host, url.origin, e);
  const f = url.searchParams.get('f') ?? 'json';
  if (f === 'module' || f === 'page') {
    const name = f === 'module' ? 'gsc-counter.js' : `${host}-counter-page.js`;
    return new Response(f === 'module' ? kit.module : kit.page + '\n', {
      headers: { 'content-type': 'application/javascript; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store' }
    });
  }
  return json({ host: kit.host, events: kit.events, version: kit.version, page: kit.page, module: kit.module });
};
