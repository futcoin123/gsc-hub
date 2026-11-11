<script lang="ts">
  // «Закупки»: что изменилось после закупки ссылок — по сайту и по каждому
  // купленному ключу. До — 7 дней перед датой закупки; после — со следующего
  // дня по последний полный день Google (до 28 дней).
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { NAKED_LABEL } from '$lib/utils/naked';

  let { data } = $props();

  type M = { clicks: number; impressions: number; position: number | null };
  type Item = { id: number; kind: 'anchor' | 'naked'; text: string; variant: 'url' | 'domain' | null; query: string; page: string; qty: number; before: M; after: M | null };
  type Site = { siteUrl: string; links: number; before: M; after: M | null; items: Item[]; error: string | null };
  type Win = { start: string; end: string; days: number };
  type Effect = { groupId: number; name: string; date: string; before: Win; after: Win | null; sites: Site[] };

  let open = $state<Set<number>>(new Set());
  let effects = $state<Record<number, { loading: boolean; data: Effect | null; err: string | null }>>({});

  async function load(id: number) {
    if (effects[id]?.data || effects[id]?.loading) return;
    effects[id] = { loading: true, data: null, err: null };
    try {
      const r = await fetch(`/purchases/effect?g=${id}`);
      if (!r.ok) throw new Error((await r.text()).slice(0, 200) || `HTTP ${r.status}`);
      effects[id] = { loading: false, data: await r.json(), err: null };
    } catch (e) {
      effects[id] = { loading: false, data: null, err: (e as Error).message };
    }
  }
  function toggle(id: number) {
    const n = new Set(open);
    if (n.has(id)) n.delete(id);
    else {
      n.add(id);
      load(id);
    }
    open = n;
  }
  onMount(() => {
    // Ссылка вида /purchases?g=5 открывает эту закупку; иначе — самую новую.
    const g = Number(page.url.searchParams.get('g')) || data.purchases[0]?.groupId;
    if (g) toggle(g);
  });

  const fd = (iso: string) => iso.split('-').reverse().join('.');
  const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  const perDay = (n: number, days: number) => (days ? n / days : 0);
  const pos = (p: number | null) => (p === null ? '—' : p.toFixed(1));
  /** Позиция: меньше — лучше. Положительное — поднялся. */
  const posDelta = (b: number | null, a: number | null) => (b === null || a === null ? null : Math.round((b - a) * 10) / 10);
  const pct = (b: number, a: number) => (b ? Math.round(((a - b) / b) * 100) : a ? null : 0);
</script>

<svelte:head><title>Закупки · GSC Hub</title></svelte:head>

{#snippet posCell(b: number | null, a: number | null | undefined, hasAfter: boolean)}
  {@const d = hasAfter ? posDelta(b, a ?? null) : null}
  <td class="num app-num whitespace-nowrap">
    {pos(b)} → {hasAfter ? pos(a ?? null) : '…'}
    {#if d !== null && d !== 0}<span class="pii chip ml-1 {d > 0 ? 'chip-up' : 'chip-dn'}" title={d > 0 ? `Поднялся на ${d}` : `Опустился на ${Math.abs(d)}`}>{d > 0 ? '▲' : '▼'}{Math.abs(d)}</span>{/if}
  </td>
{/snippet}

{#snippet volCell(b: number, a: number | undefined, bd: number, ad: number | undefined, hasAfter: boolean)}
  {@const bp = perDay(b, bd)}
  {@const ap = hasAfter ? perDay(a ?? 0, ad ?? 0) : 0}
  {@const d = hasAfter ? pct(bp, ap) : null}
  <td class="num app-num whitespace-nowrap" title="В среднем за день: до {fmt(bp)}, после {hasAfter ? fmt(ap) : '—'}">
    {fmt(bp)} → {hasAfter ? fmt(ap) : '…'}
    {#if d !== null && d !== 0}<span class="pii chip ml-1 {d > 0 ? 'chip-up' : 'chip-dn'}">{d > 0 ? '+' : '−'}{Math.abs(d)}%</span>{:else if hasAfter && d === null}<span class="pii chip chip-up ml-1">новое</span>{/if}
  </td>
{/snippet}

<div class="desk">
  <section class="pane">
    <div class="border-b border-line px-3 py-2">
      <h1 class="text-base font-semibold">Закупки ссылок — что изменилось после</h1>
      <p class="mt-1 text-xs text-ink-2">
        По каждой закупке из «Групп»: сайт целиком и каждая купленная ссылка — анкор считается на той странице, куда ведёт ссылка (не по всему сайту: один анкор бывает на страницах разных стран), безанкорная — вся страница.
        <b>До</b> — 7 дней перед датой закупки, <b>после</b> — со следующего дня по последний полный день Google (до 28 дней).
        Показы и клики — в среднем за день, позиция — средняя (▲ — поднялся). Дата закупки — когда группу зафиксировали, иначе дата в её названии.
        Эти же закупки отмечены фиолетовой линией на графиках Dashboard, страницы сайта и «Ключей сайтов».
      </p>
    </div>

    {#if data.purchases.length === 0}
      <p class="p-3 text-ink-3">Закупок пока нет. Они появятся, когда в группе будут ключи или безанкорные ссылки (страница <a class="text-acc underline" href="/groups">Группы</a>).</p>
    {:else}
      {#each data.purchases as p (p.groupId)}
        {@const ef = effects[p.groupId]}
        <div class="border-b border-line">
          <button type="button" class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-sunk" aria-expanded={open.has(p.groupId)} onclick={() => toggle(p.groupId)}>
            <svg viewBox="0 0 16 16" class="h-3 w-3 shrink-0 text-ink-3 transition-transform {open.has(p.groupId) ? 'rotate-90' : ''}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
            <span class="font-semibold text-ink">{fd(p.date)}</span>
            <span class="text-ink-2">группа «{p.name}»</span>
            <span class="text-xs text-ink-2">{p.sites.length} сайт. · {p.links} ссыл.</span>
            {#if !p.fixed}<span class="badge badge-warn" title="Группа не зафиксирована: дата взята из её названия">не зафиксирована</span>{/if}
            <span class="pii min-w-0 flex-1 truncate text-xs text-ink-3">{p.sites.map((s) => s.host).join(', ')}</span>
            <a class="btn btn-ghost btn-sm" href="/groups?g={p.groupId}" onclick={(e) => e.stopPropagation()}>Открыть группу</a>
          </button>

          {#if open.has(p.groupId)}
            <div class="px-3 pb-3">
              {#if !ef || ef.loading}
                <p class="loading text-xs">Считаю до и после…</p>
              {:else if ef.err}
                <p class="text-xs text-bad">Не посчиталось: {ef.err}</p>
              {:else if ef.data}
                {@const e = ef.data}
                <p class="mb-2 text-xs text-ink-2">
                  До: {fd(e.before.start)} – {fd(e.before.end)} ({e.before.days} дн.) ·
                  {#if e.after}после: {fd(e.after.start)} – {fd(e.after.end)} ({e.after.days} дн.){:else}<b class="text-warn">после — ещё рано:</b> Google пока не отдал ни одного полного дня после {fd(e.date)}; цифры появятся завтра{/if}
                </p>
                <div class="overflow-x-auto rounded border border-line">
                  <table class="app-table is-roomy">
                    <thead>
                      <tr>
                        <th>Сайт / ключ</th>
                        <th>Что купили</th>
                        <th class="num">Ссылок</th>
                        <th class="num" title="Средняя позиция до → после; ▲ — поднялся">Позиция</th>
                        <th class="num" title="Показы в день: до → после">Показы в день</th>
                        <th class="num" title="Клики в день: до → после">Клики в день</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each e.sites as s (s.siteUrl)}
                        {@const host = p.sites.find((x) => x.siteUrl === s.siteUrl)?.host ?? s.siteUrl}
                        <tr class="is-total">
                          <td class="pii whitespace-nowrap text-acc">{host}</td>
                          <td class="text-xs font-normal text-ink-2">весь сайт</td>
                          <td class="num app-num">{s.links}</td>
                          {#if s.error}
                            <td colspan="3" class="text-xs text-bad">{s.error}</td>
                          {:else}
                            {@render posCell(s.before.position, s.after?.position, !!e.after)}
                            {@render volCell(s.before.impressions, s.after?.impressions, e.before.days, e.after?.days, !!e.after)}
                            {@render volCell(s.before.clicks, s.after?.clicks, e.before.days, e.after?.days, !!e.after)}
                          {/if}
                        </tr>
                        {#each s.items as it (it.id)}
                          <tr>
                            <td class="pii pl-6 font-medium"><a class="hover:text-acc hover:underline" href={it.page} target="_blank" rel="noopener noreferrer" title="Страница: {it.page}">{it.text}</a></td>
                            <td class="text-xs text-ink-2">{it.kind === 'naked' ? NAKED_LABEL[it.variant ?? 'url'] : 'Анкор'}</td>
                            <td class="num app-num">{it.qty}</td>
                            {#if !s.error}
                              {@render posCell(it.before.position, it.after?.position, !!e.after)}
                              {@render volCell(it.before.impressions, it.after?.impressions, e.before.days, e.after?.days, !!e.after)}
                              {@render volCell(it.before.clicks, it.after?.clicks, e.before.days, e.after?.days, !!e.after)}
                            {:else}
                              <td colspan="3"></td>
                            {/if}
                          </tr>
                        {/each}
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </section>
</div>
