<script lang="ts">
  // Меню аккаунта в шапке (просьба владелицы 12.11.2026: вкладки не помещались).
  // Вместо почты — значок; в меню почта, редкие разделы (API, Сервисы, Users) и выход.
  type Link = { href: string; label: string; title?: string };
  let { email, role, links = [], path = '' }: { email: string; role: string; links?: Link[]; path?: string } = $props();

  let open = $state(false);
  const isHere = (href: string) => path === href || path.startsWith(href + '/');
  // Открыт раздел из меню — значок подсвечен, как активная вкладка.
  const here = $derived(links.some((l) => isHere(l.href)));

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false;
  }
</script>

<svelte:window onkeydown={open ? onKey : undefined} />

<div class="relative">
  <button
    type="button"
    class="btn btn-sm px-1.5 {here ? 'bg-acc-t text-acc hover:bg-acc-t' : 'btn-ghost'}"
    title="{email} · {role}"
    aria-label="Аккаунт {email}: меню"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <svg viewBox="0 0 16 16" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c.6-2.4 2.6-4 5-4s4.4 1.6 5 4" /></svg>
  </button>

  {#if open}
    <button type="button" class="fixed inset-0 z-40 cursor-default" aria-label="Закрыть" onclick={() => (open = false)}></button>
    <div class="absolute right-0 z-50 mt-1 w-60 rounded-md border border-line bg-pane p-1 shadow-lg max-sm:fixed max-sm:inset-x-3 max-sm:top-11 max-sm:mt-0 max-sm:w-auto">
      <div class="border-b border-line px-2 pb-1.5 pt-1">
        <div class="pii truncate text-[13px] font-medium text-ink" title={email}>{email}</div>
        <div class="text-xs text-ink-3">{role}</div>
      </div>
      {#if links.length}
        <ul class="py-1">
          {#each links as l (l.href)}
            <li>
              <a
                href={l.href}
                title={l.title}
                class="flex w-full items-center rounded px-2 py-1.5 text-[13px] hover:bg-sunk {isHere(l.href) ? 'font-semibold text-acc' : 'text-ink-2'}"
                aria-current={isHere(l.href) ? 'page' : undefined}
                onclick={() => (open = false)}>{l.label}</a
              >
            </li>
          {/each}
        </ul>
      {/if}
      <form method="POST" action="/logout" class="border-t border-line pt-1">
        <button class="flex w-full items-center rounded px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-sunk">Выйти</button>
      </form>
    </div>
  {/if}
</div>
