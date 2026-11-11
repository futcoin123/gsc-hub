<script lang="ts">
  // «Последняя закупка»: когда в последний раз брали ссылки на эту страницу
  // сайта (любым анкором, кроме выбранной сейчас группы), сколько и как давно.
  // По странице, а не по ключу: один анкор бывает на страницах разных стран.
  // Клик — вся история.
  import { pageGroups } from '$lib/group-items.svelte';
  let { page, query: _query }: { page: string; query?: string } = $props();
  const list = $derived(pageGroups(page));
  const what = (o: { anchors: string[] }) => [...new Set(o.anchors)].join(', ');
  const last = $derived(list[list.length - 1] ?? null);
  const ago = (at: number) => {
    const d = Math.floor((Date.now() - at) / 864e5);
    return d <= 0 ? 'сегодня' : `${d} дн. назад`;
  };
</script>

{#if !last}
  <span class="text-ink-4">—</span>
{:else if list.length === 1}
  <a class="whitespace-nowrap text-[12px] hover:underline" href="/groups?g={last.groupId}" title="Ссылки на эту страницу брали в группе {last.name}: {what(last)}">
    <span class="font-medium text-ink">{last.name}</span> <span class="text-ink-3">· {last.qty} шт · {ago(last.at)}</span>
  </a>
{:else}
  <details class="relative text-[12px]">
    <summary class="cursor-pointer list-none whitespace-nowrap hover:underline" title="Ссылки на эту страницу брали {list.length} раз">
      <span class="font-medium text-ink">{last.name}</span> <span class="text-ink-3">· {last.qty} шт · {ago(last.at)}</span>
      <span class="ml-1 rounded bg-sunk px-1 text-[10px] text-ink-2">ещё {list.length - 1}</span>
    </summary>
    <ul class="absolute right-0 z-20 mt-1 min-w-[14rem] rounded border border-line bg-pane p-1 text-left shadow-lg">
      {#each [...list].reverse() as o (o.groupId)}
        <li><a class="block whitespace-nowrap rounded px-2 py-0.5 hover:bg-sunk" href="/groups?g={o.groupId}" title={what(o)}>{o.name} · {o.qty} шт · {ago(o.at)}</a></li>
      {/each}
    </ul>
  </details>
{/if}
