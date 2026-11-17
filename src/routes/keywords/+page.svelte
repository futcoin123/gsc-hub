<script lang="ts">
  // «Ключи сайтов»: все сайты отмеченных консолей за период; строка раскрывается
  // в полный список ключей сайта со всеми колонками.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import PeriodNote from '$lib/components/PeriodNote.svelte';
  import SortTh from '$lib/components/SortTh.svelte';
  import SiteKeysTable from '$lib/components/SiteKeysTable.svelte';
  import GroupBar from '$lib/components/GroupBar.svelte';
  import SiteGroupBar from '$lib/components/SiteGroupBar.svelte';
  import SiteGroupCell from '$lib/components/SiteGroupCell.svelte';
  import SiteLabel from '$lib/components/SiteLabel.svelte';
  import { useLabels, sl } from '$lib/site-labels.svelte';
  import { TableSort } from '$lib/table-sort.svelte';
  import { loadGroupItems, siteInTarget, pastGroupsOf } from '$lib/group-items.svelte';
  import { siteHref } from '$lib/utils/site';
  import { selecting } from '$lib/utils/selecting';

  // Ключи карты по странам: у сайта с языковыми папками — главный и свои
  // второстепенные у каждой страны. В скобках — запросов в Google за сентябрь
  // 2026 по карте («Сент.», первая цифра в виде «План»).
  type KM = NonNullable<(typeof data.keyMap)[string]>;
  function byCountry(km: KM) {
    const out = new Map<string, { main: KM['main']; secondary: KM['secondary'] }>();
    const at = (cc: string) => out.get(cc) ?? (out.set(cc, { main: [], secondary: [] }), out.get(cc)!);
    for (const m of km.main) at(m.cc).main.push(m);
    for (const s2 of km.secondary) at(s2.cc).secondary.push(s2);
    return [...out.entries()].map(([cc, v]) => ({ cc, ...v }));
  }
  /** Консоль коротко: первые буквы адреса или названия. */
  const short = (v: string) => (v.length > 5 ? v.slice(0, 4) + '…' : v);
  const vol = (v: number) => v.toLocaleString('ru-RU');
  const volTitle = (k: { volume: number; avg: number }) => `Запросов в Google по карте: ${vol(k.volume)} в сентябре 2026, в среднем ${vol(k.avg)} в месяц за год`;

  let { data } = $props();
  $effect.pre(() => useLabels(data.labels));
  // «Язык» и «Гео» — с самих сайтов (lang страницы, «Карта ключей FUT», зона домена).
  let locale = $state<Record<string, { languages: string[]; geos: string[] }>>({});
  let localeLoading = $state(false);
  async function loadLocale() {
    localeLoading = true;
    try {
      const r = await fetch('/sites/locale', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sites: data.sites.map((x) => x.siteUrl) }) });
      if (r.ok) locale = (await r.json()).sites ?? {};
    } catch {
      // колонки останутся пустыми
    } finally {
      localeLoading = false;
    }
  }
  onMount(() => { loadGroupItems(); loadLocale(); });

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

  type K = 'site' | 'account' | 'lang' | 'geo' | 'map' | 'impressions' | 'clicks' | 'ctr' | 'position' | 'visits' | 'direct' | 'pay' | 'group';
  const sort = new TableSort<K>('impressions', -1, ['impressions', 'clicks', 'ctr', 'visits', 'direct', 'pay', 'group']);
  const sites = $derived(
    sort.apply(
      data.sites.filter((s) => (!search.trim() || s.siteUrl.toLowerCase().includes(search.trim().toLowerCase())) && (!hideEmpty || s.impressions > 0 || s.manual)),
      (s, k) =>
        k === 'site' ? display(s.siteUrl)
        : k === 'account' ? (s.accountLabel ?? s.accountEmail)
        : k === 'lang' ? (locale[s.siteUrl]?.languages.join(', ') || null)
        : k === 'geo' ? (locale[s.siteUrl]?.geos.join(', ') || null)
        : k === 'map' ? (data.keyMap[s.siteUrl]?.main[0]?.key ?? null)
        : k === 'visits' ? (data.visits[s.siteUrl]?.ext ?? 0)
        : k === 'direct' ? (data.visits[s.siteUrl]?.direct ?? 0)
        : k === 'pay' ? (data.pay[s.siteUrl] ?? 0)
        : k === 'group' ? (siteInTarget(s.siteUrl) ? 'z' : (pastGroupsOf(s.siteUrl)[0]?.date ?? null))
        : s[k]
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
    <SiteGroupBar />
    <div class="px-3 py-2"><GroupBar /></div>
    {#if sl.error}<p class="px-3 py-1.5 text-xs text-bad">{sl.error}</p>{/if}
    {#if data.errors.length}
      <div class="app-errors mx-3">{#each data.errors as e (e.account)}<div>{e.account}: {e.reason}</div>{/each}</div>
    {/if}

    {#if data.sites.length === 0}
      <p class="p-3 text-ink-3">Нет сайтов. Отметьте консоль галочкой «Использовать» на странице <a class="text-acc underline" href="/">Accounts</a>.</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="app-table is-roomy is-top">
          <thead>
            <tr>
              <SortTh {sort} k="site" label="Сайт" />
              <SortTh {sort} k="account" label="Консоль" title="Консоль Search Console сайта — первые буквы, полностью — при наведении" />
              <SortTh {sort} k="map" label="Карта ключей" title="Главный ключ сайта (зелёный) и до трёх продающих второстепенных — из «Карты ключей FUT», вид «План». В скобках — запросов в Google за сентябрь 2026 («Сент.» карты). Гайды, инструкции и ключи без запросов не показываются" />
              <SortTh {sort} k="impressions" label="Impr" num />
              <SortTh {sort} k="clicks" label="Clicks" num />
              <SortTh {sort} k="ctr" label="CTR" num />
              <SortTh {sort} k="position" label="Avg Pos" num />
              <SortTh {sort} k="visits" label="Входы" num title="Пришли на сайт по счётчику на сайте за тот же период: из Google, Bing, других поисковиков, ИИ и с других сайтов. Прямые заходы — в соседней колонке" />
              <SortTh {sort} k="direct" label="Прямые" num title="Прямые заходы по счётчику: набрали адрес, закладка, приложение, мессенджер — без адреса, откуда пришли" />
              <SortTh {sort} k="pay" label="К оплате" num title="Перешли к оплате: нажатия кнопки оплаты — переходы на партнёрку за тот же период, по счётчику хаба на сайте" />
              <SortTh {sort} k="group" label="В группу" title="Кнопка + добавляет сайт в группу, выбранную над таблицей («Сайты в группу»). Рядом — прошлые закупки сайта. Сортировка: сначала сайты этой группы, потом по последней закупке" />
              <SortTh {sort} k="lang" label="Язык" title="Язык сайта — как указан на его странице (у сайта с языковыми папками — все языки). Названия — как на бирже ссылок" />
              <SortTh {sort} k="geo" label="Гео" title="Страна сайта: из «Карты ключей FUT», иначе по зоне домена (.de, .co.uk), иначе Global. Названия — как на бирже ссылок" />
            </tr>
          </thead>
          <tbody>
            {#each sites as s, i (key(s))}
              {@const k = key(s)}
              {@const km = data.keyMap[s.siteUrl]}
              <tr class="is-site cursor-pointer" class:is-alt={i % 2 === 1} class:is-selected={open.has(k)} onclick={() => !selecting() && toggle(k)}>
                <td class="pii whitespace-nowrap font-semibold text-ink">
                  <span class="flex items-center gap-1">
                    <svg viewBox="0 0 16 16" class="h-3 w-3 shrink-0 text-ink-4 transition-transform {open.has(k) ? 'rotate-90' : ''}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
                    {display(s.siteUrl)}
                    <SiteLabel site={s.siteUrl} />
                    <a class="ml-0.5 inline-flex rounded p-0.5 text-ink-4 hover:bg-sunk hover:text-acc" href={siteHref(s.siteUrl)} target="_blank" rel="noopener noreferrer" title="Перейти на сайт (в новой вкладке)" aria-label="Перейти на сайт {display(s.siteUrl)}" onclick={(e) => e.stopPropagation()}><svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg></a>
                  </span>
                </td>
                <!-- Узко (просьба владелицы 17.11.2026): первые буквы консоли, полностью — в подсказке; место — ключам карты. -->
                <td class="pii whitespace-nowrap text-xs text-ink-3">{#if s.manual}<span title="Без консоли: ваш сайт со счётчиком, которого ещё нет в Search Console. Цифр Google нет, переходы к оплате — по счётчику. Ключи для закупки — в строке «Свой ключ» (раскройте сайт)">нет</span>{:else}<span title={s.accountLabel ?? s.accountEmail}>{short(s.accountLabel ?? s.accountEmail)}</span>{/if}</td>
                <!-- Ключи карты копируют — нажатие здесь строку не сворачивает. -->
                <td class="min-w-[22rem] max-w-[34rem] cursor-text text-xs" onclick={(e) => e.stopPropagation()}>
                  {#if km}
                    <span class="flex flex-col gap-0.5">
                      {#each byCountry(km) as g (g.cc)}
                        <span class="flex flex-wrap items-center gap-1">
                          {#if km.main.length > 1}<span class="app-num w-6 text-[10px] text-ink-4" title={g.main[0]?.geo ?? g.secondary[0]?.geo}>{g.cc}</span>{/if}
                          {#each g.main as m (m.key + m.url)}<span class="badge badge-ok" title="Главный ключ по «Карте ключей FUT» · {m.url} · {m.geo} · {volTitle(m)}">{m.key} ({vol(m.volume)})</span>{/each}
                          {#each g.secondary as s2 (s2.key + s2.url)}<span class="badge badge-muted" title="Второстепенный ключ по «Карте ключей FUT» · {s2.url} · {s2.geo} · {volTitle(s2)}">{s2.key} ({vol(s2.volume)})</span>{/each}
                        </span>
                      {/each}
                    </span>
                  {:else}
                    <span class="text-ink-4" title="Сайта пока нет в «Карте ключей FUT». Хаб ищет его в карте раз в 3 дня — когда появится, ключи отметятся сами">нет в карте</span>
                  {/if}
                </td>
                {#if s.manual}
                  <td colspan="4" class="text-xs text-ink-4" title="Сайта нет в Search Console — цифр Google нет">нет в Search Console</td>
                {:else if s.error}
                  <td colspan="4" class="text-xs text-bad" title={s.error}>не загрузилось</td>
                {:else}
                  <td class="num app-num">{fmt(s.impressions)}</td>
                  <td class="num app-num">{fmt(s.clicks)}</td>
                  <td class="num app-num">{(s.ctr * 100).toFixed(1)}%</td>
                  <td class="num app-num">{s.position === null ? '—' : s.position.toFixed(1)}</td>
                {/if}
                <td class="num app-num {data.visits[s.siteUrl]?.ext ? 'font-semibold' : 'text-ink-4'}">{fmt(data.visits[s.siteUrl]?.ext ?? 0)}</td>
                <td class="num app-num {data.visits[s.siteUrl]?.direct ? '' : 'text-ink-4'}">{fmt(data.visits[s.siteUrl]?.direct ?? 0)}</td>
                <td class="num app-num {data.pay[s.siteUrl] ? 'font-semibold' : 'text-ink-4'}">{fmt(data.pay[s.siteUrl] ?? 0)}</td>
                <td><SiteGroupCell siteUrl={s.siteUrl} /></td>
                <td class="text-xs text-ink-2">{#if locale[s.siteUrl]}{locale[s.siteUrl].languages.join(', ') || '—'}{:else if localeLoading}<span class="text-ink-4">…</span>{/if}</td>
                <td class="text-xs text-ink-2">{#if locale[s.siteUrl]}{locale[s.siteUrl].geos.join(', ')}{:else if localeLoading}<span class="text-ink-4">…</span>{/if}</td>
              </tr>
              {#if open.has(k)}
                <tr class="bg-sunk hover:bg-sunk">
                  <td colspan="13" class="px-3">
                    {#key data.period.key}
                      <SiteKeysTable siteUrl={s.siteUrl} accountId={s.accountId} period={data.period.key} siteTotals={s.error || s.manual ? null : { clicks: s.clicks, impressions: s.impressions }} />
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
