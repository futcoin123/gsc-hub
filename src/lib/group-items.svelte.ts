// Колонка «В группу» в Striking Distance: ключи добавляются в группу,
// выбранную в шапке («Сайты: …»).

export interface GroupSummary {
  id: number;
  name: string;
  active: boolean;
  fixedAt: number | null;
  items: number;
  hosts: string[];
  done: string[];
  /** Дата закупки (YYYY-MM-DD): день фиксации, иначе дата в названии. */
  date?: string | null;
  /** Ссылок в группе по сайтам: домен → сколько. */
  links?: Record<string, number>;
}
export interface HistoryRow {
  id: number;
  groupId: number;
  groupName: string;
  fixedAt: number | null;
  kind: 'anchor' | 'naked';
  query: string;
  page: string;
  qty: number;
  position: number | null;
  impressions: number | null;
  addedAt: number;
}
export interface ItemRow {
  siteUrl: string;
  query: string;
  page: string;
  position?: number;
  impressions?: number;
  clicks?: number;
  ctr?: number;
  qty?: number;
}

export const gi = $state({
  groups: [] as GroupSummary[],
  marks: {} as Record<string, { groupId: number; name: string; qty: number; at: number }[]>,
  /** История ссылок по сайту (страница сайта): все группы, новые сверху. */
  history: [] as HistoryRow[],
  today: '',
  busy: new Set<string>(),
  error: null as string | null,
  /** Страница Sites: в какую группу добавлять сайты кнопкой +. */
  targetId: null as number | null
});

const TARGET_KEY = 'gsc-hub:target-group';

/** Группа для страницы Sites: запомненная, иначе сегодняшняя, иначе самая новая. */
function pickTarget() {
  let saved: number | null = null;
  try {
    saved = Number(localStorage.getItem(TARGET_KEY)) || null;
  } catch {
    /* без памяти выбора тоже работает */
  }
  const ok = (id: number | null) => gi.groups.some((g) => g.id === id);
  if (ok(gi.targetId)) return;
  gi.targetId = ok(saved) ? saved : (gi.groups.find((g) => g.name === gi.today)?.id ?? gi.groups[0]?.id ?? null);
}

export function chooseTarget(id: number | null) {
  gi.targetId = id;
  try {
    if (id) localStorage.setItem(TARGET_KEY, String(id));
  } catch {
    /* ignore */
  }
}

export const targetGroup = () => gi.groups.find((g) => g.id === gi.targetId) ?? null;

function hostOf(siteUrl: string): string {
  try {
    const raw = siteUrl.startsWith('sc-domain:') ? `https://${siteUrl.slice(10)}/` : siteUrl;
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

export const siteInTarget = (siteUrl: string) => !!targetGroup()?.hosts.includes(hostOf(siteUrl));

/**
 * Прошлые закупки сайта: другие группы, где он есть (сайт в группе или ссылки
 * на него), новые сверху — чтобы, собирая новую, видеть, что брали вчера.
 */
export function pastGroupsOf(siteUrl: string): { id: number; name: string; date: string | null; links: number }[] {
  const h = hostOf(siteUrl);
  if (!h) return [];
  return gi.groups
    .filter((g) => g.id !== gi.targetId && (g.hosts.includes(h) || (g.links?.[h] ?? 0) > 0))
    .map((g) => ({ id: g.id, name: g.name, date: g.date ?? null, links: g.links?.[h] ?? 0 }))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.id - a.id);
}

export async function toggleSiteInTarget(siteUrl: string) {
  const g = targetGroup();
  if (!g) {
    gi.error = 'Сначала создайте группу над таблицей';
    return;
  }
  const k = 'site:' + siteUrl;
  if (gi.busy.has(k)) return;
  gi.busy = new Set(gi.busy).add(k);
  try {
    const data = await post('/groups/items', { action: 'host', groupId: g.id, site: siteUrl, on: !siteInTarget(siteUrl) });
    gi.groups = data.groups;
    gi.error = null;
  } catch (e) {
    gi.error = (e as Error).message;
  } finally {
    const next = new Set(gi.busy);
    next.delete(k);
    gi.busy = next;
  }
}

export async function createTarget(name?: string) {
  try {
    const data = await post('/groups/items', { action: 'create', name });
    gi.groups = data.groups;
    chooseTarget(data.id);
    gi.error = null;
  } catch (e) {
    gi.error = (e as Error).message;
  }
}

export const itemKey = (page: string, query: string) => `${page}\n${query}`;
export const activeGroup = () => gi.groups.find((g) => g.active) ?? null;

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ?? `HTTP ${res.status}`);
  return data;
}

let lastSite: string | undefined;

export async function loadGroupItems(site?: string) {
  lastSite = site;
  try {
    const res = await fetch('/groups/items' + (site ? `?site=${encodeURIComponent(site)}` : ''));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    gi.groups = data.groups;
    gi.marks = data.marks;
    gi.history = data.history ?? [];
    gi.today = data.today;
    gi.error = null;
    pickTarget();
  } catch (e) {
    gi.error = `Группы не загрузились: ${(e as Error).message}`;
  }
}

/** Сменить группу в шапке: отчёты перестраиваются, поэтому страница перезагружается. */
export async function switchGroup(id: number | null) {
  try {
    await post('/groups/active', { id });
    location.reload();
  } catch (e) {
    gi.error = (e as Error).message;
  }
}

/** Группа на сегодня (28-10-26) с этим сайтом, сразу выбранная в шапке. */
export async function startToday(site?: string) {
  try {
    await post('/groups/items', { action: 'today', site });
    location.reload();
  } catch (e) {
    gi.error = (e as Error).message;
  }
}

export async function setDone(host: string, done: boolean) {
  const g = activeGroup();
  if (!g) return;
  try {
    const data = await post('/groups/items', { action: 'done', groupId: g.id, host, done });
    gi.groups = data.groups;
  } catch (e) {
    gi.error = (e as Error).message;
  }
}

export const inActive = (page: string, query: string) => {
  const g = activeGroup();
  return !!g && !!gi.marks[itemKey(page, query)]?.some((m) => m.groupId === g.id);
};

/** Другие группы с этой связкой, от старых к новым. */
export const otherGroups = (page: string, query: string) => {
  const g = activeGroup();
  return (gi.marks[itemKey(page, query)] ?? []).filter((m) => m.groupId !== g?.id);
};

/**
 * Закупки ссылок с этим ключом (анкором) на эту страницу в других группах,
 * от старых к новым. По ключу и странице вместе: другой анкор на ту же
 * страницу — не закупка этого ключа (13.11.2026: по одной странице у всех
 * ключей главной стояло «10 шт», хотя брали один ключ).
 */
export const keyGroups = (page: string, query: string) => {
  const g = activeGroup();
  const norm = (u: string) => u.replace(/#.*$/, '').replace(/\/$/, '');
  const target = norm(page);
  const q = query.trim().toLowerCase();
  const by = new Map<number, { groupId: number; name: string; qty: number; at: number; anchors: string[] }>();
  for (const [k, marks] of Object.entries(gi.marks)) {
    const i = k.indexOf('\n');
    if (norm(k.slice(0, i)) !== target || k.slice(i + 1).trim().toLowerCase() !== q) continue;
    for (const m of marks) {
      if (m.groupId === g?.id) continue;
      const cur = by.get(m.groupId) ?? { groupId: m.groupId, name: m.name, qty: 0, at: m.at, anchors: [] };
      cur.qty += m.qty;
      cur.anchors.push(query);
      by.set(m.groupId, cur);
    }
  }
  return [...by.values()].sort((a, b) => a.at - b.at);
};

/** Сколько ссылок стоит у связки в выбранной группе. */
export const qtyInActive = (page: string, query: string) => {
  const g = activeGroup();
  return gi.marks[itemKey(page, query)]?.find((m) => m.groupId === g?.id)?.qty ?? 1;
};

async function refreshHistory() {
  try {
    const res = await fetch('/groups/items?site=' + encodeURIComponent(lastSite!));
    if (res.ok) gi.history = (await res.json()).history ?? [];
  } catch {
    /* история догрузится при следующем открытии */
  }
}

export async function setQty(r: ItemRow, qty: number) {
  const g = activeGroup();
  if (!g) return;
  const k = itemKey(r.page, r.query);
  try {
    await post('/groups/items', { action: 'qty', groupId: g.id, page: r.page, query: r.query, qty });
    gi.marks = {
      ...gi.marks,
      [k]: (gi.marks[k] ?? []).map((m) => (m.groupId === g.id ? { ...m, qty: Math.max(1, Math.round(qty) || 1) } : m))
    };
    gi.error = null;
    if (lastSite) refreshHistory();
  } catch (e) {
    gi.error = (e as Error).message;
  }
}

export async function toggleItem(r: ItemRow) {
  const g = activeGroup();
  if (!g) {
    gi.error = 'Сначала выберите группу над таблицей';
    return;
  }
  const k = itemKey(r.page, r.query);
  if (gi.busy.has(k)) return;
  gi.busy = new Set(gi.busy).add(k);
  const had = inActive(r.page, r.query);
  try {
    const data = had
      ? await post('/groups/items', { action: 'remove', groupId: g.id, page: r.page, query: r.query })
      : await post('/groups/items', { action: 'add', groupId: g.id, item: r });
    const rest = (gi.marks[k] ?? []).filter((m) => m.groupId !== g.id);
    gi.marks = { ...gi.marks, [k]: had ? rest : [...rest, { groupId: g.id, name: g.name, qty: r.qty ?? 1, at: Date.now() }] };
    gi.groups = data.groups;
    gi.error = null;
    if (lastSite) refreshHistory();
  } catch (e) {
    gi.error = (e as Error).message;
  } finally {
    const next = new Set(gi.busy);
    next.delete(k);
    gi.busy = next;
  }
}

/**
 * Связка «ключ + страница», вписанная руками (её может не быть в отчёте Google):
 * в выбранную группу; если она там уже есть — ставит новое количество.
 * Ошибку не прячет в шапку, а бросает: форма показывает её рядом с собой.
 */
export async function addCustomItem(r: { siteUrl: string; query: string; page: string; qty: number }): Promise<{ prev: number | null }> {
  const g = activeGroup();
  if (!g) throw new Error('Группа не выбрана — выберите её в строке «Ключи в группу» вверху страницы');
  if (g.fixedAt) throw new Error(`Группа «${g.name}» зафиксирована — сначала откройте её для правок на странице «Группы»`);
  const k = itemKey(r.page, r.query);
  if (gi.busy.has(k)) throw new Error('Эта связка ещё сохраняется');
  const qty = Math.max(1, Math.min(1000, Math.round(r.qty) || 1));
  const had = gi.marks[k]?.find((m) => m.groupId === g.id) ?? null;
  gi.busy = new Set(gi.busy).add(k);
  try {
    if (had) await post('/groups/items', { action: 'qty', groupId: g.id, page: r.page, query: r.query, qty });
    else gi.groups = (await post('/groups/items', { action: 'add', groupId: g.id, item: { siteUrl: r.siteUrl, query: r.query, page: r.page, qty } })).groups;
    const rest = (gi.marks[k] ?? []).filter((m) => m.groupId !== g.id);
    gi.marks = { ...gi.marks, [k]: [...rest, { groupId: g.id, name: g.name, qty, at: had?.at ?? Date.now() }] };
    gi.error = null;
    if (lastSite) refreshHistory();
    return { prev: had?.qty ?? null };
  } finally {
    const next = new Set(gi.busy);
    next.delete(k);
    gi.busy = next;
  }
}

/** Связки выбранной группы на страницах этого сайта (анкорные), новые снизу. */
export function activeItemsOfSite(siteUrl: string): { page: string; query: string; qty: number }[] {
  const g = activeGroup();
  const h = hostOf(siteUrl);
  if (!g || !h) return [];
  const out: { page: string; query: string; qty: number; at: number }[] = [];
  for (const [k, marks] of Object.entries(gi.marks)) {
    const m = marks.find((x) => x.groupId === g.id);
    if (!m) continue;
    const i = k.indexOf('\n');
    const page = k.slice(0, i);
    const query = k.slice(i + 1);
    // Безанкорные ('' и [домен]) показаны в своём блоке.
    if (!query || /^\[.*\]$/.test(query) || hostOf(page) !== h) continue;
    out.push({ page, query, qty: m.qty, at: m.at });
  }
  return out.sort((a, b) => a.at - b.at).map(({ at: _a, ...x }) => x);
}

/**
 * Безанкорная ссылка на страницу (вид 'url' — текст = полный адрес, 'domain' —
 * просто адрес): добавить в выбранную группу или убрать. Количество меняется
 * через setQty({ page, query: nakedQuery(variant) }).
 */
export async function toggleNaked(siteUrl: string, page: string, query: string, variant: 'url' | 'domain', qty: number) {
  const g = activeGroup();
  if (!g) {
    gi.error = 'Сначала выберите группу над таблицей';
    return;
  }
  const k = itemKey(page, query);
  if (gi.busy.has(k)) return;
  gi.busy = new Set(gi.busy).add(k);
  const had = inActive(page, query);
  try {
    const data = had
      ? await post('/groups/items', { action: 'remove', groupId: g.id, page, query })
      : await post('/groups/items', { action: 'naked', groupId: g.id, site: siteUrl, page, qty, variant });
    const rest = (gi.marks[k] ?? []).filter((m) => m.groupId !== g.id);
    gi.marks = { ...gi.marks, [k]: had ? rest : [...rest, { groupId: g.id, name: g.name, qty, at: Date.now() }] };
    gi.groups = data.groups;
    gi.error = null;
    if (lastSite) refreshHistory();
  } catch (e) {
    gi.error = (e as Error).message;
  } finally {
    const next = new Set(gi.busy);
    next.delete(k);
    gi.busy = next;
  }
}

// ─── «Мои другие сайты»: кто ещё из ваших сайтов виден по ключу ────────────────
export interface OtherOwner { host: string; siteUrl?: string; page?: string; position: number; impressions: number; clicks: number }
export interface OtherLink { host: string; groupId: number; groupName: string; qty: number; at: number; itemId?: number; fixed?: boolean }

export const comp = $state({
  byQuery: {} as Record<string, { owners: OtherOwner[]; links: OtherLink[] }>,
  loading: false,
  ownersLoaded: false,
  error: null as string | null
});

let compKey = '';

/** Сначала быстро — ссылки из групп, затем позиции других сайтов из Google. */
export async function loadCompetition(site: string, queries: string[]) {
  const key = site + '\n' + queries.join('\n');
  if (key === compKey) return;
  compKey = key;
  const ask = async (linksOnly: boolean) => {
    const res = await fetch('/groups/competition' + (linksOnly ? '?links=1' : ''), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ site, queries })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  try {
    comp.loading = true;
    comp.error = null;
    const fast = await ask(true);
    if (key !== compKey) return;
    comp.byQuery = fast.byQuery;
    const full = await ask(false);
    if (key !== compKey) return;
    comp.byQuery = full.byQuery;
    comp.ownersLoaded = true;
  } catch (e) {
    comp.error = (e as Error).message;
  } finally {
    if (key === compKey) comp.loading = false;
  }
}
