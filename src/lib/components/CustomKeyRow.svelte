<script lang="ts">
  // Строка «Свой ключ» над ключами сайта: вписать анкор и страницу руками —
  // для ключей, которых нет в отчёте Google за период (или вообще нет).
  // Связка уходит в группу из строки «Ключи в группу», как кнопка + в таблице.
  import GroupCell from './GroupCell.svelte';
  import { gi, activeGroup, addCustomItem, activeItemsOfSite, itemKey } from '$lib/group-items.svelte';
  import { sitePageUrl, cleanAnchor } from '$lib/utils/url-filters';
  import { siteHref } from '$lib/utils/site';
  import type { MapPage } from '$lib/utils/key-map';

  let {
    siteUrl,
    keyMap = null,
    tableKeys = new Set<string>()
  }: { siteUrl: string; keyMap?: MapPage[] | null; tableKeys?: Set<string> } = $props();

  const uid = $props.id();
  const g = $derived(activeGroup());
  let key = $state('');
  let page = $state('');
  let qty = $state<number | null>(null);
  let busy = $state(false);
  let err = $state<string | null>(null);
  let note = $state<string | null>(null);

  const abs = (u: string) => {
    try {
      return new URL(u, siteHref(siteUrl)).href;
    } catch {
      return u;
    }
  };
  // Подсказки — из «Карты ключей FUT»: ключи сайта и их страницы.
  const mapKeys = $derived([...new Set((keyMap ?? []).map((p) => p.key))]);
  const mapPages = $derived([...new Set([siteHref(siteUrl), ...(keyMap ?? []).map((p) => abs(p.url))])]);
  function autofill() {
    const k = key.trim().toLowerCase();
    const hit = (keyMap ?? []).find((p) => p.key.toLowerCase() === k);
    if (hit && !page.trim()) page = abs(hit.url);
  }

  // Связки выбранной группы на этом сайте, которых не видно в таблице ниже.
  const extra = $derived(activeItemsOfSite(siteUrl).filter((x) => !tableKeys.has(itemKey(x.page, x.query))));

  async function add(e: SubmitEvent) {
    e.preventDefault();
    err = null;
    note = null;
    let q: string, url: string;
    try {
      q = cleanAnchor(key);
      url = sitePageUrl(page, siteUrl);
      if (!qty || qty < 1) throw new Error('Впишите, сколько ссылок (шт)');
    } catch (x) {
      err = (x as Error).message;
      return;
    }
    const n = Math.min(1000, Math.round(qty));
    busy = true;
    try {
      const { prev } = await addCustomItem({ siteUrl, query: q, page: url, qty: n });
      note = prev === null ? `Добавлено в «${g?.name}»: «${q}» — ${n} шт` : `«${q}» уже был в «${g?.name}» (${prev} шт) — теперь ${n} шт`;
      key = '';
      page = '';
      qty = null;
    } catch (x) {
      err = (x as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="mb-2 rounded border border-line bg-pane px-2 py-1.5 text-xs">
  <form class="flex flex-wrap items-center gap-1.5" onsubmit={add}>
    <span class="font-semibold text-ink-2" title="Ключ и страницу можно вписать руками — например, ключ карты, которого нет в Google за период">Свой ключ:</span>
    <input class="input h-7 w-56 text-xs" placeholder="ключ — текст ссылки" list="{uid}-keys" bind:value={key} oninput={autofill} onchange={autofill} aria-label="Свой ключ (текст ссылки)" />
    <span class="text-ink-3">на</span>
    <input class="pii input h-7 w-80 text-xs" placeholder="страница: https://… или /путь/" list="{uid}-pages" bind:value={page} aria-label="Страница сайта для своего ключа" />
    <input type="number" min="1" max="1000" placeholder="шт" class="input h-7 w-14 border-dashed px-1 text-right text-xs" bind:value={qty} aria-label="Сколько ссылок" />
    <button class="btn btn-sec btn-sm" disabled={busy || !!g?.fixedAt} title={g ? `Добавить в группу «${g.name}»` : 'Сначала выберите группу в строке «Ключи в группу» вверху страницы'}>
      {busy ? 'Сохраняю…' : g ? `+ в ${g.name}` : '+ в группу'}
    </button>
    {#if !g}
      <span class="text-ink-2">Группа не выбрана — выберите её в строке «Ключи в группу» вверху страницы.</span>
    {:else if g.fixedAt}
      <span class="text-ink-3">«{g.name}» зафиксирована — добавлять нельзя.</span>
    {/if}
    {#if err}<span class="text-bad" role="alert">{err}</span>{/if}
    {#if note}<span class="text-up" role="status">{note}</span>{/if}
    <datalist id="{uid}-keys">{#each mapKeys as k (k)}<option value={k}></option>{/each}</datalist>
    <datalist id="{uid}-pages">{#each mapPages as p (p)}<option value={p}></option>{/each}</datalist>
  </form>

  {#if g && extra.length}
    <div class="mt-1.5 border-t border-line pt-1.5">
      <div class="mb-1 text-ink-3">В группе «{g.name}», но нет в таблице за период ({extra.length}):</div>
      <table class="app-table">
        <tbody>
          {#each extra as x (x.page + '\n' + x.query)}
            <tr>
              <td class="pii font-medium">{x.query}</td>
              <td class="max-w-sm"><a class="pii break-all text-ink-3 hover:text-acc hover:underline" href={x.page} target="_blank" rel="noopener noreferrer">{x.page}</a></td>
              <td class="num"><GroupCell row={{ siteUrl, query: x.query, page: x.page }} /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#if gi.error && !err}<p class="mt-1 text-bad" role="alert">{gi.error}</p>{/if}
</div>
