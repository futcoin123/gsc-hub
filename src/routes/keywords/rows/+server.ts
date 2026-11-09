import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { reportPeriod } from '$lib/server/report-period';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { getAccount } from '$lib/server/accounts';
import { parsePeriod, siteKeysForPeriod } from '$lib/server/site-keys';
import { clicksForRange, normHost } from '$lib/server/button-clicks';
import { siteHostname } from '$lib/utils/url-filters';
import { keyMapFor } from '$lib/server/key-map';

/** Все ключи одного сайта за период: ?site=&acc=&p=today|yesterday|7|28|90|180|480 */
export const GET: RequestHandler = async ({ url, locals }) => {
  requireAdmin(locals);
  const site = url.searchParams.get('site');
  const acc = getAccount(db(), url.searchParams.get('acc') ?? '');
  if (!site) throw error(400, 'site required');
  if (!acc) throw error(404, 'консоль не найдена');
  const p = reportPeriod(db());
  try {
    // Переходы к оплате по страницам сайта за тот же период (счётчик хаба):
    // у ключа показываем те, что сделаны на его странице.
    const host = normHost(siteHostname(site));
    const checkouts: Record<string, number> = {};
    for (const r of clicksForRange(db(), p.startDate, p.endDate)) {
      if (r.host === host && r.kind === 'submit') checkouts[r.page] = (checkouts[r.page] ?? 0) + r.n;
    }
    // Главные и второстепенные ключи сайта по «Карте ключей FUT»; null — сайта в карте нет.
    let keyMap = null;
    try {
      keyMap = keyMapFor(db(), host);
    } catch {
      keyMap = null;
    }
    return json({ rows: await siteKeysForPeriod(db(), acc, site, p), checkouts, keyMap, period: p });
  } catch (e) {
    throw error(502, (e as Error).message.slice(0, 200));
  }
};
