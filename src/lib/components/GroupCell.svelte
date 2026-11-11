<script lang="ts">
  // Ячейка «В группу»: пустое поле количества и кнопка +.
  // Пока число не вписано, + неактивна: заготовку не спутать с уже взятым.
  // Если ключ уже в группе — в поле его количество, изменение сразу сохраняется, ✓ убирает.
  import { gi, inActive, toggleItem, activeGroup, itemKey, qtyInActive, setQty, type ItemRow } from '$lib/group-items.svelte';
  let { row }: { row: ItemRow } = $props();
  const on = $derived(inActive(row.page, row.query));
  const busy = $derived(gi.busy.has(itemKey(row.page, row.query)));
  const g = $derived(activeGroup());
  const saved = $derived(qtyInActive(row.page, row.query));
  let draft = $state<number | null>(null);

  const clamp = (n: number) => Math.max(1, Math.min(1000, Math.round(n) || 1));
  function onInput(v: string) {
    if (on) {
      if (v.trim() !== '') setQty(row, clamp(Number(v)));
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
    aria-label="Количество ссылок"
    title={on ? 'Сколько ссылок с этим анкором на эту страницу в группе' : 'Впишите, сколько ссылок с этим анкором на эту страницу, и нажмите +'}
    onchange={(e) => onInput(e.currentTarget.value)}
    oninput={(e) => { if (!on) onInput(e.currentTarget.value); }}
  />
  <button
    type="button"
    class="btn btn-sm {on ? 'bg-acc text-white hover:bg-acc-deep' : 'btn-sec'}"
    disabled={busy || !!g?.fixedAt || (!on && draft === null)}
    title={!g ? 'Сначала выберите группу над таблицей' : on ? `Убрать из ${g.name}` : draft === null ? 'Сначала впишите количество' : `Добавить ${draft} шт в ${g.name}`}
    aria-pressed={on}
    onclick={() => { if (on || draft !== null) toggleItem({ ...row, qty: draft ?? 1 }); if (!on) draft = null; }}
  >{on ? `✓ ${g?.name}` : '+'}</button>
</div>
