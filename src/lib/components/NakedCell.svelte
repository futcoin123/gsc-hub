<script lang="ts">
  // «В группу» для безанкорной ссылки — как у ключа: впишите количество и +;
  // если ссылка уже в группе — в поле её количество, ✓ убирает.
  import { gi, inActive, activeGroup, itemKey, qtyInActive, setQty, toggleNaked } from '$lib/group-items.svelte';
  import { nakedQuery, type NakedVariant } from '$lib/utils/naked';
  let { siteUrl, page, variant }: { siteUrl: string; page: string; variant: NakedVariant } = $props();
  const query = $derived(nakedQuery(variant));
  const on = $derived(inActive(page, query));
  const busy = $derived(gi.busy.has(itemKey(page, query)));
  const g = $derived(activeGroup());
  const saved = $derived(qtyInActive(page, query));
  let draft = $state<number | null>(null);

  const clamp = (n: number) => Math.max(1, Math.min(1000, Math.round(n) || 1));
  function onInput(v: string) {
    if (on) {
      if (v.trim() !== '') setQty({ siteUrl, page, query }, clamp(Number(v)));
    } else draft = v.trim() === '' ? null : clamp(Number(v));
  }
</script>

<div class="flex items-center justify-end gap-1 whitespace-nowrap">
  <input
    type="number"
    min="1"
    max="1000"
    placeholder="шт"
    class="input h-7 w-14 px-1 text-right text-xs {on ? 'border-acc' : 'border-dashed'}"
    value={on ? saved : (draft ?? '')}
    disabled={!!g?.fixedAt}
    aria-label="Количество безанкорных ссылок"
    title={on ? 'Сколько безанкорных ссылок на эту страницу в группе' : 'Впишите, сколько ссылок, и нажмите +'}
    onchange={(e) => onInput(e.currentTarget.value)}
    oninput={(e) => { if (!on) onInput(e.currentTarget.value); }}
  />
  <button
    type="button"
    class="btn btn-sm {on ? 'bg-acc text-white hover:bg-acc-deep' : 'btn-sec'}"
    disabled={busy || !!g?.fixedAt || (!on && draft === null)}
    title={!g ? 'Сначала выберите группу над таблицей' : on ? `Убрать из ${g.name}` : draft === null ? 'Сначала впишите количество' : `Добавить ${draft} шт в ${g.name}`}
    aria-pressed={on}
    onclick={() => { if (on || draft !== null) toggleNaked(siteUrl, page, query, variant, draft ?? 1); if (!on) draft = null; }}
  >{on ? `✓ ${g?.name}` : '+'}</button>
</div>
