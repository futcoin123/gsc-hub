<script lang="ts">
  import HeaderPeriod from '$lib/components/HeaderPeriod.svelte';
  import '../app.css';
  import { onMount } from 'svelte';
  import favicon from '$lib/assets/favicon.svg';
  import { page } from '$app/state';
  import ConsolePicker from '$lib/components/ConsolePicker.svelte';
  import GroupPicker from '$lib/components/GroupPicker.svelte';
  import AccountMenu from '$lib/components/AccountMenu.svelte';
  import { RELEASES_LATEST_URL, isNewer, releaseUrl, shouldCheck } from '$lib/version';

  const NAV = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/properties', label: 'Sites' },
    { href: '/properties/striking', label: 'Portfolio', title: 'Портфельная аналитика: striking distance, каннибализация, CTR, branded, decay' },
    { href: '/keywords', label: 'Ключи сайтов', title: 'Все сайты выбранной консоли и все их ключи за период: сегодня, вчера, 7–480 дней' },
    { href: '/clicks', label: 'Кнопки', title: 'Сколько раз на ваших сайтах нажали кнопки и отправили форму заказа' },
    { href: '/uptime', label: 'Доступность', title: 'Открываются ли сайты и та ли на них страница' },
    { href: '/search', label: 'Поиск ключа', title: 'На каких ваших сайтах и страницах есть ключ и на каком месте' },
    { href: '/groups', label: 'Группы', title: 'Группы сайтов и закупки ссылок' },
    { href: '/purchases', label: 'Закупки', title: 'Что изменилось после закупки ссылок: позиция, показы и клики до и после — по сайту и по каждому ключу' },
    { href: '/manual-sites', label: 'Без консоли', title: 'Сайты, которых нет в Search Console: кампании по датам, ключи и страницы руками, история закупок' },
    // «Events» убран из меню по просьбе владелицы; страница /events работает по прямой ссылке.
    // «MagicLinks» убран из меню по просьбе владелицы; страница /magiclinks работает по прямой ссылке.
  ];
  // Редкие разделы — в меню аккаунта (значок справа), чтобы вкладки помещались в шапку.
  const ACCOUNT_LINKS = [
    { href: '/api', label: 'API', title: 'API-ключи и документация для агентов' },
    { href: '/settings/integrations', label: 'Сервисы', title: 'Внешние сервисы и API-ключи: индексаторы, DataForSEO' },
    { href: '/admin/users', label: 'Users', title: 'Пользователи панели и роли' }
  ];
  // Longest matching prefix wins, so /properties/striking lights Portfolio, not Sites.
  const activeHref = $derived.by(() => {
    const path = page.url.pathname;
    let best = '';
    for (const { href } of NAV) {
      if ((path === href || path.startsWith(href + '/')) && href.length > best.length) best = href;
    }
    return best;
  });
  const isActive = (href: string) => activeHref === href;
  let { children, data } = $props();
  // Консоли, с которыми Google сейчас не работает: плашка над каждой страницей,
  // чтобы нули и пропавшие сайты не выглядели как «данных нет».
  const brokenConsoles = $derived(
    ((data?.consoles ?? []) as { id: string; email: string; label: string | null; status: string; error?: string | null; connectedAt?: number | null; statusAt?: number | null }[]).filter(
      (c) => c.status !== 'active'
    )
  );
  // «Отключена 04.11 в 09:12 — через 7 дн. после подключения 28.10»: по сроку видно причину.
  const dm = (sec: number) => new Date(sec * 1000).toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const lostAfter = (c: { connectedAt?: number | null; statusAt?: number | null }) =>
    c.statusAt ? `Отключена ${dm(c.statusAt)}${c.connectedAt && c.statusAt >= c.connectedAt ? ` — через ${Math.round((c.statusAt - c.connectedAt) / 86400)} дн. после подключения ${dm(c.connectedAt).slice(0, 5)}` : ''}.` : '';
  const testingExpiry = $derived(brokenConsoles.some((c) => c.status === 'revoked' && /invalid_grant/i.test(c.error ?? '')));
  const user = $derived(data?.user ?? null);
  const isAdmin = $derived(user?.role === 'admin');

  const version = $derived(data?.version ?? null);
  const updateCheck = $derived(data?.updateCheck ?? false);

  // Update ticker. The whole check lives in the browser: the server never calls
  // out and never stores anything for it.
  type UpdateState = { checkedAt: number; latest: string | null };

  const UPDATE_KEY = 'gsc-hub:update';
  const DISMISSED_KEY = 'gsc-hub:update-dismissed';

  let update = $state<UpdateState | null>(null);
  let dismissed = $state<string | null>(null);

  const newRelease = $derived(
    // user/updateCheck belong here, not only around the fetch: a cached answer
    // from an earlier session would otherwise surface the banner on the login
    // page and survive UPDATE_CHECK=off.
    user &&
    updateCheck &&
    update?.latest &&
    isNewer(update.latest, version?.release) &&
    dismissed !== update.latest
      ? update.latest
      : null
  );

  function readUpdate(): UpdateState | null {
    try {
      const raw = localStorage.getItem(UPDATE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<UpdateState>;
      if (typeof parsed?.checkedAt !== 'number') return null;
      return {
        checkedAt: parsed.checkedAt,
        latest: typeof parsed.latest === 'string' ? parsed.latest : null
      };
    } catch {
      // Hand-edited or half-written value — treat it as "never checked".
      return null;
    }
  }

  async function checkForUpdate() {
    const previous = update;
    // A failed check still moves the stamp: otherwise every navigation while
    // offline fires another doomed request.
    let next: UpdateState = {
      checkedAt: Date.now(),
      latest: previous?.latest ?? null
    };
    try {
      const res = await fetch(RELEASES_LATEST_URL, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        // Only the tag is kept. The link is built from it and the fixed repo,
        // so nothing the API (or a tampered cache) says can redirect the user.
        const body = (await res.json()) as { tag_name?: unknown };
        next = {
          checkedAt: Date.now(),
          latest: typeof body.tag_name === 'string' ? body.tag_name : null
        };
      }
    } catch {
      // Offline, rate-limited or timed out — keep showing the last known answer.
    }
    update = next;
    try {
      localStorage.setItem(UPDATE_KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked; the check simply repeats next load.
    }
  }

  function dismissUpdate() {
    // Read the tag before touching `dismissed`: newRelease is derived from it,
    // so the assignment below makes newRelease null on the very next read.
    const tag = newRelease;
    if (!tag) return;
    dismissed = tag;
    try {
      localStorage.setItem(DISMISSED_KEY, tag);
    } catch {
      // Nothing to do — the banner returns on the next load.
    }
  }

  // Privacy Blur — one-click blur of PII (emails, domains, metrics) for screenshots/screen-share.
  let blur = $state(false);
  onMount(() => {
    blur = localStorage.getItem('gsc-hub:blur') === '1';
    dismissed = localStorage.getItem(DISMISSED_KEY);
    update = readUpdate();
    // The banner is for signed-in operators only, so an anonymous login page
    // has no reason to reach out to github.com on the visitor's behalf.
    if (!updateCheck || !user || !version) return;
    if (!shouldCheck(update?.checkedAt ?? null, Date.now())) return;
    void checkForUpdate();
  });
  // Высота шапки — в переменную --nav-h: закреплённые строки таблиц встают
  // прямо под ней (шапка бывает в одну или две строки — см. перенос вкладок).
  let navEl = $state<HTMLElement | null>(null);
  $effect(() => {
    if (!navEl || typeof ResizeObserver === 'undefined') return;
    const el = navEl;
    const set = () => document.documentElement.style.setProperty('--nav-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  });
  $effect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('privacy-blur', blur);
    localStorage.setItem('gsc-hub:blur', blur ? '1' : '0');
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{#if newRelease}
  <div class="update-banner">
    <a href={releaseUrl(newRelease)} target="_blank" rel="noopener noreferrer">
      Доступна {newRelease} — что нового
    </a>
    <button type="button" aria-label="Скрыть уведомление" onclick={dismissUpdate}><svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
  </div>
{/if}

{#if user}
  <!-- Вкладки не прячутся (просьба владелицы 12.11.2026): на широком экране шапка
       в одну строку, на узком вкладки переносятся на вторую. На телефоне — прокрутка. -->
  <header bind:this={navEl} class="app-nav sticky top-0 z-30 flex min-h-10 items-center gap-1 border-b border-line bg-pane px-3">
    <a href="/" title="gsc-hub" class="mr-2 flex shrink-0 items-center gap-2 whitespace-nowrap text-[13px] font-bold text-ink sm:mr-3">
      <svg viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true"><rect width="16" height="16" rx="3.5" fill="rgb(var(--acc))"/><path d="M4 11l2.5-3 2 2L12 5" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span class="hidden min-[1700px]:inline">gsc-hub</span>
    </a>
    {#if isAdmin}
      <nav class="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pr-4 [scrollbar-width:none] max-lg:[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] lg:flex-wrap lg:overflow-visible lg:py-1">
        {#each NAV as item (item.href)}
          <a href={item.href} title={item.title} class="nav-link" class:is-active={isActive(item.href)}
            aria-current={isActive(item.href) ? 'page' : undefined}>{item.label}{#if item.href === '/uptime' && data?.uptimeErrors}<span class="ml-1 rounded bg-dn px-1 text-[10px] font-semibold text-white" title="Сайтов с ошибкой">{data.uptimeErrors}</span>{/if}</a>
        {/each}
      </nav>
    {/if}
    <div class="ml-auto flex shrink-0 items-center gap-1.5">
      {#if isAdmin}<HeaderPeriod period={data?.period ?? null} /><ConsolePicker consoles={data?.consoles ?? []} /><GroupPicker groups={data?.siteGroups ?? []} />{/if}
      <button
        type="button"
        class="btn btn-sm {blur ? 'bg-ink text-white hover:bg-ink-2' : 'btn-ghost'}"
        title="Blur emails, domains and metrics for screenshots"
        aria-pressed={blur}
        onclick={() => (blur = !blur)}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
          {#if blur}<path d="M2 2l12 12M6.6 6.6a2 2 0 0 0 2.8 2.8M4.3 4.4C2.8 5.4 1.8 7 1.5 8c.8 2.2 3.3 4.5 6.5 4.5 1.3 0 2.5-.4 3.5-1M7 3.6c.3 0 .7-.1 1-.1 3.2 0 5.7 2.3 6.5 4.5-.3.8-.8 1.6-1.4 2.3"/>
          {:else}<path d="M1.5 8C2.3 5.8 4.8 3.5 8 3.5s5.7 2.3 6.5 4.5c-.8 2.2-3.3 4.5-6.5 4.5S2.3 10.2 1.5 8z"/><circle cx="8" cy="8" r="2"/>{/if}
        </svg>
        <span class="hidden min-[1800px]:inline">Blur</span>
      </button>
      <span class="app-toolbar-divider hidden sm:block" aria-hidden="true"></span>
      <!-- Почта, редкие разделы и «Выйти» — в меню под значком (просьба
           владелицы 12.11.2026: вкладки не помещались в шапку). -->
      <AccountMenu email={user.email} role={user.role} links={isAdmin ? ACCOUNT_LINKS : []} path={page.url.pathname} />
    </div>
  </header>
{/if}

{#if user && isAdmin && data?.period?.key === 'today'}
  <div class="period-note">
    «Сегодня» — по времени Германии, из почасовых данных Google (как «24 часа» в Search Console). Последние несколько часов Google выкладывает с опозданием, поэтому цифры за сегодня растут в течение дня; хаб перепроверяет каждые 10 минут. Счётчик кнопок на ваших сайтах пишет данные сразу.
  </div>
{/if}

{#if user && isAdmin && brokenConsoles.length}
  <div class="console-alert" role="alert">
    {#each brokenConsoles as c (c.id)}
      <p>
        {#if c.status === 'revoked'}
          <b>Google отключил доступ к консоли <span class="pii">{c.label || c.email}</span>.</b>
          {lostAfter(c)} Её сайтов нет в отчётах, пока её не переподключить: <a href="/">Accounts</a> → Connect тем же аккаунтом Google.
        {:else}
          <b>Google ответил ошибкой для консоли <span class="pii">{c.label || c.email}</span>.</b>
          Хаб повторяет запросы сам; если ошибка не уходит, переподключите консоль на странице <a href="/">Accounts</a>.
        {/if}
        {#if c.error}<span class="console-alert__why">Ответ Google: {c.error}</span>{/if}
      </p>
    {/each}
    {#if testingExpiry}
      <p class="console-alert__why">Если консоль отключилась ровно через 7 дней после подключения — её подключали, пока приложение Google было в режиме «Testing». Проверьте, что оно опубликовано (Google Cloud → Google Auth Platform → Audience: «In Produktion»), и переподключите консоль один раз — после этого доступ бессрочный.</p>
    {/if}
  </div>
{/if}

{@render children()}

<footer class="app-footer">
  <span>© 2026 gsc-hub</span>
  {#if version}
    <span aria-hidden="true">·</span>
    <a
      href={releaseUrl(version.release)}
      target="_blank"
      rel="noopener noreferrer"
      title="Что изменилось в этой версии"
    >{version.release}</a>
    {#if version.commit}
      <!-- Dev host: the commit is the working tree's, not the release's. -->
      <span title="Коммит рабочего дерева">· {version.commit}</span>
    {/if}
  {/if}
  <span aria-hidden="true">·</span>
  <a href="https://github.com/izzipizzy/gsc-hub" target="_blank" rel="noopener noreferrer">GitHub</a>
  <span aria-hidden="true">·</span>
  <a href="https://t.me/izzypizzy_seo" target="_blank" rel="noopener noreferrer">Telegram</a>
  <span aria-hidden="true">·</span>
  <a href="https://izzyypizzy.com/" target="_blank" rel="noopener noreferrer">Сайт</a>
</footer>

<style>
  .nav-link {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 8px;
    border-radius: 4px;
    font-size: 12.5px;
    white-space: nowrap;
    color: rgb(var(--ink-2));
    transition: background-color 150ms, color 150ms;
  }
  .nav-link:hover {
    color: rgb(var(--ink));
    background: rgb(var(--bg));
  }
  .nav-link.is-active {
    color: rgb(var(--ink));
    font-weight: 600;
    background: rgb(var(--bg));
  }
</style>
