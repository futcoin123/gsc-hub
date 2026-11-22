<script lang="ts">
  // «Я свой»: страница ссылки для сотрудников. IPv4 панель запомнила при
  // открытии, IPv6 браузер сообщает сам (сайты на Cloudflare видят именно его).
  import { onMount } from 'svelte';
  import { reportIps } from '$lib/team-ip';

  let { data } = $props();
  let ips = $state<string[]>([]);
  let done = $state(false);
  onMount(async () => {
    const got = await reportIps(`/svoi/${encodeURIComponent(data.token)}/ip`);
    ips = [...new Set([...(data.ip ? [data.ip] : []), ...got])];
    done = true;
  });
</script>

<svelte:head><title>Свои визиты · GSC Hub</title><meta name="robots" content="noindex" /></svelte:head>

<main class="page max-w-xl text-sm leading-relaxed text-ink-2">
  <h1 class="app-pagetitle mb-3">Это устройство отмечено своим</h1>
  {#if !done}
    <p class="loading">Узнаю адреса этого устройства…</p>
  {:else if ips.length}
    <p class="mb-2">Ваши визиты на сайты больше не попадают в статистику — ни просмотры, ни время, ни переходы к оплате.</p>
    <p class="mb-2 text-ink-3">Запомнены адреса: <span class="pii font-mono text-ink">{ips.join(', ')}</span>.</p>
  {:else}
    <p class="mb-2 text-bad">Адрес этого устройства узнать не удалось. Обновите страницу; если не поможет — пришлите эту страницу владелице панели.</p>
  {/if}
  <p class="mb-2">Откройте эту ссылку на каждом своём устройстве (телефон, компьютер) — и снова, если сменился интернет: другой Wi-Fi, мобильный.</p>
  <p class="text-ink-3">Входить в панель не нужно. Адрес хранится 30 дней с последнего открытия ссылки.</p>
</main>
