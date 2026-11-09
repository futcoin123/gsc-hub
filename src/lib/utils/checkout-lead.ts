// Переходы к оплате счётчик хаба знает только по странице, а не по ключу:
// Google не сообщает, по какому запросу пришёл посетитель. Чтобы ключи одной
// страницы не показывали одно и то же число каждый (и не казалось, что оплат
// в разы больше), число стоит у одного ключа страницы — с наибольшими кликами.

export interface LeadRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
}

/** Путь страницы → ключ, у которого показываем переходы к оплате этой страницы. */
export function checkoutLeads(rows: LeadRow[], pathOf: (page: string) => string): Map<string, string> {
  const best = new Map<string, LeadRow>();
  for (const r of rows) {
    const p = pathOf(r.page);
    const cur = best.get(p);
    if (!cur || r.clicks > cur.clicks || (r.clicks === cur.clicks && (r.impressions > cur.impressions || (r.impressions === cur.impressions && r.query < cur.query)))) best.set(p, r);
  }
  return new Map([...best].map(([p, r]) => [p, r.query]));
}

/** Сколько переходов к оплате было на страницах, у которых есть ключи, и на остальных. */
export function checkoutSplit(checkouts: Record<string, number>, keyPaths: Set<string>): { withKeys: number; other: number } {
  let withKeys = 0;
  let other = 0;
  for (const [p, n] of Object.entries(checkouts)) {
    if (keyPaths.has(p)) withKeys += n;
    else other += n;
  }
  return { withKeys, other };
}
