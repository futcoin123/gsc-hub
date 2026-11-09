<script lang="ts">
  import type { PageData } from './$types';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  let { data }: { data: PageData } = $props();
  const isAdmin = $derived(data.user?.role === 'admin');

  // Сайты консолей: сколько их, какие не подтверждены, что добавилось после «Обновить».
  type SitesInfo = { total: number; unverified: string[]; added?: string[] } | { error: string };
  let sites = $state<Record<string, SitesInfo>>({});
  let sitesLoading = $state(false);
  let refreshing = $state<string | null>(null);
  let refreshNote = $state<string | null>(null);
  async function loadSites() {
    sitesLoading = true;
    try {
      const r = await fetch('/accounts/sites');
      if (r.ok) sites = await r.json();
    } catch {
      // сеть — колонка останется пустой
    } finally {
      sitesLoading = false;
    }
  }
  onMount(() => { if (isAdmin) loadSites(); });
  /** id — одна консоль; null — все. */
  async function refreshSites(id: string | null) {
    refreshing = id ?? 'all';
    refreshNote = null;
    try {
      const r = await fetch('/accounts/sites', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(id ? { id } : {})
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const fresh = (await r.json()) as Record<string, SitesInfo>;
      sites = { ...sites, ...fresh };
      const added = Object.values(fresh).flatMap((v) => ('added' in v && v.added ? v.added : []));
      refreshNote = added.length ? `Новые сайты: ${added.map(short).join(', ')}` : 'Новых сайтов нет — список совпадает с Search Console.';
      await invalidateAll();
    } catch (e) {
      refreshNote = `Не обновилось: ${(e as Error).message}`;
    } finally {
      refreshing = null;
    }
  }
  const short = (u: string) => u.replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');

  let pending = $state<string | null>(null);
  async function setInUse(id: string, inUse: boolean) {
    pending = id;
    try {
      const res = await fetch('/accounts/in-use', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, inUse })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await invalidateAll();
    } catch (e) {
      alert(`Не сохранилось: ${(e as Error).message}`);
    } finally {
      pending = null;
    }
  }
  const inUseCount = $derived(data.accounts.filter((a) => a.in_use !== 0).length);

  function fmtDate(unix: number) {
    return new Date(unix * 1000).toISOString().slice(0, 10);
  }
</script>

<svelte:head><title>Accounts — gsc-hub</title></svelte:head>

<main class="page">
  <header class="app-toolbar">
    <div class="app-toolbar-left">
      <nav class="app-breadcrumbs">
        <span>gsc-hub</span>
        <span aria-hidden="true">/</span>
        <span class="text-ink-2">Accounts</span>
      </nav>
      <h1 class="app-pagetitle">Connected Google accounts</h1>
    </div>
    <div class="app-toolbar-right">
      {#if isAdmin}
        <a href="/properties" class="btn btn-sec">Sites</a>
        <a href="/dashboard" class="btn btn-sec">Dashboard</a>
        <button type="button" class="btn btn-sec" disabled={refreshing !== null} title="Заново забрать список сайтов из Search Console у всех консолей — новые сайты появятся во всех отчётах сразу" onclick={() => refreshSites(null)}>{refreshing === 'all' ? 'Обновляю…' : 'Обновить сайты'}</button>
      {/if}
      <span class="app-toolbar-divider" aria-hidden="true"></span>
      <form method="POST" action="?/connect">
        <input type="hidden" name="providerId" value="google" />
        <button type="submit" class="btn btn-pri">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3v8M3 7h8" /></svg>
          Connect Google account
        </button>
      </form>
    </div>
  </header>

  {#if data.accounts.length === 0}
    <div class="app-empty">
      <div class="app-empty-title">No connected accounts yet</div>
      <p class="app-empty-sub">Click <span class="font-medium text-ink-2">Connect Google account</span> above to authorize one or more accounts. OAuth tokens stay local in <code class="rounded bg-sunk px-1 py-0.5 font-mono text-[11px] text-ink-2">data/gsc-hub.db</code>.</p>
    </div>
  {:else}
    <section class="pane">
      <div class="pane-head">Accounts <span class="aside app-num">{#if isAdmin}в отчётах {inUseCount} из&nbsp;{/if}{data.accounts.length}</span></div>
      {#if refreshNote}<p class="border-b border-line px-3 py-2 text-xs {refreshNote.startsWith('Не ') ? 'text-bad' : 'text-ink-2'}" role="status">{refreshNote}</p>{/if}
      <div class="overflow-x-auto">
      <table class="app-table">
        <thead>
          <tr>
            {#if isAdmin}<th class="w-px" title="Снятая галочка убирает консоль из всех отчётов и из MCP">Использовать</th>{/if}
            <th>Email</th>
            {#if isAdmin}<th class="hidden sm:table-cell">Label</th>{/if}
            <th>Status</th>
            {#if isAdmin}<th title="Сколько сайтов видно в Search Console этой консоли. Хаб помнит список час; «Обновить» забирает его заново">Сайтов</th>{/if}
            <th class="hidden md:table-cell">Added</th>
            {#if isAdmin}<th class="hidden lg:table-cell">Owner</th>{/if}
            {#if isAdmin}<th class="w-px text-right">Actions</th>{/if}
          </tr>
        </thead>
        <tbody>
          {#each data.accounts as a (a.id)}
            <tr class={isAdmin && a.in_use === 0 ? 'opacity-60' : ''}>
              {#if isAdmin}
              <td class="text-center">
                <input
                  type="checkbox"
                  aria-label="Использовать {a.email} в отчётах"
                  checked={a.in_use !== 0}
                  disabled={pending === a.id}
                  onchange={(e) => setInUse(a.id, e.currentTarget.checked)}
                />
              </td>
              {/if}
              <td class="break-all font-medium text-ink">{a.email}</td>
              {#if isAdmin}
              <td class="hidden sm:table-cell">
                <form method="POST" action="/accounts/{a.id}/relabel" class="flex items-center gap-1">
                  <input
                    name="label"
                    value={a.label ?? ''}
                    class="input h-6 w-32 text-xs"
                    placeholder="—"
                  />
                  <button type="submit" class="btn btn-sec btn-sm">Save</button>
                </form>
              </td>
              {/if}
              <td>
                <span class="badge {a.status === 'active' ? 'badge-ok' : a.status === 'revoked' ? 'badge-bad' : 'badge-warn'}" title={a.last_error ?? ''}>
                  {a.status}
                </span>
              </td>
              {#if isAdmin}
              {@const si = sites[a.id]}
              <td class="whitespace-nowrap text-xs">
                <span class="inline-flex items-center gap-2">
                  {#if si && 'error' in si}
                    <span class="text-bad" title={si.error}>не загрузилось</span>
                  {:else if si}
                    <span class="app-num font-medium text-ink">{si.total}</span>
                    {#if si.unverified.length}<span class="badge badge-warn" title="Добавлены, но не подтверждены в Search Console — данных по ним Google не даст: {si.unverified.map(short).join(', ')}">{si.unverified.length} не подтв.</span>{/if}
                    {#if si.added?.length}<span class="badge badge-ok" title={si.added.map(short).join(', ')}>+{si.added.length} новых</span>{/if}
                  {:else if sitesLoading}
                    <span class="text-ink-4">…</span>
                  {/if}
                  {#if a.status !== 'revoked'}
                    <button type="button" class="btn btn-ghost btn-sm" disabled={refreshing !== null} title="Заново забрать сайты этой консоли из Search Console" onclick={() => refreshSites(a.id)}>{refreshing === a.id ? 'Обновляю…' : 'Обновить'}</button>
                  {/if}
                </span>
              </td>
              {/if}
              <td class="app-num hidden text-ink-3 md:table-cell">{fmtDate(a.added_at)}</td>
              {#if isAdmin}
              <td class="app-num hidden text-ink-3 lg:table-cell">{a.owner_id ?? '—'}</td>
              <td class="text-right">
                <form method="POST" action="/accounts/{a.id}/delete" class="inline-block">
                  <button
                    type="submit"
                    class="btn btn-danger btn-sm"
                    onclick={(e) => {
                      if (!confirm('Delete this account connection?')) e.preventDefault();
                    }}
                  >Delete</button>
                </form>
              </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
    </section>
  {/if}
</main>
