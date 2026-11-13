<script lang="ts">
  // Метка сайта (проект, например «futcoin»): значок у названия сайта. Клик —
  // поменять; пустое поле — снять метку. Одна метка на домен, видна везде сразу.
  import { labelOf, knownLabels, saveLabel } from '$lib/site-labels.svelte';
  let { site }: { site: string } = $props();
  const label = $derived(labelOf(site));
  let editing = $state(false);
  let value = $state('');
  let busy = $state(false);
  const listId = `site-labels-${Math.random().toString(36).slice(2, 8)}`;

  function start(e: Event) {
    e.stopPropagation();
    value = label ?? '';
    editing = true;
  }
  async function save() {
    if (!editing || busy) return;
    const v = value.trim();
    if (v === (label ?? '')) {
      editing = false;
      return;
    }
    busy = true;
    await saveLabel(site, v);
    busy = false;
    editing = false;
  }
  function focus(el: HTMLInputElement) {
    el.focus();
    el.select();
  }
</script>

{#if editing}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <span class="inline-flex items-center" onclick={(e) => e.stopPropagation()}>
    <input
      use:focus
      class="input h-6 w-28 px-1.5 text-xs font-normal"
      list={listId}
      maxlength="40"
      placeholder="метка"
      aria-label="Метка сайта"
      disabled={busy}
      bind:value
      onkeydown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') editing = false;
      }}
      onblur={save}
    />
    <datalist id={listId}>{#each knownLabels() as l (l)}<option value={l}></option>{/each}</datalist>
  </span>
{:else if label}
  <button type="button" class="site-label" title="Метка сайта — к какому проекту он относится. Нажмите, чтобы поменять" onclick={start}>{label}</button>
{:else}
  <button type="button" class="site-label is-empty" title="У сайта нет метки — нажмите, чтобы поставить" onclick={start}>+ метка</button>
{/if}

<style>
  .site-label {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 6px;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    color: rgb(var(--acc-deep));
    background: rgb(var(--acc) / 0.12);
    border: 1px solid rgb(var(--acc) / 0.35);
  }
  .site-label:hover {
    background: rgb(var(--acc) / 0.22);
  }
  .site-label.is-empty {
    color: rgb(var(--ink-4));
    background: transparent;
    border-style: dashed;
    border-color: rgb(var(--line));
  }
  .site-label.is-empty:hover {
    color: rgb(var(--ink-2));
  }
</style>
