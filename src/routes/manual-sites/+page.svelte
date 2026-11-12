<script lang="ts">
  // «Без консоли»: свои сайты, которых нет в Search Console. Слева — кампании
  // по датам и список сайтов, справа — выбранная кампания: ключи и страницы
  // вписываются руками. Внизу — история: что и когда куплено.
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();

  const campaign = $derived(data.campaigns.find((c) => c.id === data.selectedId) ?? null);
  const fmtDate = (iso: string) => iso.split('-').reverse().join('.');
  const fmtTs = (ts: number) => new Date(ts).toLocaleDateString('ru-RU');
  const fmt = (n: number) => n.toLocaleString('ru-RU');
  const errAt = (where: string) => (form && 'where' in form && form.where === where ? form.error : null);
  const siteLine = (s: PageData['sites'][number]) =>
    [
      s.bought ? `куплено ${fmt(s.bought)}${s.lastDate ? ` · последняя ${fmtDate(s.lastDate)}` : ''}` : 'ещё не покупали',
      s.planned ? `в работе ${fmt(s.planned)}` : ''
    ]
      .filter(Boolean)
      .join(' · ');

  // Новая кампания: дата по умолчанию — сегодня; после создания поле не пустеет.
  let newDate = $state('');
  let newName = $state('');
  $effect(() => {
    if (!newDate) newDate = data.today;
  });

  // Форма новой ссылки: сайт и вид остаются после добавления — удобно
  // вписывать несколько ключей подряд на один сайт.
  let host = $state('');
  let type = $state<'anchor' | 'url' | 'domain'>('anchor');
  let anchor = $state('');
  let pageUrl = $state('');
  let qty = $state<number | null>(null);
  let linkNote = $state<string | null>(null);
  $effect(() => {
    if (!data.sites.some((s) => s.host === host)) host = data.sites[0]?.host ?? '';
  });
  // Подсказки: главная сайта, страницы и ключи, которые уже брали на этот сайт.
  const pastPages = $derived([...new Set([host ? `https://${host}/` : '', ...data.history.filter((h) => h.host === host).map((h) => h.page)].filter(Boolean))]);
  const pastAnchors = $derived([...new Set(data.history.filter((h) => h.host === host && h.kind === 'anchor').map((h) => h.anchor))]);

  // История: по умолчанию только купленное (зафиксированные кампании).
  let histHost = $state('');
  let histAll = $state(false);
  const hist = $derived(data.history.filter((h) => (histAll || h.fixedAt) && (!histHost || h.host === histHost)));
  const histLinks = $derived(hist.reduce((a, h) => a + h.qty, 0));
  function showHistory(h: string) {
    histHost = h;
    document.getElementById('history')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
</script>

<svelte:head><title>Сайты без консоли — gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <span>gsc-hub</span>
        <span aria-hidden="true">/</span>
        <span class="text-ink-2">Без консоли</span>
      </nav>
      <h1 class="app-pagetitle">Сайты без консоли</h1>
    </div>
  </header>

  <p class="mb-3 max-w-3xl text-sm text-ink-3">
    Свои сайты, которых нет в Search Console. Закупки ссылок — кампаниями по датам: сайт, ключ и страницу
    вписываете сами. Когда ссылки куплены, нажмите <b>Зафиксировать</b> — кампания попадёт в историю внизу.
    С «Группами» и «Закупками» сайтов из консолей этот раздел не смешивается.
  </p>

  <div class="grid gap-3 lg:grid-cols-[20rem_1fr]">
    <div class="flex flex-col gap-3 self-start">
      <section class="pane">
        <div class="pane-head">Кампании <span class="aside app-num">{data.campaigns.length}</span></div>
        <ul class="p-1">
          {#each data.campaigns as c (c.id)}
            <li>
              <a
                href="?c={c.id}"
                class="flex items-center gap-2 rounded px-2 py-1.5 text-[13px] hover:bg-sunk {c.id === data.selectedId ? 'bg-sunk font-semibold text-ink' : 'text-ink-2'}"
              >
                <span class="min-w-0 flex-1 truncate">{c.name}</span>
                {#if c.fixedAt}<span class="badge badge-ok" title="Зафиксирована {fmtTs(c.fixedAt)}">куплено</span>{/if}
                <span class="app-num text-xs text-ink-3" title="ссылок в кампании">{c.links || ''}</span>
              </a>
            </li>
          {:else}
            <li class="px-2 py-1.5 text-xs text-ink-3">Пока ни одной — создайте ниже.</li>
          {/each}
        </ul>
        <form
          method="POST"
          action="?/createCampaign"
          class="flex flex-wrap gap-1 border-t border-line p-2"
          use:enhance={() => async ({ result, update }) => {
            await update({ reset: false });
            if (result.type === 'success' && result.data?.created) {
              newName = '';
              goto(`?c=${result.data.created}`, { invalidateAll: true });
            }
          }}
        >
          <input name="date" type="date" bind:value={newDate} required class="input h-7 text-xs" aria-label="Дата кампании" />
          <input name="name" bind:value={newName} class="input h-7 min-w-0 flex-1 text-xs" placeholder="название — по дате" maxlength="60" aria-label="Название кампании (необязательно)" />
          <button class="btn btn-pri btn-sm">Создать</button>
          {#if errAt('campaign')}<p class="w-full text-xs text-bad" role="alert">{errAt('campaign')}</p>{/if}
        </form>
      </section>

      <section class="pane">
        <div class="pane-head">Сайты <span class="aside app-num">{data.sites.length}</span></div>
        <ul class="divide-y divide-line">
          {#each data.sites as s (s.host)}
            <li class="flex items-center gap-2 px-3 py-1.5">
              <div class="min-w-0 flex-1">
                <div class="pii truncate text-[13px] font-medium text-ink" title={s.host}>{s.label}</div>
                <div class="text-xs text-ink-3">{siteLine(s)}</div>
              </div>
              {#if s.bought || s.planned}
                <button type="button" class="btn btn-ghost btn-sm" onclick={() => showHistory(s.host)}>История</button>
              {:else}
                <form
                  method="POST"
                  action="?/removeSite"
                  use:enhance={({ cancel }) => {
                    if (!confirm(`Убрать ${s.label} из списка?`)) cancel();
                  }}
                >
                  <input type="hidden" name="host" value={s.host} />
                  <button class="btn btn-ghost btn-sm text-bad" title="Убрать сайт из списка" aria-label="Убрать {s.label}">×</button>
                </form>
              {/if}
            </li>
          {:else}
            <li class="px-3 py-2 text-xs text-ink-3">Пока пусто — впишите домены ниже.</li>
          {/each}
        </ul>
        <form method="POST" action="?/addSites" class="border-t border-line p-2" use:enhance>
          <label class="mb-1 block text-xs font-medium text-ink-2" for="hosts">Добавить сайты — домены или адреса, по одному на строку</label>
          <textarea id="hosts" name="hosts" rows="3" class="input mb-1 w-full py-1.5 font-mono text-xs" placeholder={'example.com\nhttps://www.other-site.de/'}></textarea>
          <div class="flex items-center gap-2">
            <button class="btn btn-sec btn-sm">Добавить</button>
            {#if form && 'sitesAdded' in form && form.sitesAdded}
              {@const r = form.sitesAdded}
              <span class="text-xs text-ink-3">
                {#if r.added.length}Добавлено: {r.added.length}.{/if}
                {#if r.existed.length}Уже были: {r.existed.join(', ')}.{/if}
                {#if r.rejected.length}Не похожи на домены: {r.rejected.join(', ')}.{/if}
              </span>
            {/if}
          </div>
          {#if errAt('sites')}<p class="mt-1 text-xs text-bad" role="alert">{errAt('sites')}</p>{/if}
        </form>
      </section>
    </div>

    <section class="pane self-start">
      {#if campaign}
        <div class="pane-head flex flex-wrap items-center gap-2">
          <span>{campaign.name}</span>
          <span class="aside">{fmtDate(campaign.date)} · {campaign.rows} строк · {fmt(campaign.links)} ссылок</span>
          <span class="ml-auto flex items-center gap-1 normal-case">
            <a class="btn btn-sec btn-sm" href="/manual-sites/{campaign.id}/csv">Скачать ТЗ (CSV)</a>
            {#if campaign.fixedAt}
              <span class="badge badge-ok">зафиксирована {fmtTs(campaign.fixedAt)}</span>
              <form method="POST" action="?/unfix" use:enhance><input type="hidden" name="id" value={campaign.id} /><button class="btn btn-ghost btn-sm">Открыть для правок</button></form>
            {:else}
              <form method="POST" action="?/fix" use:enhance><input type="hidden" name="id" value={campaign.id} /><button class="btn btn-pri btn-sm" disabled={campaign.rows === 0} title="Ссылки куплены — в историю">Зафиксировать</button></form>
            {/if}
          </span>
        </div>

        {#if !campaign.fixedAt}
          {#if data.sites.length === 0}
            <p class="border-b border-line px-3 py-2 text-xs text-ink-2">Сначала добавьте сайты в список «Сайты» слева.</p>
          {:else}
            <form
              method="POST"
              action="?/addLink"
              class="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2 text-xs"
              use:enhance={() => {
                linkNote = null;
                return async ({ result, update }) => {
                  await update({ reset: false });
                  if (result.type === 'success' && result.data?.linkAdded) {
                    const { prev, qty: n } = result.data.linkAdded as { prev: number | null; qty: number };
                    const what = type === 'anchor' ? `«${anchor.trim()}»` : type === 'url' ? 'безанкор (URL)' : 'безанкор (домен)';
                    linkNote = prev === null ? `Добавлено: ${what} — ${n} шт` : `${what} уже был (${prev} шт) — теперь ${n} шт`;
                    anchor = '';
                    pageUrl = '';
                    qty = null;
                  }
                };
              }}
            >
              <input type="hidden" name="id" value={campaign.id} />
              <select name="host" bind:value={host} class="pii input h-7 w-auto text-xs" aria-label="Сайт">
                {#each data.sites as s (s.host)}<option value={s.host}>{s.label}</option>{/each}
              </select>
              <select name="type" bind:value={type} class="input h-7 w-auto text-xs" aria-label="Вид ссылки">
                <option value="anchor">Анкор</option>
                <option value="url">Безанкор (URL)</option>
                <option value="domain">Безанкор (домен)</option>
              </select>
              {#if type === 'anchor'}
                <input name="anchor" bind:value={anchor} list="past-anchors" class="input h-7 w-52 text-xs" placeholder="ключ — текст ссылки" aria-label="Ключ (текст ссылки)" />
              {/if}
              <span class="text-ink-3">на</span>
              <input name="page" bind:value={pageUrl} list="past-pages" class="pii input h-7 w-72 text-xs" placeholder="страница: https://… или /путь/" aria-label="Страница" />
              <input name="qty" type="number" min="1" max="1000" bind:value={qty} placeholder="шт" class="input h-7 w-14 border-dashed px-1 text-right text-xs" aria-label="Сколько ссылок" />
              <button class="btn btn-pri btn-sm">Добавить</button>
              <datalist id="past-anchors">{#each pastAnchors as a (a)}<option value={a}></option>{/each}</datalist>
              <datalist id="past-pages">{#each pastPages as p (p)}<option value={p}></option>{/each}</datalist>
              {#if errAt('links')}<span class="text-bad" role="alert">{errAt('links')}</span>{/if}
              {#if linkNote}<span class="text-up" role="status">{linkNote}</span>{/if}
            </form>
          {/if}
        {:else}
          <p class="border-b border-line px-3 py-2 text-xs text-ink-2">
            Ссылки куплены — кампания в истории ниже. Чтобы что-то поменять, нажмите «Открыть для правок».
          </p>
        {/if}

        {#if data.links.length}
          <table class="app-table">
            <thead><tr><th>Сайт</th><th>Вид</th><th>Текст ссылки</th><th>Страница</th><th class="num">Ссылок</th><th></th></tr></thead>
            <tbody>
              {#each data.links as l (l.id)}
                <tr>
                  <td class="pii whitespace-nowrap text-ink-2" title={l.host}>{l.label}</td>
                  <td class="whitespace-nowrap text-xs text-ink-3">{l.kindLabel}</td>
                  <td class="pii font-medium">{l.text}</td>
                  <td class="max-w-md"><a class="pii break-all text-ink-3 hover:text-acc hover:underline" href={l.page} target="_blank" rel="noopener noreferrer">{l.page}</a></td>
                  <td class="num">
                    {#if campaign.fixedAt}
                      <span class="app-num">{l.qty}</span>
                    {:else}
                      <form method="POST" action="?/linkQty" use:enhance={() => async ({ update }) => update({ reset: false })}>
                        <input type="hidden" name="id" value={campaign.id} />
                        <input type="hidden" name="link" value={l.id} />
                        <input name="qty" type="number" min="1" max="1000" value={l.qty} class="input h-7 w-16 px-1 text-right text-xs" aria-label="Сколько ссылок" onchange={(e) => e.currentTarget.form?.requestSubmit()} />
                      </form>
                    {/if}
                  </td>
                  <td class="text-right">
                    {#if !campaign.fixedAt}
                      <form method="POST" action="?/removeLink" use:enhance>
                        <input type="hidden" name="id" value={campaign.id} />
                        <input type="hidden" name="link" value={l.id} />
                        <button class="btn btn-ghost btn-sm text-bad" title="Убрать из кампании" aria-label="Убрать {l.text}">×</button>
                      </form>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="px-3 py-3 text-xs text-ink-3">В кампании пока нет ссылок.</p>
        {/if}

        {#if !campaign.fixedAt}
          <form
            method="POST"
            action="?/deleteCampaign"
            class="border-t border-line px-3 py-2"
            use:enhance={({ cancel }) => {
              if (!confirm(`Удалить кампанию «${campaign.name}»${campaign.rows ? ` и ${campaign.rows} строк в ней` : ''}?`)) cancel();
              return async ({ result, update }) => {
                if (result.type === 'success') goto('/manual-sites', { invalidateAll: true });
                else await update();
              };
            }}
          >
            <input type="hidden" name="id" value={campaign.id} />
            <button class="btn btn-danger btn-sm">Удалить кампанию</button>
          </form>
        {/if}
      {:else}
        <div class="pane-head">Кампания</div>
        <p class="p-3 text-sm text-ink-3">Создайте кампанию слева: выберите дату и нажмите «Создать». Потом добавьте в неё ключи и страницы.</p>
      {/if}
    </section>
  </div>

  <section class="pane mt-3 scroll-mt-14" id="history">
    <div class="pane-head flex flex-wrap items-center gap-2">
      <span>История закупок</span>
      <span class="aside app-num">{hist.length} строк · {fmt(histLinks)} ссылок</span>
      <span class="ml-auto flex items-center gap-2 normal-case">
        <select bind:value={histHost} class="pii input h-7 w-auto text-xs" aria-label="Сайт в истории">
          <option value="">Все сайты</option>
          {#each data.sites as s (s.host)}<option value={s.host}>{s.label}</option>{/each}
        </select>
        <label class="flex items-center gap-1 text-xs font-normal text-ink-2"><input type="checkbox" bind:checked={histAll} /> и незафиксированные</label>
      </span>
    </div>
    {#if hist.length}
      <div class="max-h-[40rem] overflow-auto">
        <table class="app-table">
          <thead class="sticky top-0 z-10 bg-pane"><tr><th>Дата</th><th>Кампания</th><th>Сайт</th><th>Вид</th><th>Текст ссылки</th><th>Страница</th><th class="num">Ссылок</th><th>Статус</th></tr></thead>
          <tbody>
            {#each hist as h (h.id)}
              <tr>
                <td class="app-num whitespace-nowrap">{fmtDate(h.date)}</td>
                <td class="whitespace-nowrap"><a class="hover:text-acc hover:underline" href="?c={h.campaignId}">{h.campaignName}</a></td>
                <td class="pii whitespace-nowrap text-ink-2" title={h.host}>{h.label}</td>
                <td class="whitespace-nowrap text-xs text-ink-3">{h.kindLabel}</td>
                <td class="pii font-medium">{h.text}</td>
                <td class="max-w-md"><a class="pii break-all text-ink-3 hover:text-acc hover:underline" href={h.page} target="_blank" rel="noopener noreferrer">{h.page}</a></td>
                <td class="num app-num">{h.qty}</td>
                <td>{#if h.fixedAt}<span class="badge badge-ok" title="Зафиксирована {fmtTs(h.fixedAt)}">куплено</span>{:else}<span class="badge badge-muted">не зафиксирована</span>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="p-3 text-xs text-ink-3">
        {histHost || histAll ? 'Ничего не найдено.' : 'Пока ничего не куплено. Когда ссылки кампании куплены, нажмите в ней «Зафиксировать».'}
      </p>
    {/if}
  </section>
</main>
