import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { listAllKnownSites } from '$lib/server/google';
import { siteHostname } from '$lib/utils/url-filters';
import { counterKeyOk } from '$lib/server/config';
import { allowClick, clicksToday, countedHosts, entrySource, isBotUA, normHost, parseWorkerEvent, recordCheckoutSource, recordClick, recordTime, rememberEntry, trackVisit, workerEventInput } from '$lib/server/button-clicks';
import { logCounter, logKind, type CounterOutcome } from '$lib/server/counter-log';

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
  const key = request.headers.get('x-counter-key');
  // Журнал приёма (см. counter-log.ts): что принято и почему отброшено — по сайту.
  let host = '';
  let kind = 'event';
  const log = (outcome: CounterOutcome) => {
    try {
      if (host) logCounter(db(), host, kind, outcome);
    } catch {
      /* журнал не должен ломать приём */
    }
  };
  try {
    const raw = await request.json();
    const rawHost = raw && typeof raw === 'object' && typeof (raw as { h?: unknown }).h === 'string' ? normHost((raw as { h: string }).h) : '';
    // Любой выданный и не отозванный ключ; запоминаем, с какого сайта он пришёл.
    const keyOk = !!rawHost && counterKeyOk(db(), key, rawHost);
    // Проверка связи из панели (единый счётчик: «Проверить сайт»): в журнал, не в статистику.
    const rawE = raw && typeof raw === 'object' ? (raw as { e?: unknown }).e : undefined;
    let rawEvent: { k?: unknown } | null = null;
    try {
      rawEvent = typeof rawE === 'string' ? JSON.parse(rawE) : null;
    } catch {
      rawEvent = null;
    }
    if (rawEvent && rawEvent.k === 'test') {
      host = rawHost;
      kind = 'test';
      if (keyOk) log('ok');
      else if (rawHost && (await isKnownHost(rawHost))) log('bad-key');
      // Сайт (единый счётчик v2) передаёт ответ дальше в x-counter-ping.
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', 'x-gsc-test': keyOk ? 'ok' : 'bad-key' } });
    }
    // Новый Worker присылает событие страницы как есть — переводим его ключом сайта.
    const parsed = parseWorkerEvent(workerEventInput(raw, key));
    if (!parsed) {
      // В журнал — только с нашим ключом или от нашего сайта: мусор из интернета не пишем.
      host = rawHost;
      if (keyOk) log('bad-event');
      else if (rawHost && (await isKnownHost(rawHost))) log('bad-key');
      return EMPTY();
    }
    host = 'click' in parsed ? parsed.click.host : parsed.time.host;
    kind = 'click' in parsed ? logKind(parsed.click.kind, parsed.click.target) : 'time';
    if (!(host === rawHost ? keyOk : counterKeyOk(db(), key, host))) {
      if (await isKnownHost(host)) log('bad-key');
      return EMPTY();
    }
    if (isBotUA(ua)) {
      log('bot');
      return EMPTY();
    }
    // Сайта может не быть в Search Console (владелица добавляет сайты туда сама,
    // когда ей нужно): верный ключ есть только у её сайтов — событие принимаем.
    if ('time' in parsed) {
      if (allowClick(ip, { host, page: parsed.time.page, kind: 'view', label: 'time:' + Date.now(), target: '' })) {
        recordTime(db(), parsed.time);
        log('ok');
      } else log('limit');
      return EMPTY();
    }
    if (!allowClick(ip, parsed.click) || clicksToday(db(), host) >= MAX_PER_SITE_DAY) {
      log('limit');
      return EMPTY();
    }
    recordClick(db(), parsed.click);
    log('ok');
    // Источник перехода к оплате — по входу того же посетителя (см. rememberEntry).
    trackVisit(db(), ip, host, parsed.click.kind, parsed.click.target);
    if (parsed.click.kind === 'view') rememberEntry(ip, host, parsed.click.target);
    else if (parsed.click.kind === 'submit') recordCheckoutSource(db(), host, entrySource(ip, host));
  } catch {
    /* счётчик не должен ломать сайт */
  }
  return EMPTY();
};
