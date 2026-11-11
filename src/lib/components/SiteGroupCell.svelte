<script lang="ts">
  // Ячейка «В группу» (Sites, Ключи сайтов): + добавляет сайт в группу, ✓ — убирает;
  // рядом — прошлые закупки сайта, чтобы, собирая новую, видеть, что брали вчера.
  import { gi, targetGroup, siteInTarget, toggleSiteInTarget, pastGroupsOf } from '$lib/group-items.svelte';
  let { siteUrl }: { siteUrl: string } = $props();
  const g = $derived(targetGroup());
  const on = $derived(siteInTarget(siteUrl));
  const busy = $derived(gi.busy.has('site:' + siteUrl));
  // Прошлые закупки этого сайта (другие группы): «10.11 · 8 ссыл.».
  const past = $derived(pastGroupsOf(siteUrl));
  const dm = (iso: string | null, name: string) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : name);
  const pastTitle = $derived(
    'Прошлые закупки этого сайта:\n' + past.map((p) => `${dm(p.date, p.name)} — группа «${p.name}»${p.links ? `, ${p.links} ссыл.` : ', ссылок ещё нет'}`).join('\n')
  );
</script>

<span class="inline-flex items-center gap-1.5 whitespace-nowrap">

<button
  type="button"
  class="btn btn-sm whitespace-nowrap {on ? 'bg-acc text-white hover:bg-acc-deep' : 'btn-sec'}"
  disabled={busy || !g}
  title={!g ? 'Сначала создайте группу над таблицей' : on ? `Убрать из ${g.name}` : `Добавить в ${g.name}`}
  aria-pressed={on}
  onclick={(e) => { e.stopPropagation(); toggleSiteInTarget(siteUrl); }}
>{on ? `✓ ${g?.name}` : '+'}</button>
{#if past.length}
  <a class="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-acc" href="/groups?g={past[0].id}" title={pastTitle} onclick={(e) => e.stopPropagation()}>
    {#each past.slice(0, 2) as p (p.id)}<span class="badge badge-acc">{dm(p.date, p.name)}{p.links ? ` · ${p.links} ссыл.` : ''}</span>{/each}
    {#if past.length > 2}<span class="text-ink-3">+{past.length - 2}</span>{/if}
  </a>
{/if}
</span>
