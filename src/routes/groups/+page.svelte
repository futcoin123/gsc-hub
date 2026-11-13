<script lang="ts">
  import { NAKED_LABEL, nakedAnchor, nakedVariant } from '$lib/utils/naked';
  import IntentBadge from '$lib/components/IntentBadge.svelte';
  import { enhance } from '$app/forms';
  import { siteHostname } from '$lib/utils/url-filters';
  import OtherSitesInline from '$lib/components/OtherSitesInline.svelte';
  import SiteKeysPanel from '$lib/components/SiteKeysPanel.svelte';
  import PeriodNote from '$lib/components/PeriodNote.svelte';
  import { page } from '$app/state';
  import SortTh from '$lib/components/SortTh.svelte';
  import SortCaret from '$lib/components/SortCaret.svelte';
  import { TableSort } from '$lib/table-sort.svelte';
  import type { OtherOwner, OtherLink } from '$lib/group-items.svelte';
  import { goto, invalidateAll } from '$app/navigation';
  import SiteLabel from '$lib/components/SiteLabel.svelte';
  import { useLabels, labelOf, sl } from '$lib/site-labels.svelte';
  import { blockCompare } from '$lib/utils/site-label';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  $effect.pre(() => useLabels(data.labels));

  const selectedId = $derived(data.selectedId);
  const group = $derived(data.groups.find((g) => g.id === selectedId) ?? null);

  // Галочки редактора. Сбрасываются при смене группы и после сохранения.
  let picked = $state<Set<string>>(new Set());
  let paste = $state('');
  let query = $state('');
  let onlyPicked = $state(false);
  let lastKey = '';
  $effect(() => {
    const key = `${group?.id}:${group?.hosts.join(',')}`;
    if (key !== lastKey) {
      lastKey = key;
      picked = new Set(group?.hosts ?? []);
      paste = '';
    }
  });

  // Сайты консолей плюс домены группы, которых в консолях нет: их тоже видно,
  // чтобы можно было снять галочку.
  const rows = $derived.by(() => {
    const known = new Map(data.knownSites.map((s) => [s.host, s.accounts]));
    for (const h of group?.hosts ?? []) if (!known.has(h)) known.set(h, []);
    return [...known.entries()]
      .map(([host, accounts]) => ({ host, accounts }))
      .sort((a, b) => a.host.localeCompare(b.host));
  });
  const shown = $derived(
    rows.filter(
      (r) =>
        (!onlyPicked || picked.has(r.host)) &&
        (!query.trim() || r.host.includes(query.trim().toLowerCase()) || r.accounts.some((a) => a.toLowerCase().includes(query.trim().toLowerCase())))
    )
  );
  const dirty = $derived(
    !!paste.trim() ||
      picked.size !== (group?.hosts.length ?? 0) ||
      (group?.hosts ?? []).some((h) => !picked.has(h))
  );

  const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString('ru-RU'));
  const knownByHost = $derived(new Map(data.knownSites.map((s) => [s.host, s])));
  const itemsByHost = $derived.by(() => {
    const m = new Map<string, number>();
    for (const it of data.items) {
      let h = '';
      try {
        h = new URL(it.page).hostname.replace(/^www\./, '');
      } catch {}
      m.set(h, (m.get(h) ?? 0) + it.qty);
    }
    return m;
  });
  const openHref = (host: string) => {
    const k = knownByHost.get(host);
    // Через /groups/open: группа становится выбранной в шапке, потом переход на сайт.
    return k ? `/groups/open?g=${group?.id}&site=${encodeURIComponent(k.open.siteUrl)}&acc=${encodeURIComponent(k.open.accountId)}` : null;
  };
  let editorOpen = $state(false);

  // Раскрывашка в «Сайтах группы»: клик по сайту показывает его ссылки в этой группе.
  let openHosts = $state<Set<string>>(new Set());
  function toggleHost(h: string) {
    const next = new Set(openHosts);
    if (next.has(h)) next.delete(h);
    else next.add(h);
    openHosts = next;
  }
  const hostOfItem = (page: string) => {
    try {
      return new URL(page).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  const itemsOfHost = $derived.by(() => {
    const m = new Map<string, typeof data.items>();
    for (const it of data.items) {
      const h = hostOfItem(it.page);
      m.set(h, [...(m.get(h) ?? []), it]);
    }
    return m;
  });

  // Сортировка таблицы «Сайты группы».
  // Статистика сайтов группы за период из шапки, из всех консолей.
  type HostStat = { clicks: number; impressions: number; ctr: number; position: number | null };
  let stats = $state<Record<string, HostStat>>({});
  let statsLoading = $state(false);
  let statsRange = $state('');
  let statsReq = 0;
  async function loadStats(groupId: number, p: string) {
    const my = ++statsReq;
    statsLoading = true;
    try {
      const r = await fetch(`/groups/stats?g=${groupId}&p=${p}`);
      if (!r.ok) throw new Error();
      const j = await r.json();
      if (my !== statsReq) return;
      stats = j.byHost ?? {};
      const fd = (iso: string) => iso.split('-').reverse().join('.');
      statsRange = j.period.startDate === j.period.endDate ? fd(j.period.startDate) : `${fd(j.period.startDate)} – ${fd(j.period.endDate)}`;
    } catch {
      if (my === statsReq) stats = {};
    } finally {
      if (my === statsReq) statsLoading = false;
    }
  }
  $effect(() => {
    if (group && group.hosts.length) loadStats(group.id, page.data.period?.key ?? '');
  });

  type HostKey = 'done' | 'host' | 'console' | 'impressions' | 'clicks' | 'ctr' | 'position' | 'links';
  const hostSort = new TableSort<HostKey>(null, 1, ['links', 'impressions', 'clicks', 'ctr']);
  const sortedHosts = $derived(
    group
      ? hostSort.apply(group.hosts, (h, k) =>
          k === 'done' ? (group.done.includes(h) ? 1 : 0)
          : k === 'host' ? h
          : k === 'console' ? (knownByHost.get(h)?.accounts.join(', ') ?? '')
          : k === 'links' ? (itemsByHost.get(h) ?? 0)
          : (stats[h]?.[k] ?? null)
        )
      : []
  );

  // «Другие сайты»: убрать, поменять количество или добавить ключ для другого сайта.
  async function itemsPost(body: unknown): Promise<boolean> {
    const res = await fetch('/groups/items', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      alert('Не получилось: ' + ((await res.json().catch(() => ({})))?.message ?? res.status));
      return false;
    }
    othersKey = '';
    await invalidateAll();
    return true;
  }
  const removeOther = (l: OtherLink) => l.itemId && itemsPost({ action: 'removeById', groupId: l.groupId, itemId: l.itemId });
  const qtyOther = (l: OtherLink, qty: number) => l.itemId && itemsPost({ action: 'qtyById', groupId: l.groupId, itemId: l.itemId, qty });
  const addOther = (o: OtherOwner, query: string, qty: number) =>
    group &&
    o.siteUrl &&
    o.page &&
    itemsPost({
      action: 'add',
      groupId: group.id,
      item: { siteUrl: o.siteUrl, query, page: o.page, position: o.position, impressions: o.impressions, clicks: o.clicks, qty }
    });

  // Сортировка таблицы ТЗ по клику на заголовок; повторный клик — обратный порядок.
  type SortKey = 'site' | 'kind' | 'query' | 'page' | 'qty' | 'position' | 'impressions' | 'clicks';
  let tzSort = $state<SortKey | null>(null);
  let tzDir = $state<1 | -1>(1);
  function sortTz(k: SortKey) {
    if (tzSort === k) tzDir = tzDir === 1 ? -1 : 1;
    else {
      tzSort = k;
      // Числа — сразу от больших к меньшим, позиция и текст — по возрастанию.
      tzDir = ['qty', 'impressions', 'clicks'].includes(k) ? -1 : 1;
    }
  }
  // Без выбранной колонки ТЗ идёт блоками (просьба владелицы 13.11.2026):
  // сначала по метке сайта (futcoin, потом другие проекты — каждый отдельно),
  // внутри — по стране (вся Италия, потом вся Испания…), дальше сайт, страница,
  // анкор. Сайты без метки и страны, которые ещё не определились, — в конце.
  const geoOf = (i: (typeof data.items)[number]) => tzLocale[i.page]?.geo ?? null;
  const asRow = (i: (typeof data.items)[number]) => ({ label: labelOf(i.siteUrl), geo: geoOf(i), site: siteHostname(i.siteUrl), page: i.page, query: i.query });
  const blockOrder = (a: (typeof data.items)[number], b: (typeof data.items)[number]) => blockCompare(asRow(a), asRow(b));
  const tzItems = $derived.by(() => {
    if (!tzSort) return [...data.items].sort(blockOrder);
    const k = tzSort;
    const val = (i: (typeof data.items)[number]): string | number | null =>
      k === 'site' ? siteHostname(i.siteUrl) : k === 'kind' ? i.kind : k === 'query' ? i.query : k === 'page' ? i.page : i[k];
    return [...data.items].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1; // пустые — всегда вниз
      if (y === null) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ru');
      return c * tzDir;
    });
  });
  const arrow = (k: SortKey) => (tzSort === k ? (tzDir === 1 ? ' ↑' : ' ↓') : '');
  // Заголовки блоков ТЗ: метка и страна, сколько в блоке ссылок.
  const tzBlocks = $derived.by(() => {
    const out = new Map<number, { label?: string; labelQty?: number; geo: string; geoQty: number }>();
    if (tzSort) return out;
    let lastL: string | undefined, lastG: string | undefined, lId = 0, gId = 0;
    for (const it of tzItems) {
      const l = labelOf(it.siteUrl) ?? 'без метки', g = geoOf(it) ?? 'страна определяется…';
      if (l !== lastL) {
        out.set(it.id, { label: l, labelQty: 0, geo: g, geoQty: 0 });
        lId = gId = it.id;
        lastL = l;
        lastG = g;
      } else if (g !== lastG) {
        out.set(it.id, { geo: g, geoQty: 0 });
        gId = it.id;
        lastG = g;
      }
      out.get(lId)!.labelQty! += it.qty;
      out.get(gId)!.geoQty += it.qty;
    }
    return out;
  });

  // Галочки в ТЗ: отметить строки и убрать их разом.
  let tzPicked = $state<Set<number>>(new Set());
  const tzAllPicked = $derived(data.items.length > 0 && data.items.every((i) => tzPicked.has(i.id)));
  const tzPickedCount = $derived(data.items.filter((i) => tzPicked.has(i.id)).length);
  function tzPick(id: number) {
    const n = new Set(tzPicked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    tzPicked = n;
  }

  // «Язык» и «Гео» страниц ТЗ — с самих сайтов, названиями как на бирже ссылок.
  let tzLocale = $state<Record<string, { language: string | null; geo: string }>>({});
  let tzLocaleKey = '';
  $effect(() => {
    const pages = [...new Set(data.items.map((i) => i.page))];
    const key = pages.join('\n');
    if (!pages.length || key === tzLocaleKey) return;
    tzLocaleKey = key;
    fetch('/sites/locale', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pages }) })
      .then((r) => (r.ok ? r.json() : { pages: {} }))
      .then((j) => (tzLocale = j.pages ?? {}))
      .catch(() => {});
  });

  // «Другие сайты» в ТЗ: сначала быстро — ссылки из групп, затем позиции из Google.
  let others = $state<Record<string, { owners: OtherOwner[]; links: OtherLink[] }>>({});
  let othersLoading = $state(false);
  let othersKey = '';
  $effect(() => {
    const pairs = data.items.filter((i) => i.kind === 'anchor').map((i) => ({ site: i.siteUrl, query: i.query }));
    const key = JSON.stringify(pairs);
    if (key === othersKey) return;
    othersKey = key;
    if (!pairs.length) {
      others = {};
      return;
    }
    const ask = (linksOnly: boolean) =>
      fetch('/groups/competition' + (linksOnly ? '?links=1' : ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairs })
      }).then((r) => (r.ok ? r.json() : null));
    othersLoading = true;
    ask(true)
      .then((d) => { if (d && key === othersKey) others = d.byPair; return ask(false); })
      .then((d) => { if (d && key === othersKey) others = d.byPair; })
      .finally(() => { if (key === othersKey) othersLoading = false; });
  });

  // Выбрать группу фильтром в шапке.
  async function chooseInHeader(id: number | null) {
    await fetch('/groups/active', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
    location.reload();
  }

  function toggle(host: string) {
    const next = new Set(picked);
    if (next.has(host)) next.delete(host);
    else next.add(host);
    picked = next;
  }
  function pickShown(on: boolean) {
    const next = new Set(picked);
    for (const r of shown) {
      if (on) next.add(r.host);
      else next.delete(r.host);
    }
    picked = next;
  }
</script>

<svelte:head><title>Группы сайтов — gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <span>gsc-hub</span>
        <span aria-hidden="true">/</span>
        <span class="text-ink-2">Группы</span>
      </nav>
      <h1 class="app-pagetitle">Группы сайтов</h1>
    </div>
  </header>

  <p class="mb-3 max-w-3xl text-sm text-ink-3">
    Группа — список сайтов, например «Приоритет» или закупка «{data.today}». Выберите её в шапке («Сайты: …»):
    все отчёты и Claude будут видеть только её сайты, из любых консолей. Откройте сайт, в Striking Distance
    добавляйте ключи кнопкой <b>+</b> — они собираются здесь, внизу.
  </p>

  {#if sl.error}<p class="mb-2 text-xs text-bad">{sl.error}</p>{/if}
  {#if form && 'error' in form && form.error}
    <p class="mb-3 rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{form.error}</p>
  {/if}
  {#if data.siteErrors.length}
    <p class="mb-3 text-xs text-ink-3">
      Не удалось получить сайты из консолей: {data.siteErrors.map((e) => e.account).join(', ')}. Их сайты можно добавить списком.
    </p>
  {/if}

  <div class="grid gap-3 lg:grid-cols-[16rem_1fr]">
    <section class="pane self-start">
      <div class="pane-head">Группы <span class="aside app-num">{data.groups.length}</span></div>
      <ul class="p-1">
        {#each data.groups as g (g.id)}
          <li>
            <a
              href="?g={g.id}"
              class="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-sunk {g.id === selectedId ? 'bg-sunk font-semibold text-ink' : 'text-ink-2'}"
            >
              <span class="min-w-0 flex-1 truncate">{g.name}</span>
              {#if g.active}<span class="badge badge-ok" title="Выбрана фильтром в шапке">фильтр</span>{/if}
              <span class="app-num text-xs text-ink-3" title="сайтов пройдено / всего · ключей">{g.done.length}/{g.hosts.length}{g.items ? ` · ${g.items}` : ''}</span>
            </a>
          </li>
        {:else}
          <li class="px-2 py-1.5 text-xs text-ink-3">Пока ни одной.</li>
        {/each}
      </ul>
      <form
        method="POST"
        action="?/create"
        class="flex gap-1 border-t border-line p-2"
        use:enhance={() => async ({ result, update }) => {
          await update();
          if (result.type === 'success' && result.data?.created) goto(`?g=${result.data.created}`, { invalidateAll: true });
        }}
      >
        <input name="name" class="input h-7 min-w-0 flex-1 text-xs" placeholder="Новая группа" maxlength="60" required />
        <button class="btn btn-pri btn-sm">Создать</button>
      </form>
    </section>

    {#if group}
      <section class="pane">
        <div class="pane-head flex flex-wrap items-center gap-2">
          <form method="POST" action="?/rename" use:enhance class="flex items-center gap-1">
            <input type="hidden" name="id" value={group.id} />
            <input name="name" value={group.name} class="input h-7 w-48 text-xs normal-case" maxlength="60" required />
            <button class="btn btn-sec btn-sm">Переименовать</button>
          </form>
          <form
            method="POST"
            action="?/delete"
            class="ml-auto"
            use:enhance={({ cancel }) => {
              if (!confirm(`Удалить группу «${group.name}»? Сайты и консоли не пострадают.`)) cancel();
              return async ({ update }) => {
                await update();
                goto('/groups', { invalidateAll: true });
              };
            }}
          >
            <input type="hidden" name="id" value={group.id} />
            <button class="btn btn-danger btn-sm">Удалить группу</button>
          </form>
        </div>

        <div class="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 text-xs">
          {#if group.active}
            <span class="badge badge-ok">выбрана в шапке</span>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => chooseInHeader(null)}>Снять фильтр</button>
          {:else}
            <button type="button" class="btn btn-sec btn-sm" onclick={() => chooseInHeader(group.id)}>Выбрать в шапке</button>
          {/if}
          <span class="text-ink-3">Пройдено {group.done.length} из {group.hosts.length} · ключей {group.items}</span>
          <span class="ml-auto flex items-center gap-1">
            <a class="btn btn-sec btn-sm" href="/groups/{group.id}/csv">Скачать ТЗ (CSV)</a>
            <a class="btn btn-sec btn-sm" href="/purchases?g={group.id}" title="Позиция, показы и клики до и после закупки — по сайтам и по каждому ключу">Результат закупки</a>
            {#if group.fixedAt}
              <span class="badge badge-ok">зафиксирована {new Date(group.fixedAt).toLocaleDateString('ru-RU')}</span>
              <form method="POST" action="?/unfix" use:enhance><input type="hidden" name="id" value={group.id} /><button class="btn btn-ghost btn-sm">Открыть для правок</button></form>
            {:else}
              <form method="POST" action="?/fix" use:enhance><input type="hidden" name="id" value={group.id} /><button class="btn btn-pri btn-sm" disabled={group.items === 0}>Зафиксировать</button></form>
            {/if}
          </span>
        </div>

        {#if group.hosts.length}
          <div class="border-b border-line">
            <div class="flex flex-wrap items-center gap-3 px-3 pt-3">
              <span class="text-xs font-semibold uppercase tracking-wide text-ink-3">Сайты группы</span>
              <PeriodNote />
              <span class="text-xs text-ink-3">{statsLoading ? 'Загружаю…' : statsRange}</span>
            </div>
            <table class="app-table">
              <thead><tr><SortTh sort={hostSort} k="done" label="Пройден" /><SortTh sort={hostSort} k="host" label="Сайт" /><SortTh sort={hostSort} k="console" label="Консоль" /><SortTh sort={hostSort} k="impressions" label="Impr" num /><SortTh sort={hostSort} k="clicks" label="Clicks" num /><SortTh sort={hostSort} k="ctr" label="CTR" num /><SortTh sort={hostSort} k="position" label="Pos" num /><SortTh sort={hostSort} k="links" label="Ссылок" num /><th>Безанкорные</th><th></th></tr></thead>
              <tbody>
                {#each sortedHosts as h (h)}
                  {@const isDone = group.done.includes(h)}
                  <tr class={isDone ? 'opacity-60' : ''}>
                    <td class="text-center">
                      <form method="POST" action="?/done" use:enhance={() => async ({ update }) => update({ reset: false })}>
                        <input type="hidden" name="id" value={group.id} />
                        <input type="hidden" name="host" value={h} />
                        <input type="hidden" name="done" value={isDone ? '0' : '1'} />
                        <input type="checkbox" checked={isDone} aria-label="Сайт {h} пройден" onchange={(e) => e.currentTarget.form?.requestSubmit()} />
                      </form>
                    </td>
                    <td class="pii font-medium text-ink {isDone ? 'line-through' : ''}">
                      <button type="button" class="flex items-center gap-1 text-left hover:text-acc" aria-expanded={openHosts.has(h)} title="Показать ссылки этого сайта в группе" onclick={() => toggleHost(h)}>
                        <svg viewBox="0 0 16 16" class="h-3 w-3 shrink-0 text-ink-4 transition-transform {openHosts.has(h) ? 'rotate-90' : ''}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
                        {h}
                      </button>
                      <span class="mt-0.5 inline-block"><SiteLabel site={h} /></span>
                    </td>
                    <td class="pii text-xs text-ink-3">{knownByHost.get(h)?.accounts.join(', ') || 'нет ни в одной консоли'}</td>
                    {#if stats[h]}
                      <td class="num app-num">{stats[h].impressions.toLocaleString('ru-RU')}</td>
                      <td class="num app-num">{stats[h].clicks.toLocaleString('ru-RU')}</td>
                      <td class="num app-num">{(stats[h].ctr * 100).toFixed(1)}%</td>
                      <td class="num app-num">{stats[h].position === null ? '—' : stats[h].position.toFixed(1)}</td>
                    {:else}
                      <td colspan="4" class="num text-xs text-ink-4">{statsLoading ? '…' : '—'}</td>
                    {/if}
                    <td class="num app-num font-semibold">{itemsByHost.get(h) ?? 0}</td>
                    <td>
                      {#if !group.fixedAt}
                        <form method="POST" action="?/naked" use:enhance={() => async ({ update }) => update({ reset: false })} class="flex items-center gap-1">
                          <input type="hidden" name="id" value={group.id} />
                          <input type="hidden" name="site" value={knownByHost.get(h)?.open.siteUrl ?? `https://${h}/`} />
                          <input name="page" value={`https://${h}/`} class="input h-7 w-56 text-xs" aria-label="Страница для безанкорных ссылок" required />
                          <input name="qty" type="number" min="1" max="1000" placeholder="шт" required class="input h-7 w-14 border-dashed px-1 text-right text-xs" aria-label="Сколько ссылок" />
                          <button class="btn btn-sec btn-sm" title="Добавить безанкорные ссылки на эту страницу">+ безанкор</button>
                        </form>
                      {/if}
                    </td>
                    <td class="text-right">
                      <span class="inline-flex items-center gap-1">
                        {#if openHref(h)}
                          <a class="btn btn-pri btn-sm" href={openHref(h)}>Открыть → Striking</a>
                        {/if}
                        {#if !group.fixedAt}
                          <form
                            method="POST"
                            action="?/removeHost"
                            use:enhance={({ cancel }) => {
                              const n = itemsByHost.get(h) ?? 0;
                              if (!confirm(`Убрать ${h} из группы «${group.name}»?${n ? ` Его ссылки в ТЗ (${n} шт) тоже уберутся.` : ''}`)) cancel();
                              return async ({ update }) => update({ reset: false });
                            }}
                          >
                            <input type="hidden" name="id" value={group.id} />
                            <input type="hidden" name="host" value={h} />
                            <button class="btn btn-ghost btn-sm text-bad" title="Убрать сайт из группы">×</button>
                          </form>
                        {/if}
                      </span>
                    </td>
                  </tr>
                  {#if openHosts.has(h)}
                    {@const list = itemsOfHost.get(h) ?? []}
                    <tr class="bg-sunk hover:bg-sunk">
                      <td></td>
                      <td colspan="9" class="py-2">
                        <div class="mb-1 text-xs font-semibold text-ink-2">Уже на покупку в этой группе</div>
                        {#if list.length === 0}
                          <p class="text-xs text-ink-3">Пока ничего. Выберите ключи ниже — впишите количество и нажмите +, или добавьте безанкорные справа.</p>
                        {:else}
                          <div class="mb-1 text-xs text-ink-3">{list.length} строк · {list.reduce((a, i) => a + i.qty, 0)} ссылок</div>
                          <table class="app-table rounded border border-line bg-pane">
                            <thead><tr><th>Ссылка</th><th>Анкор</th><th>Тип ключа</th><th>Страница</th><th class="num">Ссылок</th><th class="num">Pos</th><th class="num">Impr</th><th class="num">Clicks</th><th></th></tr></thead>
                            <tbody>
                              {#each list as it (it.id)}
                                <tr>
                                  <td class="text-xs text-ink-3">{it.kind === 'naked' ? NAKED_LABEL[nakedVariant(it.query)] : 'Анкор'}</td>
                                  <td class="pii font-medium">{it.kind === 'naked' ? nakedAnchor(it.page, it.query) : it.query}</td>
                                  <td>{#if it.kind !== 'naked'}<IntentBadge query={it.query} page={it.page} />{/if}</td>
                                  <td class="max-w-md"><a class="pii break-all text-ink-3 hover:text-acc hover:underline" href={it.page} target="_blank" rel="noopener noreferrer">{it.page}</a></td>
                                  <td class="num">
                                    {#if group.fixedAt}
                                      <span class="app-num">{it.qty}</span>
                                    {:else}
                                      <form method="POST" action="?/qty" use:enhance={() => async ({ update }) => update({ reset: false })}>
                                        <input type="hidden" name="id" value={group.id} />
                                        <input type="hidden" name="item" value={it.id} />
                                        <input name="qty" type="number" min="1" max="1000" value={it.qty} class="input h-7 w-16 px-1 text-right text-xs" aria-label="Сколько ссылок" onchange={(e) => e.currentTarget.form?.requestSubmit()} />
                                      </form>
                                    {/if}
                                  </td>
                                  <td class="num app-num">{it.position === null ? '—' : it.position.toFixed(1)}</td>
                                  <td class="num app-num">{fmt(it.impressions)}</td>
                                  <td class="num app-num">{fmt(it.clicks)}</td>
                                  <td class="text-right">
                                    {#if !group.fixedAt}
                                      <form method="POST" action="?/removeItem" use:enhance>
                                        <input type="hidden" name="id" value={group.id} />
                                        <input type="hidden" name="item" value={it.id} />
                                        <button class="btn btn-ghost btn-sm text-bad" title="Убрать из группы">×</button>
                                      </form>
                                    {/if}
                                  </td>
                                </tr>
                              {/each}
                            </tbody>
                          </table>
                        {/if}
                        {#if knownByHost.get(h)}
                          {@const k = knownByHost.get(h)!}
                          {#key page.data.period?.key}
                          <SiteKeysPanel
                            sources={k.sources}
                            days={page.data.period?.days ?? 28}
                            groupId={group.id}
                            fixed={!!group.fixedAt}
                            onadd={(r) => itemsPost({ action: 'add', groupId: group.id, item: { siteUrl: r.siteUrl, query: r.query, page: r.page, position: r.position, impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, qty: r.qty } })}
                          />
                          {/key}
                        {:else}
                          <p class="mt-2 text-xs text-ink-3">Этого сайта нет ни в одной подключённой консоли — статистики по ключам нет.</p>
                        {/if}
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <details class="border-b border-line" open={group.hosts.length === 0 || editorOpen} ontoggle={(e) => (editorOpen = e.currentTarget.open)}>
          <summary class="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-2">{group.hosts.length ? 'Изменить состав сайтов' : 'Добавьте сайты в группу'}</summary>

        <form method="POST" action="?/hosts" use:enhance={() => async ({ update }) => { await update({ reset: false }); lastKey = ''; }} class="p-3">
          <input type="hidden" name="id" value={group.id} />
          {#each [...picked] as h (h)}<input type="hidden" name="host" value={h} />{/each}

          <label class="mb-1 block text-xs font-medium text-ink-2" for="paste">Добавить списком (домены или адреса, по одному на строку)</label>
          <textarea
            id="paste"
            name="paste"
            bind:value={paste}
            rows="3"
            class="input mb-3 w-full py-1.5 font-mono text-xs"
            placeholder={'example.com\nhttps://www.other-site.ru/\nsc-domain:third.com'}
          ></textarea>

          <div class="mb-2 flex flex-wrap items-center gap-2">
            <input class="input h-7 w-56 text-xs" placeholder="Поиск по домену или консоли" bind:value={query} />
            <label class="flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" bind:checked={onlyPicked} /> только отмеченные</label>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => pickShown(true)}>Отметить показанные</button>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => pickShown(false)}>Снять показанные</button>
            <span class="ml-auto text-xs text-ink-3">в группе {picked.size}</span>
          </div>

          <div class="max-h-[28rem] overflow-y-auto rounded border border-line">
            <table class="app-table">
              <tbody>
                {#each shown as r (r.host)}
                  <tr class="cursor-pointer" onclick={() => toggle(r.host)}>
                    <td class="w-px"><input type="checkbox" checked={picked.has(r.host)} aria-label={r.host} onclick={(e) => e.stopPropagation()} onchange={() => toggle(r.host)} /></td>
                    <td class="pii break-all text-ink">{r.host}</td>
                    <td class="pii text-xs text-ink-3">{r.accounts.length ? r.accounts.join(', ') : 'нет ни в одной консоли'}</td>
                  </tr>
                {:else}
                  <tr><td class="text-xs text-ink-3">Ничего не найдено</td></tr>
                {/each}
              </tbody>
            </table>
          </div>

          {#if form && 'saved' in form && form.saved === group.id}
            <p class="mt-2 text-xs text-ink-3">
              Сохранено.{#if form.rejected?.length}&nbsp;Не похожи на домены и пропущены: {form.rejected.join(', ')}{/if}
            </p>
          {/if}
          <div class="mt-3 flex justify-end">
            <button class="btn btn-pri" disabled={!dirty}>Сохранить состав</button>
          </div>
        </form>
        </details>

        {#if data.overlaps.length}
          <div class="border-b border-line bg-warn-t/50 p-3">
            <div class="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-2">⚠ Пересечения · {data.overlaps.length}</div>
            <p class="mb-2 text-xs text-ink-3">Эти ключи отобраны сразу для нескольких ваших сайтов — они будут конкурировать. Обычно основную массу ссылок даёт один главный сайт, остальным минимум. Количество меняется в таблице ниже.</p>
            <ul class="space-y-1 text-xs">
              {#each data.overlaps as o (o.query)}
                <li class="flex flex-wrap items-center gap-1.5">
                  <span class="pii font-medium text-ink">{o.query}:</span>
                  {#each o.sites as st (st.host)}<span class="pii rounded bg-pane px-1.5 py-0.5 text-ink-2">{st.host} — <b>{st.qty}</b> шт</span>{/each}
                </li>
              {/each}
            </ul>
          </div>
        {/if}

        <div class="p-3">
          <div class="mb-2 flex flex-wrap items-center gap-2">
            <span class="text-xs font-semibold uppercase tracking-wide text-ink-3">ТЗ на ссылки · {data.items.length} строк · {data.items.reduce((a, i) => a + i.qty, 0)} ссылок</span>
            {#if !group.fixedAt && data.items.length}
              <form
                method="POST"
                action="?/removeItems"
                class="flex items-center gap-2"
                use:enhance={({ cancel }) => {
                  if (!tzPickedCount || !confirm(`Удалить из группы отмеченные строки: ${tzPickedCount}?`)) {
                    cancel();
                    return;
                  }
                  return async ({ result, update }) => {
                    if (result.type === 'success') tzPicked = new Set();
                    await update({ reset: false });
                  };
                }}
              >
                <input type="hidden" name="id" value={group.id} />
                {#each data.items.filter((i) => tzPicked.has(i.id)) as it (it.id)}<input type="hidden" name="item" value={it.id} />{/each}
                <button type="submit" class="btn btn-sm {tzPickedCount ? 'btn-danger' : 'btn-sec'}" disabled={!tzPickedCount} title={tzPickedCount ? 'Убрать отмеченные строки из группы' : 'Отметьте строки галочками'}>Удалить отмеченные{tzPickedCount ? ` (${tzPickedCount})` : ''}</button>
                {#if tzPickedCount}<button type="button" class="btn btn-ghost btn-sm" onclick={() => (tzPicked = new Set())}>Снять отметки</button>{/if}
              </form>
            {/if}
          </div>
          {#if data.items.length === 0}
            <p class="text-xs text-ink-3">Пока нет. Откройте сайт из списка выше и в Striking Distance нажимайте <b>+</b> у нужных ключей.</p>
          {:else}
            <div class="overflow-x-auto rounded border border-line">
              <table class="app-table">
                <thead><tr>{#if !group.fixedAt}<th class="w-8"><input type="checkbox" checked={tzAllPicked} aria-label="Отметить все строки ТЗ" onchange={() => (tzPicked = tzAllPicked ? new Set() : new Set(data.items.map((i) => i.id)))} /></th>{/if}<th class="cursor-pointer select-none hover:text-ink" onclick={() => sortTz('site')}>Сайт<SortCaret dir={tzSort === 'site' ? (tzDir === 1 ? 'asc' : 'desc') : ''} /></th><th class="cursor-pointer select-none hover:text-ink" onclick={() => sortTz('kind')}>Тип<SortCaret dir={tzSort === 'kind' ? (tzDir === 1 ? 'asc' : 'desc') : ''} /></th><th class="cursor-pointer select-none hover:text-ink" onclick={() => sortTz('page')}>Страница<SortCaret dir={tzSort === 'page' ? (tzDir === 1 ? 'asc' : 'desc') : ''} /></th><th class="cursor-pointer select-none hover:text-ink" onclick={() => sortTz('query')}>Анкор<SortCaret dir={tzSort === 'query' ? (tzDir === 1 ? 'asc' : 'desc') : ''} /></th><th class="num cursor-pointer select-none hover:text-ink" onclick={() => sortTz('qty')}>Ссылок<SortCaret dir={tzSort === 'qty' ? (tzDir === 1 ? 'asc' : 'desc') : ''} /></th><th class="num cursor-pointer select-none hover:text-ink" onclick={() => sortTz('position')}>Pos<SortCaret dir={tzSort === 'position' ? (tzDir === 1 ? 'asc' : 'desc') : ''} /></th><th class="num cursor-pointer select-none hover:text-ink" onclick={() => sortTz('impressions')}>Impr<SortCaret dir={tzSort === 'impressions' ? (tzDir === 1 ? 'asc' : 'desc') : ''} /></th><th class="num cursor-pointer select-none hover:text-ink" onclick={() => sortTz('clicks')}>Clicks<SortCaret dir={tzSort === 'clicks' ? (tzDir === 1 ? 'asc' : 'desc') : ''} /></th><th title="Сколько ссылок на этот ключ взято для других ваших сайтов; ⚠ — другой сайт стоит выше">Другие сайты</th><th title="Язык страницы — как указан на сайте. Названия — как на бирже ссылок">Язык</th><th title="Страна: из «Карты ключей FUT», иначе по зоне домена, иначе Global. Названия — как на бирже ссылок">Гео</th><th></th></tr></thead>
                <tbody>
                  {#each tzItems as it (it.id)}
                    {@const blk = tzBlocks.get(it.id)}
                    {#if blk?.label}
                      <tr class="tz-label"><td colspan={group.fixedAt ? 12 : 13}>{blk.label} <span class="font-normal text-ink-3">· {blk.labelQty} ссыл.</span></td></tr>
                    {/if}
                    {#if blk}
                      {@const gk = data.geoKeys[labelOf(it.siteUrl) ?? '']?.[blk.geo] ?? []}
                      <tr class="tz-geo"><td colspan={group.fixedAt ? 12 : 13}>{blk.label ?? labelOf(it.siteUrl) ?? 'без метки'} · {blk.geo} <span class="text-ink-3">· {blk.geoQty} ссыл.</span>{#if gk.length}<span class="tz-geo-keys" title="Ключи под эту страну — из «Карты ключей FUT»; уходят в CSV колонкой «Ключи гео»"> · ключи гео: <span class="pii">{gk.join(', ')}</span></span>{/if}</td></tr>
                    {/if}
                    <tr class:is-selected={tzPicked.has(it.id)}>
                      {#if !group.fixedAt}<td><input type="checkbox" checked={tzPicked.has(it.id)} aria-label="Отметить строку" onchange={() => tzPick(it.id)} /></td>{/if}
                      <td class="whitespace-nowrap text-ink-2"><span class="inline-flex items-center gap-1"><span class="pii">{siteHostname(it.siteUrl)}</span><SiteLabel site={it.siteUrl} /></span></td>
                      <td class="text-xs text-ink-3">{it.kind === 'naked' ? NAKED_LABEL[nakedVariant(it.query)] : 'Анкор'}</td>
                      <td class="max-w-md"><a class="pii break-all text-ink-3 hover:text-acc hover:underline" href={it.page} target="_blank" rel="noopener noreferrer">{it.page}</a></td>
                      <td class="font-medium"><span class="pii">{it.kind === 'naked' ? nakedAnchor(it.page, it.query) : it.query}</span></td>
                      <td class="num">
                        {#if group.fixedAt}
                          <span class="app-num">{it.qty}</span>
                        {:else}
                          <form method="POST" action="?/qty" use:enhance={() => async ({ update }) => update({ reset: false })}>
                            <input type="hidden" name="id" value={group.id} />
                            <input type="hidden" name="item" value={it.id} />
                            <input name="qty" type="number" min="1" max="1000" value={it.qty} class="input h-7 w-16 px-1 text-right text-xs" aria-label="Сколько ссылок" onchange={(e) => e.currentTarget.form?.requestSubmit()} />
                          </form>
                        {/if}
                      </td>
                      <td class="num app-num">{it.position === null ? '—' : it.position.toFixed(1)}</td>
                      <td class="num app-num">{fmt(it.impressions)}</td>
                      <td class="num app-num">{fmt(it.clicks)}</td>
                      <td>
                        {#if it.kind === 'anchor'}
                          {@const o = others[`${it.siteUrl}\n${it.query}`]}
                          <OtherSitesInline owners={o?.owners ?? []} links={o?.links ?? []} position={it.position} loading={othersLoading} query={it.query} currentGroupId={group.id} editable={!group.fixedAt} onremove={removeOther} onqty={qtyOther} onadd={addOther} />
                        {/if}
                      </td>
                      <td class="whitespace-nowrap text-xs text-ink-2">{tzLocale[it.page]?.language ?? (tzLocale[it.page] ? '—' : '…')}</td>
                      <td class="whitespace-nowrap text-xs text-ink-2">{tzLocale[it.page]?.geo ?? '…'}</td>
                      <td class="text-right">
                        {#if !group.fixedAt}
                          <form method="POST" action="?/removeItem" use:enhance>
                            <input type="hidden" name="id" value={group.id} />
                            <input type="hidden" name="item" value={it.id} />
                            <button class="btn btn-ghost btn-sm text-bad" title="Убрать ключ из группы">×</button>
                          </form>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </section>
    {:else}
      <div class="app-empty">
        <div class="app-empty-title">Создайте первую группу</div>
        <p class="app-empty-sub">Например «Приоритет» — сайты, которые сейчас продвигаете.</p>
      </div>
    {/if}
  </div>
</main>

<style>
  .tz-label > td {
    padding-top: 0.6rem;
    font-weight: 600;
    color: rgb(var(--ink));
    background: rgb(var(--acc) / 0.1);
    box-shadow: inset 0 -2px 0 rgb(var(--acc) / 0.5);
  }
  .tz-geo > td {
    font-size: 11.5px;
    font-weight: 500;
    color: rgb(var(--ink-2));
    background: rgb(var(--sunk));
    white-space: normal;
  }
  .tz-geo-keys {
    font-weight: 400;
    color: rgb(var(--ink-2));
  }
</style>
