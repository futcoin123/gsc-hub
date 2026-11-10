<script lang="ts">
  // Период в шапке — один на все отчёты панели (свой у каждого пользователя).
  import { invalidateAll } from '$app/navigation';
  type P = { key: string; startDate: string; endDate: string; days: number };
  let { period }: { period: P | null } = $props();

  const PRESETS: [string, string][] = [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['7', '7 дней'], ['28', '28 дней'], ['90', '3 месяца'], ['180', '6 месяцев'], ['480', '16 месяцев']];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let open = $state(false);
  let busy = $state(false);
  let from = $state('');
  let to = $state('');
  $effect(() => {
    if (period) {
      from = period.startDate;
      to = period.endDate;
    }
  });
  const fd = (iso: string) => iso.split('-').reverse().join('.');
  // Быстрые кнопки прямо в шапке; остальные периоды и свои даты — в меню.
  const QUICK: [string, string][] = [['today', 'Сегодня'], ['yesterday', 'Вчера'], ['7', '7 дней']];
  const quick = $derived(!!period && QUICK.some(([k]) => k === period.key));
  const label = $derived(
    !period ? '…' : PRESETS.find(([k]) => k === period.key)?.[1] ?? `${fd(period.startDate)} – ${fd(period.endDate)}`
  );
  async function choose(p: string) {
    busy = true;
    try {
      const r = await fetch('/period', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p }) });
      if (r.ok) {
        open = false;
        await invalidateAll();
      }
    } finally {
      busy = false;
    }
  }
  function applyDates() {
    if (!from || !to) return;
    const [a, b] = from <= to ? [from, to] : [to, from];
    choose(`${a}_${b}`);
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') open = false; }} />

<div class="relative flex items-center gap-1">
  <div class="app-segmented rounded border border-line p-px max-sm:hidden" role="group" aria-label="Быстрый выбор периода">
    {#each QUICK as [k, l] (k)}
      <button
        type="button"
        class:is-active={period?.key === k}
        aria-pressed={period?.key === k}
        disabled={busy}
        title={period?.key === k ? `Период всех отчётов: ${fd(period.startDate)} – ${fd(period.endDate)}` : `Показать все отчёты за период «${l}»`}
        onclick={() => choose(k)}
      >{l}</button>
    {/each}
  </div>
  <button
    type="button"
    class="btn btn-sm {quick ? 'btn-ghost max-sm:bg-acc-t max-sm:text-acc' : 'bg-acc-t text-acc hover:brightness-95'}"
    aria-expanded={open}
    title={period ? `Период всех отчётов: ${fd(period.startDate)} – ${fd(period.endDate)}. Другие периоды и свои даты — здесь` : 'Период отчётов'}
    onclick={() => (open = !open)}
  >{#if quick}<span class="max-sm:hidden">Другой…</span><span class="sm:hidden">Период: <b>{label}</b></span>{:else}Период: <b>{label}</b>{/if}</button>
  {#if open}
    <button type="button" class="fixed inset-0 z-40 cursor-default" aria-label="Закрыть" onclick={() => (open = false)}></button>
    <div class="absolute right-0 top-full z-50 mt-1 w-72 rounded border border-line bg-pane p-2 text-xs shadow-[0_6px_20px_-6px_rgb(19_23_34/0.25)]">
      <div class="mb-1 text-ink-3">Период для всех отчётов</div>
      <div class="grid grid-cols-2 gap-1">
        {#each PRESETS as [k, l] (k)}
          <button type="button" class="btn btn-sm justify-start {period?.key === k ? 'bg-acc text-white' : 'btn-ghost'}" disabled={busy} onclick={() => choose(k)}>{l}</button>
        {/each}
      </div>
      <div class="mt-2 border-t border-line pt-2">
        <div class="mb-1 text-ink-3">Свои даты</div>
        <div class="flex items-end gap-1">
          <label class="flex flex-1 flex-col gap-0.5 text-ink-3">с <input class="input h-7 w-full text-xs" type="date" max={today} bind:value={from} /></label>
          <label class="flex flex-1 flex-col gap-0.5 text-ink-3">по <input class="input h-7 w-full text-xs" type="date" max={today} bind:value={to} /></label>
        </div>
        <button type="button" class="btn btn-pri btn-sm mt-2 w-full" disabled={busy || !from || !to} onclick={applyDates}>Показать эти даты</button>
      </div>
      {#if period}<div class="mt-2 text-ink-3">Сейчас: {fd(period.startDate)} – {fd(period.endDate)}</div>{/if}
    </div>
  {/if}
</div>
