import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/guard';
import { siteLabels } from '$lib/server/site-labels';
import { reportPeriod } from '$lib/server/report-period';

// Строки раздела грузятся отдельно (/map-keys/rows): позиции всех сайтов Google
// при первом заходе считаются несколько секунд — страница открывается сразу.
// Период — из шапки: при его смене строки грузятся заново.
export const load: PageServerLoad = async ({ locals }) => {
  requireAdmin(locals);
  return { labels: siteLabels(db()), period: reportPeriod(db()) };
};
