<script lang="ts">
  // Страница «Ключи сайтов»: все ключи одного сайта за выбранный период со
  // всеми колонками Striking. «В группу» — в группу, выбранную над списком.
  import { onMount } from 'svelte';
  import IntentBadge from './IntentBadge.svelte';
  import SortTh from './SortTh.svelte';
  import GroupCell from './GroupCell.svelte';
  import LastPlanCell from './LastPlanCell.svelte';
  import OtherSitesInline from './OtherSitesInline.svelte';
  import VolumeCell from './VolumeCell.svelte';
  import PositionChart from './PositionChart.svelte';
  import { TableSort } from '$lib/table-sort.svelte';
  import { classifyIntent } from '$lib/utils/intent';
  import { keyMarker, markTitle, missingKeys, ROLE_LABEL, type MapPage } from '$lib/utils/key-map';
  import { checkoutLeads, checkoutSplit } from '$lib/utils/checkout-lead';
  import { Volumes } from '$lib/volumes.svelte';
  import { otherGroups, gi, activeGroup, itemKey, type OtherOwner, type OtherLink } from '$lib/group-items.svelte';

  type Row = { query: string; page: string; position: number; impressions: number; clicks: number; ctr: number };
  let { siteUrl, accountId, period, siteTotals = null }: { siteUrl: string; accountId: string; period: string; siteTotals?: { clicks: number; impressions: number } | null } = $props();

  let rows = $state<Row[]>([]);
  // Переходы к оплате по страницам сайта за период (счётчик хаба): путь → сколько.
  let checkouts = $state<Record<string, number>>({});
  const pathOf = (page: string) => { try { return new URL(page).pathname; } catch { return page; } };
  // По какому ключу пришёл посетитель, неизвестно: переходы страницы стоят у
  // одного её ключа (с наибольшими кликами), а не у каждого.
  const leads = $derived(checkoutLeads(rows, pathOf));
  const isLead = (r: Row) => leads.get(pathOf(r.page)) === r.query;
  const pageCheckouts = (r: Row) => checkouts[pathOf(r.page)] ?? 0;
  const checkoutOf = (r: Row) => (isLead(r) ? pageCheckouts(r) : 0);
  const checkoutTotal = $derived(Object.values(checkouts).reduce((a, b) => a + b, 0));
  const split = $derived(checkoutSplit(checkouts, new Set(leads.keys())));
  // «Карта ключей FUT»: главные и второстепенные ключи сайта; null — сайта в карте нет.
  let keyMap = $state<MapPage[] | null>(null);
  let onlyMap = $state(false);
  const marker = $derived(keyMap ? keyMarker(keyMap) : null);
  const markOf = (r: Row) => marker?.(r.query) ?? null;

  // Графики по дням: сайт целиком и отдельный ключ (ключ + страница).
  type Pt = { date: string; clicks: number; impressions: number; position: number | null };
  const multiDay = $derived(period !== 'today' && period !== 'yesterday');
  let siteChart = $state<{ loading: boolean; points: Pt[]; err: string | null }>({ loading: false, points: [], err: null });
  let showSiteChart = $state(true);
  let kwOpen = $state<string | null>(null);
  let kwCharts = $state<Record<string, { loading: boolean; points: Pt[]; err: string | null }>>({});
  async function fetchDaily(extra: string): Promise<Pt[]> {
    const r = await fetch(`/keywords/daily?site=${encodeURIComponent(siteUrl)}&acc=${encodeURIComponent(accountId)}${extra}`);
    if (!r.ok) throw new Error((await r.text()).slice(0, 200) || `HTTP ${r.status}`);
    return (await r.json()).points ?? [];
  }
  async function loadSiteChart() {
    if (!multiDay) return;
    siteChart = { loading: true, points: [], err: null };
    try {
      siteChart = { loading: false, points: await fetchDaily(''), err: null };
    } catch (e) {
      siteChart = { loading: false, points: [], err: (e as Error).message };
    }
  }
  async function toggleKw(r: Row) {
    const k = r.page + '\n' + r.query;
    kwOpen = kwOpen === k ? null : k;
    if (kwOpen === null || kwCharts[k]) return;
    kwCharts[k] = { loading: true, points: [], err: null };
    try {
      kwCharts[k] = { loading: false, points: await fetchDaily(`&q=${encodeURIComponent(r.query)}&page=${encodeURIComponent(r.page)}`), err: null };
    } catch (e) {
      kwCharts[k] = { loading: false, points: [], err: (e as Error).message };
    }
  }
  let loading = $state(true);
  const notFound = $derived(keyMap && !loading ? missingKeys(keyMap, rows.map((r) => r.query)) : []);
  let err = $state<string | null>(null);
  let other = $state<Record<string, { owners: OtherOwner[]; links: OtherLink[] }>>({});
  let otherLoading = $state(false);
  let search = $state('');
  let kind = $state<'all' | 'conv' | 'brand' | 'any'>('all');
  let limit = $state(300);
  const vols = new Volumes();
  // Отмеченные ключи — для проверки частотности в DataForSEO.
  let picked = $state<Set<string>>(new Set());
  const pickToggle = (q: string) => { const n = new Set(picked); if (n.has(q)) n.delete(q); else n.add(q); picked = n; };

  async function load() {
    loading = true;
    err = null;
    try {
      const r = await fetch(`/keywords/rows?site=${encodeURIComponent(siteUrl)}&acc=${encodeURIComponent(accountId)}&p=${period}`);
      if (!r.ok) throw new Error((await r.text()).slice(0, 200) || `HTTP ${r.status}`);
      const j = await r.json();
      rows = j.rows ?? [];
      checkouts = j.checkouts ?? {};
      keyMap = j.keyMap ?? null;
    } catch (e) {
      err = (e as Error).message;
      return;
    } finally {
      loading = false;
    }
    const queries = [...new Set(rows.map((r) => r.query))].sort();
    vols.load(siteUrl, queries);
    otherLoading = true;
    fetch('/groups/competition', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site: siteUrl, queries }) })
      .then((r) => (r.ok ? r.json() : { byQuery: {} }))
      .then((j) => (other = j.byQuery ?? {}))
      .catch(() => {})
      .finally(() => (otherLoading = false));
  }
  onMount(() => {
    load();
    loadSiteChart();
  });

  const intentOf = (r: Row) => classifyIntent(r.query, r.page);
  type K = 'query' | 'map' | 'intent' | 'page' | 'position' | 'impressions' | 'volume' | 'clicks' | 'ctr' | 'checkout' | 'others' | 'last' | 'group';
  const sort = new TableSort<K>('impressions', -1, ['impressions', 'volume', 'clicks', 'ctr', 'checkout', 'others', 'last', 'group']);
  const filtered = $derived.by(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (s && !r.query.toLowerCase().includes(s) && !r.page.toLowerCase().includes(s)) return false;
      if (onlyMap && !markOf(r)) return false;
      if (kind === 'all') return true;
      const t = intentOf(r);
      return kind === 'any' ? t !== null : t === kind;
    });
  });
  const shown = $derived(
    sort.apply(filtered, (r, k) => {
      if (k === 'intent') return ((t) => (t === 'conv' ? 1 : t === 'brand' ? 2 : null))(intentOf(r));
      if (k === 'map') return ((m) => (m ? (m.role === 'main' ? 1 : 2) : null))(markOf(r));
      if (k === 'volume') return vols.sortValue(r.query);
      if (k === 'checkout') return checkoutOf(r) || null;
      if (k === 'others') {
        const e = other[r.query];
        if (!e) return null;
        const n = new Set([...e.owners.map((o) => o.host), ...e.links.map((l) => l.host)]).size;
        return n ? (e.owners.some((o) => o.position < r.position) ? 1000 : 0) + n : null;
      }
      if (k === 'last') {
        const l = otherGroups(r.page, r.query);
        return l.length ? l[l.length - 1].at : null;
      }
      if (k === 'group') {
        const g = activeGroup();
        return g ? (gi.marks[itemKey(r.page, r.query)]?.find((m) => m.groupId === g.id)?.qty ?? null) : null;
      }
      return r[k];
    })
  );
  const totals = $derived(filtered.reduce((a, r) => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks }), { impressions: 0, clicks: 0 }));
  // Google не показывает редкие («анонимные») запросы: их клики и показы есть
  // в итоге сайта, но не в списке ключей. Показываем разницу, чтобы цифры сходились.
  // «Сегодня»: итог сайта есть (почасовые данные), а ключей Google ещё не отдал.
  const todayNoKeys = $derived(period === 'today' && !loading && !err && rows.length === 0 && !!siteTotals && (siteTotals.clicks > 0 || siteTotals.impressions > 0));
  const hidden = $derived.by(() => {
    if (!siteTotals || loading || err || todayNoKeys) return null;
    const all = rows.reduce((a, r) => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks }), { impressions: 0, clicks: 0 });
    const c = Math.max(0, siteTotals.clicks - all.clicks), i = Math.max(0, siteTotals.impressions - all.impressions);
    return c || i ? { clicks: c, impressions: i } : null;
  });

  const visibleQs = $derived([...new Set(filtered.map((r) => r.query))]);
  const pickedQs = $derived(visibleQs.filter((q) => picked.has(q)));
  const allPicked = $derived(visibleQs.length > 0 && pickedQs.length === visibleQs.length);
  // Отмеченные галочками, а если ничего не отмечено — все в таблице.
  function checkVolumes() {
    const qs = pickedQs.length ? pickedQs : visibleQs;
    if (!qs.length) return;
    if (!confirm(`Проверить частотность ${qs.length} ключей в DataForSEO? Это платно (несколько центов за пачку до 1000 ключей), уже проверенные ключи повторно не оплачиваются.`)) return;
    vols.check(siteUrl, qs);
  }
  const fmt = (n: number) => n.toLocaleString('ru-RU');
</script>

<div class="py-2">
  <div class="mb-2 flex flex-wrap items-center gap-2 text-xs">
    <input class="input h-7 w-64 text-xs" placeholder="Ключ или страница содержит…" bind:value={search} aria-label="Поиск по ключам" />
    <div class="app-segmented" role="group" aria-label="Тип ключа">
      {#each [['all', 'все'], ['any', 'зелёные + жёлтые'], ['conv', 'конверсия'], ['brand', 'бренд / комм.']] as [v, label] (v)}
        <button type="button" class:is-active={kind === v} onclick={() => (kind = v as typeof kind)}>{label}</button>
      {/each}
    </div>
    {#if keyMap}<label class="flex items-center gap-1 text-ink-2" title="Только ключи, которые есть в «Карте ключей FUT» у этого сайта (и их варианты)"><input type="checkbox" bind:checked={onlyMap} /> только из карты ключей</label>{/if}
    {#if !loading && !err}
      <span class="text-ink-3">{fmt(filtered.length)} строк · {fmt(totals.impressions)} показов · {fmt(totals.clicks)} кликов · перешли к оплате на сайте {fmt(checkoutTotal)}{#if checkoutTotal}<span title="Переходы к оплате со страниц, у которых есть ключи в этой таблице, и с остальных страниц сайта (оформление заказа, страницы без показов в Google)"> (на страницах с ключами {fmt(split.withKeys)}, на других {fmt(split.other)})</span>{/if}</span>
      {#if hidden}<span class="rounded bg-warn-t px-1.5 py-0.5 text-ink-2" title="Google скрывает редкие запросы (их ищут единицы людей) ради приватности. Их клики и показы входят в итог сайта, но ключей не видно — так же и в самой Search Console.">Скрыто Google: {fmt(hidden.clicks)} кликов · {fmt(hidden.impressions)} показов</span>{/if}
      <span class="flex-1"></span>
      <button type="button" class="btn btn-sec btn-sm" disabled={vols.checking || !filtered.length} title="Точная частотность от Google Ads по ключам в таблице (с учётом фильтра)" onclick={checkVolumes}>{vols.checking ? 'Проверяю…' : pickedQs.length ? `Частотность отмеченных в DataForSEO (${pickedQs.length})` : `Частотность в DataForSEO — все (${visibleQs.length})`}</button>
      {#if pickedQs.length}<button type="button" class="btn btn-ghost btn-sm" onclick={() => (picked = new Set())}>Снять отметки</button>{/if}
    {/if}
  </div>
  {#if !loading && !err}
    {#if keyMap}
      {@const main = keyMap.filter((p) => p.role === 'main')}
      <p class="mb-1 text-xs text-ink-2">
        Карта ключей FUT: главный {#each main as p, i (p.country + p.url)}{i ? ', ' : ''}<span class="badge badge-ok" title="{p.url} ({p.country})">{p.key}</span>{/each}{#if !main.length}—{/if}
        · второстепенных {keyMap.length - main.length}
        {#if notFound.length}
          · <span class="text-warn" title="Ни одного показа в Google за период по этим ключам карты (и их вариантам)">нет в Google за период: {notFound.map((p) => `${p.key}${p.role === 'main' ? ' (главный)' : ''}`).join(', ')}</span>
        {/if}
      </p>
    {:else}
      <p class="mb-1 text-xs text-ink-4">Сайта пока нет в «Карте ключей FUT» — пометок «главный» и «второстепенный» нет. Хаб ищет его в карте раз в 3 дня.</p>
    {/if}
  {/if}
  {#if vols.error}<p class="mb-1 text-xs text-bad">{vols.error}{#if !vols.configured} — <a class="text-acc underline" href="/settings/integrations">раздел «Сервисы»</a>{/if}</p>{/if}
  {#if vols.note}<p class="mb-1 text-xs text-emerald-700">{vols.note}</p>{/if}

  {#if multiDay}
    <div class="mb-2 rounded border border-line bg-pane p-2">
      <button type="button" class="mb-1 flex items-center gap-1 text-xs font-semibold text-ink-2" onclick={() => (showSiteChart = !showSiteChart)}>
        <svg viewBox="0 0 16 16" class="h-3 w-3 transition-transform {showSiteChart ? 'rotate-90' : ''}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
        Позиция сайта по дням
      </button>
      {#if showSiteChart}
        {#if siteChart.loading}<p class="loading text-xs">Загружаю график…</p>
        {:else if siteChart.err}<p class="text-xs text-bad">График не загрузился: {siteChart.err}</p>
        {:else if siteChart.points.some((p) => p.position !== null)}<PositionChart points={siteChart.points} />
        {:else}<p class="text-xs text-ink-3">За этот период показов в Google нет.</p>{/if}
      {/if}
    </div>
  {/if}

  {#if loading}
    <p class="loading text-xs">Загружаю ключи…</p>
  {:else if err}
    <p class="text-xs text-bad">Не загрузилось: {err} <button type="button" class="btn btn-ghost btn-sm" onclick={load}>Повторить</button></p>
  {:else if todayNoKeys}
    <p class="notice notice-warn text-xs">Ключи за сегодня Google пока не отдаёт. Итог сайта ({fmt(siteTotals?.clicks ?? 0)} кликов · {fmt(siteTotals?.impressions ?? 0)} показов) — из почасовых данных, как «24 часа» в Search Console; по каким ключам они пришли, Google покажет позже. Выберите в шапке «Вчера», чтобы увидеть ключи за прошлый день.</p>
  {:else if shown.length === 0}
    <p class="text-xs text-ink-3">Нет ключей за этот период{search || kind !== 'all' ? ' с этим фильтром' : ''}.</p>
  {:else}
    <div class="max-h-[40rem] overflow-auto rounded border border-line bg-pane">
      <table class="app-table">
        <thead class="sticky top-0 z-10 bg-pane">
          <tr>
            <th class="w-8"><input type="checkbox" checked={allPicked} aria-label="Отметить все ключи" onchange={() => (picked = allPicked ? new Set() : new Set(visibleQs))} /></th>
            <SortTh {sort} k="query" label="Ключ" />
            <SortTh {sort} k="map" label="Карта" title="Главный или второстепенный ключ сайта по «Карте ключей FUT» (вместе с вариантами — Google считает их одним запросом)" />
            <SortTh {sort} k="intent" label="Тип" />
            <SortTh {sort} k="page" label="Страница" />
            <SortTh {sort} k="position" label="Pos" num />
            <SortTh {sort} k="impressions" label="Impr" num />
            <SortTh {sort} k="volume" label={vols.country ? `Частотность · ${vols.country.toUpperCase()}` : 'Частотность'} num />
            <SortTh {sort} k="clicks" label="Clicks" num />
            <SortTh {sort} k="ctr" label="CTR" num />
            <SortTh {sort} k="checkout" label="Оплата" num title="Переходы к оплате (на партнёрку), сделанные на странице за период — по счётчику хаба. По какому ключу пришёл посетитель, Google не сообщает, поэтому число страницы стоит один раз — у её ключа с наибольшими кликами" />
            <SortTh {sort} k="others" label="Мои другие сайты" title="Другие ваши сайты той же страны по этому ключу и ссылки на них. Красным — стоит выше" />
            <SortTh {sort} k="last" label="Последняя закупка" />
            <SortTh {sort} k="group" label="В группу" num />
          </tr>
        </thead>
        <tbody>
          {#each shown.slice(0, limit) as r (r.page + '\n' + r.query)}
            {@const mk = markOf(r)}
            <tr class:is-selected={picked.has(r.query)}>
              <td><input type="checkbox" checked={picked.has(r.query)} aria-label="Отметить ключ {r.query}" onchange={() => pickToggle(r.query)} /></td>
              <td class="pii font-medium">
                <span class="flex items-center gap-1">
                  {r.query}
                  {#if multiDay}<button type="button" class="btn btn-ghost btn-sm h-5 px-1 {kwOpen === r.page + '\n' + r.query ? 'text-acc' : 'text-ink-4'}" title="Позиция этого ключа по дням" aria-label="График позиции ключа {r.query}" onclick={() => toggleKw(r)}><svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12l4-4 3 3 5-6"/></svg></button>{/if}
                </span>
              </td>
              <td>{#if mk}<span class="badge {mk.role === 'main' ? 'badge-ok' : 'badge-muted'} whitespace-nowrap" title={markTitle(mk)}>{ROLE_LABEL[mk.role]}{mk.same ? '' : ' ≈'}</span>{/if}</td>
              <td><IntentBadge query={r.query} page={r.page} /></td>
              <td class="min-w-[14rem] max-w-sm"><a class="pii break-all text-ink-3 hover:text-acc hover:underline" href={r.page} target="_blank" rel="noopener noreferrer">{r.page}</a></td>
              <td class="num app-num">{r.position.toFixed(1)}</td>
              <td class="num app-num">{fmt(r.impressions)}</td>
              <td class="num"><VolumeCell v={vols.byQuery[r.query]} loading={vols.loading} /></td>
              <td class="num app-num">{fmt(r.clicks)}</td>
              <td class="num app-num">{(r.ctr * 100).toFixed(1)}%</td>
              <td class="num app-num">{#if checkoutOf(r)}<span class="badge badge-ok" title="Переходы к оплате на странице {pathOf(r.page)} за период — всей страницы, не только по этому ключу">✓ {fmt(checkoutOf(r))}</span>{:else if pageCheckouts(r)}<span class="text-ink-4" title="Переходы к оплате на странице {pathOf(r.page)} ({fmt(pageCheckouts(r))}) показаны один раз — у ключа «{leads.get(pathOf(r.page))}»">—</span>{:else}<span class="text-ink-4">—</span>{/if}</td>
              <td class="min-w-[10rem]"><OtherSitesInline owners={other[r.query]?.owners ?? []} links={other[r.query]?.links ?? []} position={r.position} loading={otherLoading} query={r.query} /></td>
              <td><LastPlanCell page={r.page} query={r.query} /></td>
              <td class="num"><GroupCell row={{ siteUrl, query: r.query, page: r.page, position: r.position, impressions: r.impressions, clicks: r.clicks, ctr: r.ctr }} /></td>
            </tr>
            {#if kwOpen === r.page + '\n' + r.query}
              {@const c = kwCharts[kwOpen]}
              <tr class="bg-sunk hover:bg-sunk">
                <td></td>
                <td colspan="13" class="py-2">
                  <div class="mb-1 text-xs font-semibold text-ink-2">«{r.query}» на {pathOf(r.page)} — по дням</div>
                  {#if !c || c.loading}<p class="loading text-xs">Загружаю график…</p>
                  {:else if c.err}<p class="text-xs text-bad">График не загрузился: {c.err}</p>
                  {:else if c.points.some((p) => p.position !== null)}<PositionChart points={c.points} height={150} />
                  {:else}<p class="text-xs text-ink-3">По дням данных нет: Google показывает этот ключ слишком редко.</p>{/if}
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
    {#if shown.length > limit}
      <button type="button" class="btn btn-ghost btn-sm mt-1" onclick={() => (limit += 500)}>Показать ещё ({fmt(shown.length - limit)})</button>
    {/if}
  {/if}
</div>
