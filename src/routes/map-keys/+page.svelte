<script lang="ts">
  // «Ключи карты» (просьба владелицы 18.11.2026): главные и второстепенные ключи
  // из «Карты ключей FUT» — какой сайт и страница должны стоять, где стоят на
  // самом деле, какие ваши другие сайты той же страны видны по ключу (и выше ли
  // они), сколько ссылок куплено на этот ключ. Позиции — за последние 7 дней.
  import { onMount } from 'svelte';
  import SortTh from '$lib/components/SortTh.svelte';
  import SiteLabel from '$lib/components/SiteLabel.svelte';
  import { useLabels } from '$lib/site-labels.svelte';
  import { TableSort } from '$lib/table-sort.svelte';
  import { selecting } from '$lib/utils/selecting';
  import type { MapKeyRow, MapKeyFlag } from '$lib/server/map-keys';

  let { data } = $props();
  $effect.pre(() => useLabels(data.labels));

  let rows = $state<MapKeyRow[]>([]);
  let days = $state(7);
  let errors = $state<string[]>([]);
  let loading = $state(true);
  let err = $state<string | null>(null);
  onMount(async () => {
    try {
      const r = await fetch('/map-keys/rows', { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error((await r.text()).slice(0, 200) || `HTTP ${r.status}`);
      const j = await r.json();
      rows = j.rows ?? [];
      days = j.days ?? 7;
      errors = j.errors ?? [];
    } catch (e) {
      err = (e as Error).message;
    } finally {
      loading = false;
    }
  });

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

  type K = 'key' | 'volume' | 'ahrefs' | 'host' | 'position' | 'rivals' | 'bought';
  const sort = new TableSort<K>('volume', -1, ['volume', 'ahrefs', 'rivals', 'bought']);
  const shown = $derived(
    sort.apply(filtered, (r, k) =>
      k === 'key' ? r.key
        : k === 'volume' ? r.volume
        : k === 'ahrefs' ? r.ahrefs
        : k === 'host' ? r.host
        : k === 'position' ? r.position
        : k === 'rivals' ? r.rivals.filter((x) => x.above).length
        : r.bought
    )
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
  const FLAG: Record<MapKeyFlag, [string, string]> = {
    'no-console': ['нет в Search Console', 'Сайта нет ни в одной консоли — позиций Google не видно'],
    'not-ranking': ['не в Google', 'За последние дни у сайта нет ни одного показа по этому ключу и его вариантам в стране ключа'],
    'rival-above': ['выше мой другой сайт', 'В стране ключа ваш другой сайт стоит по нему выше сайта, который должен стоять по карте'],
    'other-page': ['Google ставит другую страницу', 'Google показывает по ключу не ту страницу, что в карте'],
  };
  const site = (h: string) => `https://${h}/`;
</script>

<svelte:head><title>Ключи карты · GSC Hub</title></svelte:head>

<div class="desk">
  <section class="pane">
    <div class="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
      <h1 class="text-base font-semibold">Ключи карты</h1>
      <span class="text-xs text-ink-3">Главные и второстепенные ключи из «Карты ключей FUT»: какой сайт должен стоять, где он стоит в Google в стране ключа за последние {days} дн., кто из ваших сайтов виден в этой стране по тому же ключу и сколько ссылок куплено.</span>
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
      {#if !loading && !err}<span class="text-ink-3">{fmt(filtered.length)} ключей · в топ-10 {fmt(filtered.filter((r) => r.position !== null && r.position <= 10).length)} · выше мой другой сайт {fmt(filtered.filter((r) => r.flags.includes('rival-above')).length)}</span>{/if}
    </div>
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
              <SortTh {sort} k="position" label="Позиция" num title="Место сайта в Google по ключу и его вариантам в стране ключа (UK — Британия, DE — Германия…) за последние дни; ниже — показы и клики там" />
              <SortTh {sort} k="rivals" label="Мои другие сайты" title="Ваши другие сайты с показами по этому ключу в той же стране и их место там. Красным — стоят выше сайта по карте. Сортировка — по числу тех, кто выше" />
              <SortTh {sort} k="bought" label="Ссылки" num title="Ссылок с этим анкором на сайт по карте: куплено (зафиксированные группы) и в плане (незафиксированные)" />
              <th>Что не так</th>
            </tr>
          </thead>
          <tbody>
            {#each shown as r, i (keyOf(r))}
              {@const k = keyOf(r)}
              <tr class="is-site cursor-pointer" class:is-alt={i % 2 === 1} class:is-selected={open.has(k)} onclick={() => !selecting() && toggle(k)}>
                <td class="min-w-[14rem]">
                  <span class="font-semibold text-ink">{r.key}</span>
                  <span class="ml-1 whitespace-nowrap text-[11px]">
                    <span class="badge {r.role === 'main' ? 'badge-ok' : 'badge-muted'}">{r.role === 'main' ? 'главный' : 'второстеп.'}</span>
                    <span class="text-ink-4" title={r.geo}>{r.country}</span>
                  </span>
                </td>
                <td class="num app-num" title="Среднее за год: {fmt(r.avg)} в месяц">{fmt(r.volume)}</td>
                <td class="num app-num {r.ahrefs === null ? 'text-ink-4' : ''}">{r.ahrefs === null ? '—' : fmt(r.ahrefs)}</td>
                <td class="whitespace-nowrap">
                  <span class="flex items-center gap-1">
                    <a class="pii font-semibold text-ink hover:text-acc hover:underline" href={site(r.host)} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{r.host}</a>
                    <span onclick={(e) => e.stopPropagation()} role="presentation"><SiteLabel site={r.host} /></span>
                  </span>
                  <a class="pii text-[11px] text-ink-3 hover:text-acc hover:underline" href={`https://${r.host}${r.url}`} target="_blank" rel="noopener noreferrer" onclick={(e) => e.stopPropagation()}>{r.url}</a>
                </td>
                <td class="num app-num">
                  {#if r.position === null}
                    <span class="text-ink-4">—</span>
                  {:else}
                    <span class={posClass(r.position)}>{pos(r.position)}</span>
                    <div class="text-[11px] text-ink-3">{fmt(r.impressions)} пок. · {fmt(r.clicks)} кл.</div>
                  {/if}
                </td>
                <td class="text-xs">
                  {#if !r.rivals.length}
                    <span class="text-ink-4">—</span>
                  {:else}
                    {#each r.rivals.slice(0, open.has(k) ? 50 : 3) as v (v.host)}
                      <div class="whitespace-nowrap {v.above ? 'text-dn' : 'text-ink-2'}" title="{v.host}{v.page} · место {pos(v.position)} · {fmt(v.impressions)} показов · {fmt(v.clicks)} кликов{v.mapRole ? ` · у этого сайта ключ по карте ${v.mapRole === 'main' ? 'главный' : 'второстепенный'}` : ' · у этого сайта ключа в карте нет'}">
                        <span class="pii font-semibold">{v.host}</span> <span class="app-num">{pos(v.position)}</span>
                        {#if v.mapRole}<span class="badge {v.mapRole === 'main' ? 'badge-ok' : 'badge-muted'} text-[10px]">{v.mapRole === 'main' ? 'его главный' : 'его второстеп.'}</span>{/if}
                      </div>
                    {/each}
                    {#if !open.has(k) && r.rivals.length > 3}<div class="text-ink-4">ещё {r.rivals.length - 3}</div>{/if}
                  {/if}
                </td>
                <td class="num app-num whitespace-nowrap">
                  {#if r.bought || r.planned}
                    <span class={r.bought ? 'font-semibold' : 'text-ink-4'}>{fmt(r.bought)}</span>{#if r.lastBuy}<div class="text-[11px] text-ink-3">последняя {fd(r.lastBuy)}</div>{/if}
                    {#if r.planned}<div class="text-[11px] text-ink-3">в плане {fmt(r.planned)}</div>{/if}
                  {:else}
                    <span class="text-ink-4">0</span>
                  {/if}
                  {#if r.boughtElsewhere.length}<div class="text-[11px] text-warn" title="На этот же ключ куплено другим вашим сайтам той же страны: {r.boughtElsewhere.map((b) => `${b.host} — ${b.qty}`).join(', ')}">другим: {fmt(r.boughtElsewhere.reduce((a, b) => a + b.qty, 0))}</div>{/if}
                </td>
                <td class="text-xs">
                  {#each r.flags as f (f)}<div class={f === 'no-console' ? 'text-ink-4' : 'text-warn'} title={FLAG[f][1]}>{FLAG[f][0]}{f === 'other-page' && r.rankPage ? `: ${r.rankPage}` : ''}</div>{/each}
                  {#if !r.flags.length && r.position !== null && r.position > 10}<div class="text-warn">ниже 10-го места</div>{/if}
                  {#if !r.flags.length && r.position !== null && r.position <= 10}<span class="text-up">в порядке</span>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>
