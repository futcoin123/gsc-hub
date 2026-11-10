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
