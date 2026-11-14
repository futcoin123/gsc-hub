<script lang="ts">
  // «Другие сайты»: по строке на каждый другой ваш сайт по этому ключу.
  //  — ⚠ красным, если тот сайт стоит выше;
  //  — сколько ссылок на ключ уже взято для него (и в каких группах);
  //  — на странице группы (currentGroupId + обработчики): поле количества,
  //    «+» — добавить ключ для того сайта в эту группу, «×» — убрать.
  import type { OtherOwner, OtherLink } from '$lib/group-items.svelte';
  let {
    owners = [],
    links = [],
    position = null,
    loading = false,
    query = '',
    currentGroupId = null,
    editable = false,
    onremove,
    onqty,
    onadd
  }: {
    owners?: OtherOwner[];
    links?: OtherLink[];
    position?: number | null;
    loading?: boolean;
    query?: string;
    currentGroupId?: number | null;
    /** Группа не зафиксирована — можно менять. */
    editable?: boolean;
    onremove?: (l: OtherLink) => void;
    onqty?: (l: OtherLink, qty: number) => void;
    onadd?: (o: OtherOwner, query: string, qty: number) => void;
  } = $props();

  type Row = { host: string; qty: number; groups: string[]; owner: OtherOwner | null; items: OtherLink[] };
  const rows = $derived.by(() => {
    const m = new Map<string, Row>();
    for (const l of links) {
      const e = m.get(l.host) ?? { host: l.host, qty: 0, groups: [], owner: null, items: [] };
      e.qty += l.qty;
      e.items.push(l);
      if (!e.groups.includes(l.groupName)) e.groups.push(l.groupName);
      m.set(l.host, e);
    }
    for (const o of owners) {
      const e = m.get(o.host) ?? { host: o.host, qty: 0, groups: [], owner: null, items: [] };
      e.owner = o;
      m.set(o.host, e);
    }
    // Показываем сайты, где уже взяты ссылки, и те, что стоят выше.
    return [...m.values()]
      .filter((e) => e.qty > 0 || higher(e.owner?.position ?? null))
      .sort((a, b) => Number(higher(b.owner?.position ?? null)) - Number(higher(a.owner?.position ?? null)) || b.qty - a.qty || (a.owner?.position ?? 999) - (b.owner?.position ?? 999));
  });
  function higher(pos: number | null) {
    return pos !== null && position !== null && pos < position;
  }
  const SHOW = 6;
  // Откуда цифра: Search Console того сайта, этот же запрос, последние 28 дней
  // (не период в шапке), страница с наибольшими показами. Ключа в текстах той
  // страницы может и не быть: Google показывает сайт и по совпадению с адресом
  // (futcoin.es по запросу «fut coin»).
  const ownerTitle = (host: string, o: OtherOwner) =>
    `По данным Search Console сайта ${host} за последние 28 дней (не за период в шапке): запрос «${query}» — ` +
    `${o.page ? `страница ${o.page}, ` : ''}средняя позиция ${o.position.toFixed(1)}, показов ${o.impressions}, кликов ${o.clicks}. ` +
    `Слов запроса может не быть в текстах страницы: Google ставит сайт и по совпадению с адресом сайта. Нажмите на сайт — откроется эта страница.`;
  let drafts = $state<Record<string, number>>({});
  // Пустое поле, пока не вписали число: заготовку не спутать с уже добавленным.
  const draft = (host: string): number | null => drafts[host] ?? null;
  const clamp = (n: number) => Math.max(1, Math.min(1000, Math.round(n) || 1));
</script>

{#if rows.length === 0}
  {#if loading}<span class="text-[11px] text-ink-4">…</span>{:else}<span class="text-ink-4">—</span>{/if}
{:else}
  <div class="space-y-1 text-[11px] leading-tight">
    {#each rows.slice(0, SHOW) as r (r.host)}
      {@const mine = r.items.find((l) => l.groupId === currentGroupId)}
      {@const elsewhere = r.items.filter((l) => l.groupId !== currentGroupId)}
      <div class="flex flex-wrap items-center gap-x-1 gap-y-0.5 {higher(r.owner?.position ?? null) ? 'text-bad' : 'text-ink-2'}">
        <span class="whitespace-nowrap {higher(r.owner?.position ?? null) ? 'font-semibold' : ''}" title={r.owner ? ownerTitle(r.host, r.owner) : undefined}>
          {higher(r.owner?.position ?? null) ? '⚠ ' : ''}{#if r.owner?.page}<a class="pii hover:underline" href={r.owner.page} target="_blank" rel="noopener noreferrer">{r.host}</a>{:else}<span class="pii">{r.host}</span>{/if}
          {#if higher(r.owner?.position ?? null)}· выше: поз. {r.owner!.position.toFixed(1)}{:else if r.owner}<span class="text-ink-3">· поз. {r.owner.position.toFixed(1)}</span>{/if}{#if r.owner}<span class="font-normal text-ink-3"> · {r.owner.impressions} показ. за 28 дн.</span>{/if}
        </span>
        {#each elsewhere as l (l.itemId ?? l.groupId)}
          <span class="whitespace-nowrap font-normal text-ink-2">— <b>{l.qty} шт</b> <span class="text-ink-3">({l.groupName})</span>
            {#if onremove && l.itemId && !l.fixed}<button type="button" class="rounded px-1 text-ink-3 hover:bg-bad/10 hover:text-bad" title="Убрать у {r.host} из группы {l.groupName}" onclick={() => onremove(l)}>×</button>{/if}
          </span>
        {/each}
        {#if mine}
          <span class="flex items-center gap-0.5 rounded bg-acc-t px-1 font-normal text-ink-2" title="Уже в ТЗ этой группы">
            ✓ в этой группе:
            {#if editable && onqty}
              <input type="number" min="1" max="1000" value={mine.qty} class="input h-6 w-12 px-1 text-right text-[11px]" aria-label="Ссылок для {r.host}" onchange={(e) => onqty(mine, clamp(Number(e.currentTarget.value)))} />шт
            {:else}<b>{mine.qty} шт</b>{/if}
            {#if editable && onremove && mine.itemId}<button type="button" class="rounded px-1 text-ink-3 hover:bg-bad/10 hover:text-bad" title="Убрать у {r.host} из этой группы" onclick={() => onremove(mine)}>×</button>{/if}
          </span>
        {:else if editable && onadd && r.owner?.page && r.owner.siteUrl}
          <span class="flex items-center gap-0.5 font-normal text-ink-3" title="Ещё не добавлено. Впишите, сколько ссылок, и нажмите + — ключ добавится для {r.host} в эту группу">
            <input
              type="number"
              min="1"
              max="1000"
              placeholder="шт"
              value={draft(r.host) ?? ''}
              class="input h-6 w-12 border-dashed px-1 text-right text-[11px]"
              aria-label="Сколько ссылок для {r.host}"
              oninput={(e) => {
                const v = e.currentTarget.value.trim();
                const next = { ...drafts };
                if (v === '') delete next[r.host];
                else next[r.host] = clamp(Number(v));
                drafts = next;
              }}
            />
            <button
              type="button"
              class="btn btn-sec h-6 px-1.5 text-[11px]"
              disabled={draft(r.host) === null}
              title={draft(r.host) === null ? 'Сначала впишите количество' : `Добавить ${draft(r.host)} шт для ${r.host} в эту группу (${r.owner.page})`}
              onclick={() => { const q = draft(r.host); if (q !== null) onadd(r.owner!, query, q); }}
            >+</button>
          </span>
        {/if}
      </div>
    {/each}
    {#if rows.length > SHOW}
      <div class="text-ink-3" title={rows.slice(SHOW).map((r) => r.host).join(', ')}>и ещё {rows.length - SHOW}</div>
    {/if}
  </div>
{/if}
