import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { listAllKnownSites } from '$lib/server/google';
import { siteHostname } from '$lib/utils/url-filters';
import { counterKeyOk } from '$lib/server/config';
import { allowClick, clicksToday, countedHosts, entrySource, isBotUA, normHost, parseWorkerEvent, recordCheckoutSource, recordClick, recordTime, rememberEntry, trackVisit, workerEventInput } from '$lib/server/button-clicks';

// Приём событий счётчика от Cloudflare Worker ваших сайтов (без входа, но с
// секретным ключом). Считаем только ваши сайты из подключённых консолей,
// только браузеры (боты отсеиваются), с ограничением частоты.
// Ответ всегда пустой 204 — ничего не раскрываем.
const MAX_PER_SITE_DAY = 50_000;
let known: { hosts: Set<string>; at: number } | null = null;

async function knownHosts(): Promise<Set<string>> {
  if (known && Date.now() - known.at < 10 * 60_000) return known.hosts;
  const { sites } = await listAllKnownSites(db());
  const hosts = new Set<string>();
  for (const s of sites) {
    try {
      hosts.add(normHost(siteHostname(s.siteUrl)));
    } catch {
      /* битый адрес property */
    }
  }
  // Пустой список (Google не ответил) не кэшируем надолго.
  known = { hosts, at: hosts.size ? Date.now() : Date.now() - 9 * 60_000 };
  return hosts;
}

// Домены, от которых уже принимали события: читаются из базы один раз и
// пополняются при каждой записи.
let counted: Set<string> | null = null;

/** Сайт наш: он в подключённой консоли или от него уже принимали события. */
async function isKnownHost(host: string): Promise<boolean> {
  counted ??= countedHosts(db());
  if (counted.has(host)) return true;
  if (!(await knownHosts()).has(host)) return false;
  counted.add(host);
  return true;
}

const EMPTY = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });


/** Старый браузерный счётчик (/c.js) отключён — такие запросы не считаем. */
export const GET: RequestHandler = () => EMPTY();

export const POST: RequestHandler = async ({ request }) => {
  const ua = request.headers.get('x-client-ua') ?? '';
  const ip = request.headers.get('x-client-ip') || 'worker';
  try {
    // Новый Worker присылает событие страницы как есть — переводим его ключом сайта.
    const parsed = parseWorkerEvent(workerEventInput(await request.json(), request.headers.get('x-counter-key')));
    if (!parsed) return EMPTY();
    const host = 'click' in parsed ? parsed.click.host : parsed.time.host;
    // Любой выданный и не отозванный ключ; запоминаем, с какого сайта он пришёл.
    if (!counterKeyOk(db(), request.headers.get('x-counter-key'), host)) return EMPTY();
    if (isBotUA(ua)) return EMPTY();
    if (!(await isKnownHost(host))) return EMPTY();
    if ('time' in parsed) {
      if (allowClick(ip, { host, page: parsed.time.page, kind: 'view', label: 'time:' + Date.now(), target: '' })) recordTime(db(), parsed.time);
      return EMPTY();
    }
    if (!allowClick(ip, parsed.click)) return EMPTY();
    if (clicksToday(db(), host) >= MAX_PER_SITE_DAY) return EMPTY();
    recordClick(db(), parsed.click);
    // Источник перехода к оплате — по входу того же посетителя (см. rememberEntry).
    trackVisit(db(), ip, host, parsed.click.kind, parsed.click.target);
    if (parsed.click.kind === 'view') rememberEntry(ip, host, parsed.click.target);
    else if (parsed.click.kind === 'submit') recordCheckoutSource(db(), host, entrySource(ip, host));
  } catch {
    /* счётчик не должен ломать сайт */
  }
  return EMPTY();
};
