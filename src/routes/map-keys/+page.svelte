<script lang="ts">
  // «Ключи карты» (просьба владелицы 18.11.2026): главные и второстепенные ключи
  // из «Карты ключей FUT» — какой сайт и страница должны стоять, где стоят на
  // самом деле, какие ваши другие сайты той же страны видны по ключу (и выше ли
  // они), сколько ссылок куплено на этот ключ. Позиции — за последние 7 дней.
  // Закупка прямо отсюда (просьба владелицы 19.11.2026): «Последняя закупка» и
  // «В группу» у каждого ключа, как на «Ключах сайтов»; в раскрытой строке —
  // безанкорные ссылки (текст — адрес) на главную сайта и на страницу по карте.
  import { onMount, untrack } from 'svelte';
  import SortTh from '$lib/components/SortTh.svelte';
  import PeriodNote from '$lib/components/PeriodNote.svelte';
  import SiteLabel from '$lib/components/SiteLabel.svelte';
  import GroupBar from '$lib/components/GroupBar.svelte';
  import GroupCell from '$lib/components/GroupCell.svelte';
  import LastPlanCell from '$lib/components/LastPlanCell.svelte';
  import NakedCell from '$lib/components/NakedCell.svelte';
  import { useLabels } from '$lib/site-labels.svelte';
  import { TableSort } from '$lib/table-sort.svelte';
  import { selecting } from '$lib/utils/selecting';
  import { foldQuery, hostKey } from '$lib/utils/fold-query';
  import { bareAddress, nakedQuery, NAKED_LABEL, type NakedVariant } from '$lib/utils/naked';
  import { gi, loadGroupItems, activeGroup, keyGroups, inActive, itemKey } from '$lib/group-items.svelte';
  import type { MapKeyRow } from '$lib/server/map-keys';

  let { data } = $props();
  $effect.pre(() => useLabels(data.labels));

  type Range = { startDate: string; endDate: string };
  let rows = $state<MapKeyRow[]>([]);
  // Позиция — за период из шапки, сравнение — с прошлым таким же отрезком;
  // «Мои другие сайты» — за rivalDays дней.
  let period = $state<Range | null>(null);
  let prev = $state<Range | null>(null);
  let rivalDays = $state(7);
  let errors = $state<string[]>([]);
  let loading = $state(true);
  let err = $state<string | null>(null);
  // Группы и их ссылки: колонки «В группу», «Последняя закупка» и живые «Ссылки».
  let giReady = $state(false);
  onMount(() => {
    loadGroupItems().then(() => (giReady = !gi.error));
  });
  let asked = 0;
  async function loadRows() {
    const n = ++asked;
    loading = true;
    err = null;
    try {
      const r = await fetch('/map-keys/rows', { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error((await r.text()).slice(0, 200) || `HTTP ${r.status}`);
      const j = await r.json();
      if (n !== asked) return;
      rows = j.rows ?? [];
      period = j.period ?? null;
      prev = j.prev ?? null;
      rivalDays = j.rivalDays ?? 7;
      errors = j.errors ?? [];
    } catch (e) {
      if (n === asked) err = (e as Error).message;
    } finally {
      if (n === asked) loading = false;
    }
  }
  // Сменили период в шапке — строки заново (страница при этом не перезагружается).
  let loadedFor = '';
  $effect(() => {
    const k = `${data.period.startDate}_${data.period.endDate}`;
    if (k === loadedFor) return;
    loadedFor = k;
    untrack(loadRows);
  });
  const fdm = (iso: string) => iso.split('-').reverse().join('.');
  const rangeLabel = (r: Range | null) => (!r ? '' : r.startDate === r.endDate ? fdm(r.startDate) : `${fdm(r.startDate)} – ${fdm(r.endDate)}`);
  const prevLabel = $derived(rangeLabel(prev));
  /** На сколько мест поднялся (+) или опустился (−) к прошлому отрезку. */
  const posMove = (r: MapKeyRow) => (r.position !== null && r.prevPosition !== null ? Math.round((r.prevPosition - r.position) * 10) / 10 : null);

  // ── Фильтры ──
  let search = $state('');
  let country = $state('');
  let role = $state<'all' | 'main' | 'secondary'>('all');
  let problems = $state(false);
  const countries = $derived([...new Set(rows.map((r) => r.geo))].sort());
  /** Ключ требует внимания: не в Google, мой другой сайт выше, Google ставит другую страницу или ниже 10-го места. */
  const isProblem = (r: MapKeyRow) => r.flags.some((f) => f !== 'no-console') || (r.position !== null && r.position > 10);
  const filtered = $derived(
    rows.filter((r) => {
      const q = search.trim().toLowerCase();
      if (q && !r.key.toLowerCase().includes(q) && !r.host.includes(q)) return false;
      if (country && r.geo !== country) return false;
      if (role !== 'all' && r.role !== role) return false;
      if (problems && !isProblem(r)) return false;
      return true;
    })
  );

  // ── Ссылки на ключ из групп ──
  // Сервер считает их один раз при загрузке; после «+» в группу счёт должен
  // меняться сразу, поэтому, когда группы загрузились, считаем здесь же по
  // пометкам групп: анкор (ключ или его вариант) → сайт, куплено (зафиксированные
  // группы) и в плане (остальные).
  type Links = { bought: number; planned: number; lastBuy: number | null };
  const linkIndex = $derived.by(() => {
    const fixed = new Set(gi.groups.filter((g) => g.fixedAt).map((g) => g.id));
    const out = new Map<string, Links>();
    for (const [k, marks] of Object.entries(gi.marks)) {
      const i = k.indexOf('\n');
      const q = k.slice(i + 1);
      if (!q.trim() || /^\[.*\]$/.test(q)) continue; // безанкорные — не ссылки на ключ
      const id = hostKey(k.slice(0, i)) + '\t' + foldQuery(q);
      const e = out.get(id) ?? { bought: 0, planned: 0, lastBuy: null };
      for (const m of marks) {
        if (fixed.has(m.groupId)) {
          e.bought += m.qty;
          e.lastBuy = Math.max(e.lastBuy ?? 0, m.at);
        } else e.planned += m.qty;
      }
      out.set(id, e);
    }
    return out;
  });
  function linksOf(r: MapKeyRow): Links {
    if (!giReady) return { bought: r.bought, planned: r.planned, lastBuy: r.lastBuy };
    const out: Links = { bought: 0, planned: 0, lastBuy: null };
    for (const q of r.queries) {
      const e = linkIndex.get(r.host + '\t' + q);
      if (!e) continue;
      out.bought += e.bought;
      out.planned += e.planned;
      if (e.lastBuy !== null) out.lastBuy = Math.max(out.lastBuy ?? 0, e.lastBuy);
    }
    return out;
  }

  // ── Безанкорные ссылки сайта строки: на главную — полным адресом и доменом;
  // на страницу по карте, если это не главная, — полным адресом (у главного
  // ключа ещё и адресом без https://, как на «Ключах сайтов»).
  type Naked = { page: string; variant: NakedVariant; what: string };
  function nakedOf(r: MapKeyRow): Naked[] {
    let home = r.page;
    try {
      home = new URL('/', r.page).href;
    } catch {
      /* адрес страницы битый — ссылки только на неё */
    }
    const out: Naked[] = [
      { page: home, variant: 'url', what: 'главная' },
      { page: home, variant: 'domain', what: 'главная' }
    ];
    if (r.page !== home) {
      out.push({ page: r.page, variant: 'url', what: 'страница по карте' });
      if (r.role === 'main') out.push({ page: r.page, variant: 'domain', what: 'страница по карте' });
    }
    return out;
  }
  const nakedInGroup = (r: MapKeyRow) => nakedOf(r).filter((n) => inActive(n.page, nakedQuery(n.variant))).length;

  type K = 'key' | 'volume' | 'ahrefs' | 'host' | 'position' | 'dpos' | 'rivals' | 'bought' | 'last' | 'group';
  const sort = new TableSort<K>('volume', -1, ['volume', 'ahrefs', 'dpos', 'rivals', 'bought', 'last', 'group']);
  const shown = $derived(
    sort.apply(filtered, (r, k) => {
      if (k === 'last') {
        const l = keyGroups(r.page, r.key);
        return l.length ? l[l.length - 1].at : null;
      }
      if (k === 'dpos') {
        // Появился — как сильный рост, выпал — как сильное падение.
        if (r.position !== null && r.prevPosition === null) return 1000;
        if (r.position === null && r.prevPosition !== null) return -1000;
        return posMove(r);
      }
      if (k === 'group') {
        const g = activeGroup();
        return g ? (gi.marks[itemKey(r.page, r.key)]?.find((m) => m.groupId === g.id)?.qty ?? null) : null;
      }
      return k === 'key' ? r.key
        : k === 'volume' ? r.volume
        : k === 'ahrefs' ? r.ahrefs
        : k === 'host' ? r.host
        : k === 'position' ? r.position
        : k === 'rivals' ? r.rivals.filter((x) => x.above).length
        : linksOf(r).bought;
    })
  );

  let open = $state<Set<string>>(new Set());
  const keyOf = (r: MapKeyRow) => `${r.host}\n${r.country}\n${r.key}`;
  function toggle(k: string) {
    const n = new Set(open);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    open = n;
  }

  const nf = new Intl.NumberFormat('ru-RU');
  const fmt = (n: number) => nf.format(Math.round(n));
  const pos = (p: number) => p.toFixed(1).replace('.', ',');
  const posClass = (p: number | null) => (p === null ? 'text-ink-4' : p <= 3 ? 'text-up font-semibold' : p <= 10 ? 'text-ink font-semibold' : p <= 20 ? 'text-warn' : 'text-dn');
  const fd = (ts: number) => new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
  const site = (h: string) => `https://${h}/`;
  const stop = (e: Event) => e.stopPropagation();
</script>

<svelte:head><title>Ключи карты · GSC Hub</title></svelte:head>

<div class="desk">
  <section class="pane">
    <div class="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
      <h1 class="text-base font-semibold">Ключи карты</h1>
      <PeriodNote start={period?.startDate ?? data.period.startDate} end={period?.endDate ?? data.period.endDate} note={prevLabel ? `сравнение — с ${prevLabel}` : ''} />
      <span class="text-xs text-ink-3">Главные и второстепенные ключи из «Карты ключей FUT»: какой сайт должен стоять, где он стоит в Google в стране ключа за период из шапки и как изменилось к прошлому такому же отрезку, кто из ваших сайтов виден в этой стране по тому же ключу (за {rivalDays} дн.) и сколько ссылок куплено. Купить — «В группу» у ключа; безанкорные ссылки на главную — в раскрытой строке (нажмите на строку).</span>
    </div>
    <div class="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-xs">
      <input class="input h-7 w-56 text-xs" placeholder="Ключ или сайт содержит…" bind:value={search} aria-label="Поиск ключа или сайта" />
      <select class="input h-7 text-xs" bind:value={country} aria-label="Страна">
        <option value="">Все страны</option>
        {#each countries as c (c)}<option value={c}>{c}</option>{/each}
      </select>
      <div class="app-segmented" role="group" aria-label="Роль ключа">
        {#each [['all', 'все'], ['main', 'главные'], ['secondary', 'второстепенные']] as [v, label] (v)}
          <button type="button" class:is-active={role === v} onclick={() => (role = v as typeof role)}>{label}</button>
        {/each}
      </div>
      <label class="flex items-center gap-1 text-ink-2" title="Не в Google, ваш другой сайт выше, Google ставит другую страницу или место ниже 10-го"><input type="checkbox" bind:checked={problems} /> только проблемные</label>
      {#if !loading && !err}<span class="text-ink-3">{fmt(filtered.length)} ключей · в топ-10 {fmt(filtered.filter((r) => r.position !== null && r.position <= 10).length)} · выше мой другой сайт {fmt(filtered.filter((r) => r.flags.includes('rival-above')).length)}{#if prevLabel} · <span class="text-up">выросли {fmt(filtered.filter((r) => (posMove(r) ?? 0) > 0).length)}</span> · <span class="text-dn">упали {fmt(filtered.filter((r) => (posMove(r) ?? 0) < 0).length)}</span>{/if}</span>{/if}
    </div>
    <div class="border-b border-line px-3 py-2"><GroupBar /></div>
    {#each errors as e (e)}<p class="px-3 py-1.5 text-xs text-bad">{e}</p>{/each}

    {#if loading}
      <p class="loading p-3 text-xs">Собираю позиции всех сайтов в Google — при первом заходе это до минуты…</p>
    {:else if err}
      <p class="p-3 text-xs text-bad">Не загрузилось: {err}</p>
    {:else if !rows.length}
      <p class="p-3 text-xs text-ink-3">В карте ключей пока нет ключей сайтов.</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="app-table is-roomy is-top">
          <thead>
            <tr>
              <SortTh {sort} k="key" label="Ключ" />
              <SortTh {sort} k="volume" label="Сент." num title="Запросов в Google за сентябрь 2026 по карте (первая цифра вида «План»); при наведении — среднее за год" />
              <SortTh {sort} k="ahrefs" label="Ahrefs" num title="Частотность Ahrefs по карте ключей" />
              <SortTh {sort} k="host" label="Сайт по карте" title="Какой сайт и страница должны стоять по этому ключу" />
              <SortTh {sort} k="position" label="Позиция" num title="Место сайта в Google по ключу и его вариантам в стране ключа (UK — Британия, DE — Германия…) за период из шапки; ниже — показы и клики там" />
              <SortTh {sort} k="dpos" label="± позиция" num title="▲ — поднялся (место стало выше), ▼ — опустился; к {prevLabel || 'прошлому отрезку'}: «Сегодня» — ко вчера, «Вчера» — к позавчера, 7 дней — к прошлым 7. Ниже — место тогда" />
              <SortTh {sort} k="rivals" label="Мои другие сайты" title="Ваши другие сайты с показами по этому ключу в той же стране и их место там — за последние {rivalDays} дн. (не за период в шапке), как на «Ключах сайтов». Красным — стоят выше сайта по карте. Сортировка — по числу тех, кто выше" />
              <SortTh {sort} k="bought" label="Ссылки" num title="Ссылок с этим анкором (ключом или его вариантом) на сайт по карте во всех группах: куплено (зафиксированные группы) и в плане (незафиксированные). Меняется сразу после «В группу»" />
              <SortTh {sort} k="last" label="Последняя закупка" title="Когда в последний раз брали ссылки с этим ключом на страницу по карте и сколько (кроме выбранной сейчас группы). Клик — вся история" />
              <SortTh {sort} k="group" label="В группу" num title="Ссылки с этим ключом на страницу по карте — в группу, выбранную над таблицей: впишите количество и нажмите +. Безанкорные ссылки на главную — в раскрытой строке (нажмите на строку)" />
            </tr>
          </thead>
          <tbody>
            {#each shown as r, i (keyOf(r))}
              {@const k = keyOf(r)}
              {@const ln = linksOf(r)}
              <tr class="is-site cursor-pointer" class:is-alt={i % 2 === 1} class:is-selected={open.has(k)} onclick={() => !selecting() && toggle(k)}>
                <td class="min-w-[14rem]">
                  <svg viewBox="0 0 16 16" class="-ml-0.5 mr-0.5 inline h-3 w-3 align-[-1px] text-ink-4 transition-transform {open.has(k) ? 'rotate-90' : ''}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
                  <span class="font-semibold text-ink">{r.key}</span>
                  <span class="ml-1 whitespace-nowrap text-[11px]">
                    <span class="badge {r.role === 'main' ? 'badge-ok' : 'badge-muted'}">{r.role === 'main' ? 'главный' : 'второстеп.'}</span>
                    <span class="text-ink-4" title={r.geo}>{r.country}</span>
                  </span>
                  {#if nakedInGroup(r)}<div class="mt-0.5 text-[11px]"><span class="badge badge-acc" title="Безанкорных ссылок на {r.host} в выбранной группе — раскройте строку">безанкор в группе: {nakedInGroup(r)}</span></div>{/if}
                </td>
                <td class="num app-num" title="Среднее за год: {fmt(r.avg)} в месяц">{fmt(r.volume)}</td>
                <td class="num app-num {r.ahrefs === null ? 'text-ink-4' : ''}">{r.ahrefs === null ? '—' : fmt(r.ahrefs)}</td>
                <td class="whitespace-nowrap">
                  <span class="flex items-center gap-1">
                    <a class="pii font-semibold text-ink hover:text-acc hover:underline" href={site(r.host)} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{r.host}</a>
                    <span onclick={(e) => e.stopPropagation()} role="presentation"><SiteLabel site={r.host} /></span>
                  </span>
                  <a class="pii text-[11px] text-ink-3 hover:text-acc hover:underline" href={r.page} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{r.url}</a>
                </td>
                <td class="num app-num">
                  {#if r.position === null}
                    <span class="text-ink-4">—</span>
                  {:else}
                    <span class={posClass(r.position)}>{pos(r.position)}</span>
                    <div class="text-[11px] text-ink-3">{fmt(r.impressions)} пок. · {fmt(r.clicks)} кл.</div>
                    {#if r.rankPage !== null && r.rankPage !== r.url}<div class="pii whitespace-nowrap text-[11px] text-warn" title="Google показывает по ключу не ту страницу, что в карте. Страница по карте {r.url}: {r.mapPage ? `место ${pos(r.mapPage.position)}, ${fmt(r.mapPage.impressions)} показов` : 'по ключу не показывается'}">стр. {r.rankPage}</div>{/if}
                  {/if}
                </td>
                <td class="num app-num whitespace-nowrap">
                  {#if r.position !== null && r.prevPosition !== null}
                    {@const d = posMove(r) ?? 0}
                    {#if d === 0}<span class="text-ink-3">0</span>
                    {:else}<span class={d > 0 ? 'text-up' : 'text-dn'} title={d > 0 ? `Поднялся на ${pos(d)}` : `Опустился на ${pos(-d)}`}>{d > 0 ? '▲' : '▼'}{pos(Math.abs(d))}</span>{/if}
                    <div class="text-[11px] text-ink-3" title="Место за {prevLabel}: {pos(r.prevPosition)} · {fmt(r.prevImpressions)} показов">было {pos(r.prevPosition)}</div>
                  {:else if r.position !== null}
                    <span class="text-up" title="За {prevLabel} показов по ключу в стране ключа не было">новый</span>
                  {:else if r.prevPosition !== null}
                    <span class="text-dn" title="За {prevLabel} место было {pos(r.prevPosition)} ({fmt(r.prevImpressions)} показов), за период показов нет">выпал</span>
                    <div class="text-[11px] text-ink-3">было {pos(r.prevPosition)}</div>
                  {:else}
                    <span class="text-ink-4">—</span>
                  {/if}
                </td>
                <td class="text-xs">
                  {#if !r.rivals.length}
                    <span class="text-ink-4">—</span>
                  {:else}
                    {#each r.rivals.slice(0, open.has(k) ? 50 : 3) as v (v.host)}
                      {@const away = !!v.mapCountry && v.mapCountry !== r.country}
                      <div class="whitespace-nowrap {v.above ? 'text-dn' : 'text-ink-2'}" title="{v.host}{v.page} · место {pos(v.position)} в стране этого ключа ({r.country}) за {rivalDays} дн. · {fmt(v.impressions)} показов · {fmt(v.clicks)} кликов{v.mapRole ? ` · у этого сайта ключ по карте ${v.mapRole === 'main' ? 'главный' : 'второстепенный'} для ${v.mapCountry}` : ' · у этого сайта ключа в карте нет'}{away ? ` — его строка в таблице про ${v.mapCountry}, а не про ${r.country}, и место там своё` : ''}. Нажмите на сайт — его ключи карты">
                        <button type="button" class="pii font-semibold hover:underline" onclick={(e) => { e.stopPropagation(); search = v.host; }}>{v.host}</button> <span class="app-num">{pos(v.position)}</span>
                        <span class="pii text-[11px] text-ink-3">{v.page} · {fmt(v.impressions)} пок.</span>
                        {#if v.mapRole}<span class="badge {v.mapRole === 'main' ? 'badge-ok' : 'badge-muted'} text-[10px]">{v.mapRole === 'main' ? 'его главный' : 'его второстеп.'}{away ? ` · ${v.mapCountry}` : ''}</span>{/if}
                      </div>
                    {/each}
                    {#if !open.has(k) && r.rivals.length > 3}<div class="text-ink-4">ещё {r.rivals.length - 3}</div>{/if}
                  {/if}
                </td>
                <td class="num app-num whitespace-nowrap">
                  {#if ln.bought || ln.planned}
                    <span class={ln.bought ? 'font-semibold' : 'text-ink-4'}>{fmt(ln.bought)}</span>{#if ln.lastBuy}<div class="text-[11px] text-ink-3">последняя {fd(ln.lastBuy)}</div>{/if}
                    {#if ln.planned}<div class="text-[11px] text-ink-3">в плане {fmt(ln.planned)}</div>{/if}
                  {:else}
                    <span class="text-ink-4">0</span>
                  {/if}
                  {#if r.boughtElsewhere.length}<div class="text-[11px] text-warn" title="На этот же ключ куплено другим вашим сайтам той же страны: {r.boughtElsewhere.map((b) => `${b.host} — ${b.qty}`).join(', ')}">другим: {fmt(r.boughtElsewhere.reduce((a, b) => a + b.qty, 0))}</div>{/if}
                </td>
                <td><div role="presentation" onclick={stop}><LastPlanCell page={r.page} query={r.key} /></div></td>
                <td class="num"><div role="presentation" onclick={stop}><GroupCell row={{ siteUrl: r.siteUrl, query: r.key, page: r.page, position: r.position ?? undefined, impressions: r.impressions, clicks: r.clicks }} /></div></td>
              </tr>
              {#if open.has(k)}
                <tr class="bg-sunk hover:bg-sunk">
                  <td colspan="10" class="py-2">
                    <div class="mb-1 text-xs font-semibold text-ink-2">
                      Безанкорные ссылки на <span class="pii">{r.host}</span>
                      <span class="font-normal text-ink-3">— текст ссылки просто адрес, без ключа: на главную полным адресом и доменом{r.page !== nakedOf(r)[0].page ? ', на страницу по карте — полным адресом' : ''}. Количество и + — в группу, выбранную над таблицей.</span>
                    </div>
                    <table class="app-table max-w-4xl rounded border border-line bg-pane" data-nostick>
                      <thead><tr><th>Текст ссылки</th><th>Вид</th><th>Страница</th><th>Последняя закупка</th><th class="text-right">В группу</th></tr></thead>
                      <tbody>
                        {#each nakedOf(r) as n (n.page + '|' + n.variant)}
                          <tr>
                            <td class="pii font-medium"><a class="break-all hover:text-acc hover:underline" href={n.page} target="_blank" rel="noopener noreferrer" title="Ссылка ведёт на {n.page}">{n.variant === 'domain' ? bareAddress(n.page) : n.page}</a></td>
                            <td class="whitespace-nowrap text-xs text-ink-3">{NAKED_LABEL[n.variant]}</td>
                            <td class="text-xs"><span class="badge {n.what === 'главная' ? 'badge-ok' : 'badge-muted'}">{n.what}</span></td>
                            <td><LastPlanCell page={n.page} query={nakedQuery(n.variant)} /></td>
                            <td><NakedCell siteUrl={r.siteUrl} page={n.page} variant={n.variant} /></td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>
