<script lang="ts">
  // «Ключи сайтов»: все сайты отмеченных консолей за период; строка раскрывается
  // в полный список ключей сайта со всеми колонками.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PeriodNote from '$lib/components/PeriodNote.svelte';
  import SortTh from '$lib/components/SortTh.svelte';
  import SiteKeysTable from '$lib/components/SiteKeysTable.svelte';
  import GroupBar from '$lib/components/GroupBar.svelte';
  import { TableSort } from '$lib/table-sort.svelte';
  import { loadGroupItems } from '$lib/group-items.svelte';
  import { siteHref } from '$lib/utils/site';

  let { data } = $props();
  onMount(() => { loadGroupItems(); });

  let open = $state<Set<string>>(new Set());
  let search = $state('');
  let hideEmpty = $state(false);
  const key = (s: { siteUrl: string; accountId: string }) => `${s.accountId}|${s.siteUrl}`;
  function toggle(k: string) {
    const n = new Set(open);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    open = n;
  }
  const display = (u: string) => u.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');

  type K = 'site' | 'account' | 'impressions' | 'clicks' | 'ctr' | 'position' | 'pay';
  const sort = new TableSort<K>('impressions', -1, ['impressions', 'clicks', 'ctr', 'pay']);
  const sites = $derived(
    sort.apply(
      data.sites.filter((s) => (!search.trim() || s.siteUrl.toLowerCase().includes(search.trim().toLowerCase())) && (!hideEmpty || s.impressions > 0)),
      (s, k) => (k === 'site' ? display(s.siteUrl) : k === 'account' ? (s.accountLabel ?? s.accountEmail) : k === 'pay' ? (data.pay[s.siteUrl] ?? 0) : s[k])
    )
  );
  const total = $derived(data.sites.reduce((a, s) => ({ i: a.i + s.impressions, c: a.c + s.clicks }), { i: 0, c: 0 }));
  const fmt = (n: number) => n.toLocaleString('ru-RU');
  const fmtDay = (iso: string) => iso.split('-').reverse().join('.');
  const periodLabel = $derived(data.period.startDate === data.period.endDate ? fmtDay(data.period.startDate) : `${fmtDay(data.period.startDate)} – ${fmtDay(data.period.endDate)}`);
</script>

<svelte:head><title>Ключи сайтов · GSC Hub</title></svelte:head>

<div class="desk">
  <section class="pane">
    <div class="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
      <h1 class="text-base font-semibold">Ключи сайтов</h1>
      <PeriodNote start={data.period.startDate} end={data.period.endDate} />
      <span class="text-xs text-ink-3">{periodLabel}{data.period.key === 'today' || data.period.key === 'yesterday' ? ' · данные за день ещё обновляются' : ''}</span>
      {#if data.period.pending}<span class="text-xs text-warn" title="Сутки Google идут по Калифорнии. Итоги за «Сегодня» хаб берёт из почасовых данных — они есть и до этого">Суточный отчёт Google за этот день начнётся{data.period.startsAt ? ` в ${data.period.startsAt}` : ''}; итоги — из почасовых данных</span>{/if}
    </div>
    <div class="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2 text-xs">
      <input class="input h-7 w-56 text-xs" placeholder="Сайт содержит…" bind:value={search} aria-label="Поиск сайта" />
      <label class="flex items-center gap-1 text-ink-2"><input type="checkbox" bind:checked={hideEmpty} /> скрыть сайты без показов</label>
      <span class="text-ink-3">{fmt(data.sites.length)} сайтов · {fmt(total.i)} показов · {fmt(total.c)} кликов · перешли к оплате {fmt(data.payTotal)}</span>
      <span class="text-ink-4">Сайты консолей, отмеченных галочкой «Использовать» на странице Accounts.</span>
    </div>
    <div class="px-3 py-2"><GroupBar /></div>
    {#if data.errors.length}
      <div class="app-errors mx-3">{#each data.errors as e (e.account)}<div>{e.account}: {e.reason}</div>{/each}</div>
    {/if}

    {#if data.sites.length === 0}
      <p class="p-3 text-ink-3">Нет сайтов. Отметьте консоль галочкой «Использовать» на странице <a class="text-acc underline" href="/">Accounts</a>.</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="app-table">
          <thead>
            <tr>
              <SortTh {sort} k="site" label="Сайт" />
              <SortTh {sort} k="account" label="Консоль" />
              <SortTh {sort} k="impressions" label="Impr" num />
              <SortTh {sort} k="clicks" label="Clicks" num />
              <SortTh {sort} k="ctr" label="CTR" num />
              <SortTh {sort} k="position" label="Avg Pos" num />
              <SortTh {sort} k="pay" label="Перешли к оплате" num title="Нажатия кнопки оплаты — переходы на партнёрку за тот же период, по счётчику хаба на сайте" />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each sites as s (key(s))}
              {@const k = key(s)}
              <tr class="cursor-pointer" class:is-selected={open.has(k)} onclick={() => toggle(k)}>
                <td class="pii font-semibold text-ink">
                  <span class="flex items-center gap-1">
                    <svg viewBox="0 0 16 16" class="h-3 w-3 shrink-0 text-ink-4 transition-transform {open.has(k) ? 'rotate-90' : ''}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
                    {display(s.siteUrl)}
                    <a class="ml-0.5 inline-flex rounded p-0.5 text-ink-4 hover:bg-sunk hover:text-acc" href={siteHref(s.siteUrl)} target="_blank" rel="noopener noreferrer" title="Перейти на сайт (в новой вкладке)" aria-label="Перейти на сайт {display(s.siteUrl)}" onclick={(e) => e.stopPropagation()}><svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg></a>
                  </span>
                </td>
                <td class="pii text-xs text-ink-3">{s.accountLabel ?? s.accountEmail}</td>
                {#if s.error}
                  <td colspan="4" class="text-xs text-bad" title={s.error}>не загрузилось</td>
                {:else}
                  <td class="num app-num">{fmt(s.impressions)}</td>
                  <td class="num app-num">{fmt(s.clicks)}</td>
                  <td class="num app-num">{(s.ctr * 100).toFixed(1)}%</td>
                  <td class="num app-num">{s.position === null ? '—' : s.position.toFixed(1)}</td>
                {/if}
                <td class="num app-num {data.pay[s.siteUrl] ? 'font-semibold' : 'text-ink-4'}">{fmt(data.pay[s.siteUrl] ?? 0)}</td>
                <td class="text-right">
                  <a class="btn btn-ghost btn-sm" href="/properties/{encodeURIComponent(s.siteUrl)}?acc={encodeURIComponent(s.accountId)}" onclick={(e) => e.stopPropagation()} title="Страница сайта в хабе: графики, страницы, ключи">Подробно</a>
                </td>
              </tr>
              {#if open.has(k)}
                <tr class="bg-sunk hover:bg-sunk">
                  <td colspan="8" class="px-3">
                    {#key data.period.key}
                      <SiteKeysTable siteUrl={s.siteUrl} accountId={s.accountId} period={data.period.key} siteTotals={s.error ? null : { clicks: s.clicks, impressions: s.impressions }} />
                    {/key}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>
