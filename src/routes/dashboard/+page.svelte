<script lang="ts">
  // Dashboard — все сайты таблицей, строка на сайт (просьба владелицы 13.11.2026:
  // карточки занимали место и мешали сравнивать). Сортировка по любой колонке —
  // видно, какой сайт упал, какой поднялся; изменения — к прошлому периоду или
  // к выбранным датам; закупки ссылок; звёздочка — сайт в избранном (наверху).
  // График — по раскрытию строки (при периоде длиннее дня).
  import PeriodNote from '$lib/components/PeriodNote.svelte';
  import SortTh from '$lib/components/SortTh.svelte';
  import SiteLabel from '$lib/components/SiteLabel.svelte';
  import { TableSort } from '$lib/table-sort.svelte';
  import { useLabels } from '$lib/site-labels.svelte';
  import { labelKey } from '$lib/utils/site-label';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { siteHref, siteDomain } from '$lib/utils/site';
  import { SERIES } from '$lib/chart-theme';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  $effect.pre(() => useLabels(data.labels));

  type Entry = PageData['entries'][number];
  type DailyRow = Entry['current'][number];
  const hostOf = (e: Entry) => labelKey(e.siteUrl);
  const keyOf = (e: Entry) => `${e.accountId}|${e.siteUrl}`;

  // ── Избранное: в панели, у каждого пользователя своё ──
  let favs = $state<Set<string>>(new Set());
  $effect.pre(() => {
    favs = new Set(data.favorites);
  });
  async function postFavs(body: unknown) {
    try {
      const r = await fetch('/dashboard/favorites', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) favs = new Set(((await r.json()) as { favorites: string[] }).favorites);
    } catch {
      /* звёздочка останется до перезагрузки */
    }
  }
  function toggleFav(e: Entry) {
    const h = hostOf(e);
    const on = !favs.has(h);
    const next = new Set(favs);
    if (on) next.add(h);
    else next.delete(h);
    favs = next;
    postFavs({ site: e.siteUrl, on });
  }

  // ── Скрытые сайты (общий список с /properties): внизу, свёрнуто ──
  let hidden = $state<Set<string>>(new Set());
  async function unhide(e: Entry) {
    const next = new Set(hidden);
    next.delete(keyOf(e));
    hidden = next;
    try {
      await fetch('/properties/hidden-sites', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account: e.accountId, site: e.siteUrl }) });
    } catch {
      /* вернётся при следующей загрузке */
    }
  }

  onMount(() => {
    // Звёзды, которые раньше жили в браузере, — переносим в панель один раз.
    try {
      const old = JSON.parse(localStorage.getItem('gsc-hub:favs') ?? '[]') as string[];
      if (old.length) postFavs({ add: old.map((k) => k.slice(k.indexOf('|') + 1)) }).then(() => localStorage.removeItem('gsc-hub:favs'));
    } catch {
      /* пустое или битое — нечего переносить */
    }
    fetch('/properties/hidden-sites')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { hidden: string[] }) => (hidden = new Set(j.hidden)))
      .catch(() => {});
  });

  // ── С чем сравниваем ──
  const shiftDay = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const fd = (iso: string) => iso.split('-').reverse().join('.');
  const period = $derived((page.data as { period?: { startDate: string; endDate: string; days: number } }).period ?? null);
  const cmpRange = $derived.by(() => {
    if (data.cmp.start && data.cmp.end) return { start: data.cmp.start, end: data.cmp.end };
    if (!period) return null;
    const end = shiftDay(period.startDate, -1);
    return { start: shiftDay(end, -(period.days - 1)), end };
  });
  const cmpLabel = $derived(cmpRange ? (cmpRange.start === cmpRange.end ? fd(cmpRange.start) : `${fd(cmpRange.start)} – ${fd(cmpRange.end)}`) : '');
  let customDate = $state('');
  function setCmp(v: string) {
    const q = new URLSearchParams(page.url.searchParams);
    if (v === 'prev') q.delete('cmp');
    else q.set('cmp', v);
    goto(`?${q}`, { keepFocus: true, noScroll: true });
  }

  // ── Цифры строки ──
  const pct = (cur: number, prev: number): number | null => (prev ? Math.round(((cur - prev) / prev) * 100) : cur ? null : 0);
  /** Позиция: плюс — поднялся (место стало меньше). */
  const posMove = (cur: number, prev: number): number | null => (cur && prev ? Math.round((prev - cur) * 10) / 10 : null);
  function figures(e: Entry) {
    const c = e.currentTotals, p = e.previousTotals;
    return {
      clicks: c.clicks,
      dClicks: data.comparable ? c.clicks - p.clicks : null,
      pClicks: data.comparable ? pct(c.clicks, p.clicks) : null,
      impr: c.impressions,
      dImpr: data.comparable ? c.impressions - p.impressions : null,
      pImpr: data.comparable ? pct(c.impressions, p.impressions) : null,
      ctr: c.impressions ? c.ctr : null,
      pos: c.position || null,
      dPos: data.comparable ? posMove(c.position, p.position) : null
    };
  }

  type K = 'site' | 'clicks' | 'dClicks' | 'impr' | 'dImpr' | 'ctr' | 'pos' | 'dPos' | 'buy';
  const sort = new TableSort<K>('clicks', -1, ['clicks', 'dClicks', 'impr', 'dImpr', 'ctr', 'dPos', 'buy']);
  const sortValue = (e: Entry, k: K): string | number | null => {
    if (e.error && k !== 'site' && k !== 'buy') return null;
    if (k === 'site') return siteDomain(e.siteUrl);
    if (k === 'buy') return e.buys[0]?.date ?? null;
    return figures(e)[k];
  };
  const visible = $derived(data.entries.filter((e) => !hidden.has(keyOf(e))));
  // Избранные — всегда наверху, в том же порядке сортировки.
  const rows = $derived.by(() => {
    const sorted = sort.apply(visible, sortValue);
    return [...sorted.filter((e) => favs.has(hostOf(e))), ...sorted.filter((e) => !favs.has(hostOf(e)))];
  });
  const hiddenRows = $derived(data.entries.filter((e) => hidden.has(keyOf(e))));

  const totals = $derived.by(() => {
    let c = 0, i = 0, pc = 0, pi = 0, pw = 0, ppw = 0;
    for (const e of visible) {
      if (e.error) continue;
      c += e.currentTotals.clicks;
      i += e.currentTotals.impressions;
      pc += e.previousTotals.clicks;
      pi += e.previousTotals.impressions;
      pw += e.currentTotals.position * e.currentTotals.impressions;
      ppw += e.previousTotals.position * e.previousTotals.impressions;
    }
    const pos = i ? pw / i : 0, ppos = pi ? ppw / pi : 0;
    return {
      clicks: c, dClicks: data.comparable ? c - pc : null, pClicks: data.comparable ? pct(c, pc) : null,
      impr: i, dImpr: data.comparable ? i - pi : null, pImpr: data.comparable ? pct(i, pi) : null,
      ctr: i ? c / i : null, pos: pos || null, dPos: data.comparable ? posMove(pos, ppos) : null
    };
  });

  // ── Раскрытая строка: график ──
  let open = $state<Set<string>>(new Set());
  const canOpen = $derived(data.days > 1);
  function toggleOpen(e: Entry) {
    if (!canOpen) return;
    const k = keyOf(e);
    const n = new Set(open);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    open = n;
  }

  const nf = new Intl.NumberFormat('ru-RU');
  const fmt = (n: number) => nf.format(Math.round(n));
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
  function siteDetailHref(e: Entry) {
    return `/properties/${encodeURIComponent(e.siteUrl)}?acc=${encodeURIComponent(e.accountId)}`;
  }

  // ── График: клики и показы — каждая линия в своём масштабе, позиция —
  // лучшее место наверху; сравниваемый период — пунктиром. ──
  const W = 100, H = 40;
  function seriesPath(rs: DailyRow[], key: 'clicks' | 'impressions'): string {
    if (!rs.length) return '';
    const vals = rs.map((r) => r[key]);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const yOf = (v: number) => (hi === lo ? H / 2 : H * 0.92 - ((v - lo) / (hi - lo)) * H * 0.84);
    const step = rs.length > 1 ? W / (rs.length - 1) : 0;
    return rs.map((r, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(2)},${yOf(r[key]).toFixed(2)}`).join(' ');
  }
  function areaPath(rs: DailyRow[]): string {
    const line = seriesPath(rs, 'clicks');
    if (!line) return '';
    const step = rs.length > 1 ? W / (rs.length - 1) : 0;
    return `${line} L${((rs.length - 1) * step).toFixed(2)},${H} L0,${H} Z`;
  }
  function posPath(rs: DailyRow[]): string {
    const vals = rs.filter((r) => r.impressions > 0 && r.position > 0).map((r) => r.position);
    if (!vals.length) return '';
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const yOf = (v: number) => (hi === lo ? H / 2 : H * 0.08 + ((v - lo) / (hi - lo)) * H * 0.84);
    const step = rs.length > 1 ? W / (rs.length - 1) : 0;
    let d = '', on = false;
    rs.forEach((r, i) => {
      if (!(r.impressions > 0 && r.position > 0)) return void (on = false);
      d += `${on ? ' L' : ' M'}${(i * step).toFixed(2)},${yOf(r.position).toFixed(2)}`;
      on = true;
    });
    return d.trim();
  }
  function eventX(rs: DailyRow[], date: string): number | null {
    if (!rs.length) return null;
    let i = rs.findIndex((r) => r.date >= date);
    if (i === -1) i = rs.length - 1;
    return Math.min(W, Math.max(0, i * (rs.length > 1 ? W / (rs.length - 1) : 0)));
  }
</script>

<svelte:head><title>Dashboard — gsc-hub</title></svelte:head>

{#snippet delta(d: number | null, p: number | null)}
  {#if d === null}
    <span class="text-ink-4">—</span>
  {:else if d === 0}
    <span class="text-ink-3">0</span>
  {:else}
    <span class="pii whitespace-nowrap {d > 0 ? 'text-up' : 'text-dn'}">{signed(d)}{#if p !== null && p !== 0}<span class="ml-1 text-[11px] opacity-80">{p > 0 ? '+' : '−'}{Math.abs(p)}%</span>{/if}</span>
  {/if}
{/snippet}

{#snippet posDelta(d: number | null)}
  {#if d === null}
    <span class="text-ink-4">—</span>
  {:else if d === 0}
    <span class="text-ink-3">0</span>
  {:else}
    <span class="pii whitespace-nowrap {d > 0 ? 'text-up' : 'text-dn'}" title={d > 0 ? `Поднялся на ${d}` : `Опустился на ${Math.abs(d)}`}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span>
  {/if}
{/snippet}

{#snippet buysCell(e: Entry)}
  {@const last = e.buys[0]}
  {#if !last}
    <span class="text-ink-4">—</span>
  {:else}
    <a class="whitespace-nowrap hover:text-acc hover:underline" href="/purchases?g={last.groupId}" title="Группа {last.name}: {last.anchors.join(', ')}. Нажмите — что изменилось после закупки">{fd(last.date)} · {last.qty} ссыл.</a>
    {#if e.buys.length > 1}
      <details class="relative inline-block">
        <summary class="ml-1 cursor-pointer list-none rounded bg-sunk px-1 text-[10px] text-ink-2" title="Все закупки ссылок на этот сайт">ещё {e.buys.length - 1}</summary>
        <ul class="absolute right-0 z-20 mt-1 min-w-[16rem] rounded border border-line bg-pane p-1 text-left shadow-lg">
          {#each e.buys as b (b.groupId)}
            <li><a class="block whitespace-nowrap rounded px-2 py-0.5 hover:bg-sunk" href="/purchases?g={b.groupId}" title={b.anchors.join(', ')}>{fd(b.date)} · {b.qty} ссыл. · {b.name}</a></li>
          {/each}
        </ul>
      </details>
    {/if}
  {/if}
{/snippet}

{#snippet row(e: Entry, dim: boolean)}
  {@const f = figures(e)}
  {@const isOpen = open.has(keyOf(e))}
  {@const domain = siteDomain(e.siteUrl)}
  <tr class="{canOpen ? 'cursor-pointer' : ''} {dim ? 'opacity-60' : ''}" class:is-selected={isOpen} onclick={() => toggleOpen(e)}>
    <td class="w-8 text-center" onclick={(ev) => ev.stopPropagation()}>
      {#if dim}
        <button type="button" class="btn btn-ghost btn-sm text-xs" title="Вернуть сайт в таблицу" onclick={() => unhide(e)}>вернуть</button>
      {:else}
        <button type="button" class="fav {favs.has(hostOf(e)) ? 'is-on' : ''}" aria-pressed={favs.has(hostOf(e))} title={favs.has(hostOf(e)) ? 'Убрать из избранного' : 'В избранное — сайт будет наверху таблицы'} onclick={() => toggleFav(e)}>
          <svg viewBox="0 0 24 24" class="h-4 w-4" fill={favs.has(hostOf(e)) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
        </button>
      {/if}
    </td>
    <td class="font-semibold text-ink">
      <span class="flex items-center gap-1.5">
        {#if canOpen}<svg viewBox="0 0 16 16" class="h-3 w-3 shrink-0 text-ink-4 transition-transform {isOpen ? 'rotate-90' : ''}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>{/if}
        <a class="pii hover:text-acc hover:underline" href={siteDetailHref(e)} onclick={(ev) => ev.stopPropagation()} title="Страница сайта в хабе: графики, страницы, ключи">{domain}</a>
        <span onclick={(ev) => ev.stopPropagation()} role="presentation"><SiteLabel site={e.siteUrl} /></span>
        <a class="inline-flex rounded p-0.5 text-ink-4 hover:bg-sunk hover:text-acc" href={siteHref(e.siteUrl)} target="_blank" rel="noopener noreferrer" title="Открыть сайт (в новой вкладке)" aria-label="Открыть сайт {domain}" onclick={(ev) => ev.stopPropagation()}><svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg></a>
      </span>
    </td>
    {#if e.error}
      <td colspan="7" class="pii text-xs text-bad" title={e.error}>не загрузилось: {e.error.slice(0, 80)}</td>
    {:else}
      <td class="num app-num pii font-semibold">{fmt(f.clicks)}</td>
      <td class="num app-num">{@render delta(f.dClicks, f.pClicks)}</td>
      <td class="num app-num pii">{fmt(f.impr)}</td>
      <td class="num app-num">{@render delta(f.dImpr, f.pImpr)}</td>
      <td class="num app-num pii">{f.ctr === null ? '—' : (f.ctr * 100).toFixed(1) + '%'}</td>
      <td class="num app-num pii">{f.pos === null ? '—' : f.pos.toFixed(1)}</td>
      <td class="num app-num">{@render posDelta(f.dPos)}</td>
    {/if}
    <td class="text-xs" onclick={(ev) => ev.stopPropagation()}>{@render buysCell(e)}</td>
  </tr>
  {#if isOpen && !e.error}
    <tr class="bg-sunk hover:bg-sunk">
      <td></td>
      <td colspan="9" class="py-2 pr-3">
        <div class="mb-1 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
          <span class="flex items-center gap-1"><i class="inline-block h-0.5 w-3 rounded-full" style:background={SERIES.clicks}></i>клики</span>
          <span class="flex items-center gap-1"><i class="inline-block h-0.5 w-3 rounded-full" style:background={SERIES.impr}></i>показы</span>
          <span class="flex items-center gap-1"><i class="inline-block h-0.5 w-3 rounded-full bg-ink"></i>позиция (выше — лучше)</span>
          {#if data.comparable && e.previous.length}<span class="flex items-center gap-1"><i class="inline-block w-3 border-t border-dashed" style:border-color={SERIES.prev}></i>{cmpLabel}</span>{/if}
          {#if e.current.length}<span class="ml-auto">{fd(e.current[0].date)} – {fd(e.current[e.current.length - 1].date)}</span>{/if}
        </div>
        <svg viewBox="0 0 {W} {H}" class="h-28 w-full" preserveAspectRatio="none" aria-hidden="true">
          {#if data.comparable && e.previous.length}
            <path d={seriesPath(e.previous, 'impressions')} fill="none" stroke={SERIES.prev} stroke-width="1" stroke-opacity="0.6" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" />
            <path d={seriesPath(e.previous, 'clicks')} fill="none" stroke={SERIES.prev} stroke-width="1.25" stroke-dasharray="4 3" vector-effect="non-scaling-stroke" />
          {/if}
          <path d={seriesPath(e.current, 'impressions')} fill="none" stroke={SERIES.impr} stroke-width="1" vector-effect="non-scaling-stroke" />
          <path d={areaPath(e.current)} fill={SERIES.clicks} fill-opacity="0.08" />
          <path d={seriesPath(e.current, 'clicks')} fill="none" stroke={SERIES.clicks} stroke-width="1.6" vector-effect="non-scaling-stroke" />
          <path class="text-ink" d={posPath(e.current)} fill="none" stroke="currentColor" stroke-width="1.1" stroke-opacity="0.75" vector-effect="non-scaling-stroke" />
          {#each e.events as ev (ev.id)}
            {@const ex = eventX(e.current, ev.date)}
            {#if ex !== null}<line x1={ex} x2={ex} y1="1" y2={H - 1} stroke={ev.color} stroke-width="1.25" vector-effect="non-scaling-stroke"><title>{ev.label} · {ev.date}</title></line>{/if}
          {/each}
        </svg>
      </td>
    </tr>
  {/if}
{/snippet}

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <h1 class="app-pagetitle">Dashboard</h1>
    </div>
    <div class="app-toolbar-right">
      <PeriodNote note={data.comparable && cmpLabel ? `изменения — к ${cmpLabel}` : ''} />
      <div class="app-segmented" title="С чем сравнивать выбранный период: колонки «±» и пунктир на графике">
        <span class="app-segmented-label">Сравнить с</span>
        <button type="button" class:is-active={data.cmp.key === 'prev'} onclick={() => setCmp('prev')} title="Прошлый период той же длины, сразу перед выбранным">прошлым периодом</button>
        {#if data.days <= 7}<button type="button" class:is-active={data.cmp.key === 'week'} onclick={() => setCmp('week')} title="Те же дни неделю назад">неделей раньше</button>{/if}
        <label class="flex items-center gap-1 px-1.5 {data.cmp.key === 'custom' ? 'is-active' : ''}" title="Свой день начала: сравнится период той же длины, начиная с этого дня">
          <span class="text-[12px]">датой</span>
          <input type="date" class="input h-6 px-1 text-[12px]" max={period ? shiftDay(period.startDate, -1) : undefined} value={data.cmp.key === 'custom' ? data.cmp.start : customDate} onchange={(ev) => { customDate = ev.currentTarget.value; if (customDate) setCmp(customDate); }} />
        </label>
      </div>
    </div>
  </header>

  {#if data.errors.length > 0}
    <div class="app-errors">
      <div class="app-errors-title">Ошибки</div>
      <ul class="ml-4 list-disc">
        {#each data.errors as er}<li class="pii"><span class="font-medium">{er.accountEmail}</span>: {er.reason}</li>{/each}
      </ul>
    </div>
  {/if}

  {#if data.entries.length === 0}
    <div class="app-empty">
      <div class="app-empty-title">Сайтов нет</div>
      <p class="app-empty-sub">Подключите консоль Google на странице <a class="text-acc hover:underline" href="/">Accounts</a>.</p>
    </div>
  {:else}
    <div class="overflow-x-auto rounded border border-line bg-pane">
      <table class="app-table is-roomy">
        <thead>
          <tr>
            <th class="w-8" title="Избранное — наверху таблицы"><span class="sr-only">Избранное</span>★</th>
            <SortTh {sort} k="site" label="Сайт" />
            <SortTh {sort} k="clicks" label="Клики" num />
            <SortTh {sort} k="dClicks" label="± клики" num title="Изменение кликов к {cmpLabel || 'прошлому периоду'}: сколько и в процентах" />
            <SortTh {sort} k="impr" label="Показы" num />
            <SortTh {sort} k="dImpr" label="± показы" num title="Изменение показов к {cmpLabel || 'прошлому периоду'}" />
            <SortTh {sort} k="ctr" label="CTR" num />
            <SortTh {sort} k="pos" label="Позиция" num title="Средняя позиция, взвешенная по показам" />
            <SortTh {sort} k="dPos" label="± позиция" num title="▲ — поднялся (место стало выше), ▼ — опустился; к {cmpLabel || 'прошлому периоду'}" />
            <SortTh {sort} k="buy" label="Закупки ссылок" title="Последняя закупка ссылок на сайт из «Групп»: дата и сколько ссылок; нажмите — что изменилось после неё. «ещё N» — прошлые закупки" />
          </tr>
          <tr class="is-total">
            <td></td>
            <td>Итого · {visible.length} сайтов</td>
            <td class="num app-num pii">{fmt(totals.clicks)}</td>
            <td class="num app-num">{@render delta(totals.dClicks, totals.pClicks)}</td>
            <td class="num app-num pii">{fmt(totals.impr)}</td>
            <td class="num app-num">{@render delta(totals.dImpr, totals.pImpr)}</td>
            <td class="num app-num pii">{totals.ctr === null ? '—' : (totals.ctr * 100).toFixed(1) + '%'}</td>
            <td class="num app-num pii">{totals.pos === null ? '—' : totals.pos.toFixed(1)}</td>
            <td class="num app-num">{@render posDelta(totals.dPos)}</td>
            <td></td>
          </tr>
        </thead>
        <tbody>
          {#each rows as e (keyOf(e))}
            {@render row(e, false)}
          {/each}
        </tbody>
      </table>
    </div>

    {#if hiddenRows.length}
      <details class="mt-4">
        <summary class="cursor-pointer text-xs text-ink-3">Скрытые сайты · {hiddenRows.length}</summary>
        <div class="mt-2 overflow-x-auto rounded border border-line bg-pane">
          <table class="app-table" data-nostick>
            <tbody>
              {#each hiddenRows as e (keyOf(e))}
                {@render row(e, true)}
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    {/if}
  {/if}
</main>

<style>
  .fav {
    display: inline-flex;
    padding: 2px;
    border-radius: 4px;
    color: rgb(var(--ink-4));
  }
  .fav:hover {
    color: rgb(var(--ink-2));
    background: rgb(var(--sunk));
  }
  .fav.is-on {
    color: rgb(var(--warn));
  }
</style>
