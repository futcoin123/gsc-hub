<script lang="ts">
  // «Кнопки»: сколько раз на ваших сайтах нажали кнопки и отправили форму
  // заказа, рядом с кликами из Google — видно, как шаблон доводит до заказа.
  import { goto } from '$app/navigation';
  import PeriodNote from '$lib/components/PeriodNote.svelte';
  import { enhance } from '$app/forms';
  import SortTh from '$lib/components/SortTh.svelte';
  import { TableSort } from '$lib/table-sort.svelte';
  import { sourceOf, GROUP_LABEL, type SourceGroup } from '$lib/utils/traffic-source';
  import { counterVerdict, type Finding } from '$lib/utils/counter-verdict';

  let { data, form } = $props();
  const KIND: Record<string, string> = { view: 'Просмотр', submit: 'Перешёл к оплате', button: 'Кнопка', out: 'Ссылка на другой сайт', link: 'Обычная ссылка' };
  let copied = $state<string>('');
  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = what;
      setTimeout(() => (copied = ''), 2000);
    } catch {
      /* браузер не дал — пусть скопируют руками */
    }
  }

  // Откуда пришли: входы на сайт (просмотры, у которых счётчик передал
  // источник; переходы внутри сайта не считаются).
  type Src = { key: string; label: string; group: SourceGroup; n: number };
  function sourcesOf(rows: { kind: string; target: string; n: number }[]): Src[] {
    const m = new Map<string, Src>();
    for (const r of rows) {
      if (r.kind !== 'view') continue;
      const src = sourceOf(r.target);
      if (!src) continue;
      const cur = m.get(src.key) ?? m.set(src.key, { ...src, n: 0 }).get(src.key)!;
      cur.n += r.n;
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }
  const allSources = $derived(sourcesOf(data.clicks));
  // Подробно по сайту: входы и переходы к оплате по каждому источнику.
  type SrcRow = Src & { pay: number };
  function sourceRows(host: string): { rows: SrcRow[]; unknownPay: number } {
    const rows = new Map<string, SrcRow>(sourcesOf(data.clicks.filter((r) => r.host === host)).map((x) => [x.key, { ...x, pay: 0 }]));
    let unknownPay = 0;
    for (const c of data.checkoutSources) {
      if (c.host !== host) continue;
      const src = c.source === '(unknown)' ? null : sourceOf(c.source);
      if (!src) { unknownPay += c.n; continue; }
      const row = rows.get(src.key) ?? rows.set(src.key, { ...src, n: 0, pay: 0 }).get(src.key)!;
      row.pay += c.n;
    }
    // Переходы к оплате без записанного источника (в том числе до того, как
    // панель начала их записывать) — чтобы таблица сходилась с колонкой сайта.
    const total = data.clicks.reduce((a, r) => a + (r.host === host && r.kind === 'submit' ? r.n : 0), 0);
    const attributed = [...rows.values()].reduce((a, r) => a + r.pay, 0);
    unknownPay = Math.max(unknownPay, total - attributed);
    return { rows: [...rows.values()].sort((a, b) => b.n - a.n || b.pay - a.pay), unknownPay };
  }
  const allSourcesTotal = $derived(allSources.reduce((a, x) => a + x.n, 0));
  const groupTotals = $derived.by(() => {
    const g = new Map<SourceGroup, number>();
    for (const x of allSources) g.set(x.group, (g.get(x.group) ?? 0) + x.n);
    return [...g.entries()].sort((a, b) => b[1] - a[1]);
  });
  // Сайт уже передаёт источники (новый код счётчика): есть просмотры с target.
  const sendsSources = (h: string) => data.clicks.some((r) => r.host === h && r.kind === 'view' && r.target !== '');
  const share = (n: number, total: number) => (total ? `${Math.round((n / total) * 100)}%` : '—');

  let open = $state<Set<string>>(new Set());
  let withLinks = $state(false);
  const toggle = (h: string) => {
    const n = new Set(open);
    if (n.has(h)) n.delete(h);
    else n.add(h);
    open = n;
  };

  // Bing: данные за период, если Bing уже отдал этот период (он опаздывает на 1–3 дня).
  // Колонки Bing — только когда Bing подключён (ключ на сервере); без ключа их нет.
  const showBing = $derived(data.bingState !== 'off');
  const bingCovers = $derived(data.bingState === 'ok' && !!data.bingLatest && data.period.startDate <= data.bingLatest);
  const bingOf = (h: string) => (bingCovers ? (data.bing[h] ?? null) : null);
  const bingWhy = (h: string) =>
    data.bingState === 'off' ? 'Bing не подключён: на сервере хаба не задан ключ BING_API_KEY (Bing Webmaster → Settings → API access)'
    : data.bingState === 'loading' ? 'Данные Bing загружаются — обновите страницу через минуту'
    : !bingCovers ? `Bing отдаёт данные с опозданием на 1–3 дня; последний день у Bing — ${data.bingLatest ? fmtDay(data.bingLatest) : '—'}`
    : !data.bing[h] ? 'Сайта нет в Bing Webmaster' : '';
  // Входы по источникам (счётчик на сайте): Google, Bing, другие поисковики,
  // ИИ-помощники, прямые заходы, прочее (соцсети, другие сайты, метки).
  // null — счётчик сайта источник не передаёт.
  type Src6 = { g: number; b: number; s: number; ai: number; d: number; o: number };
  const SRC_COLS: [keyof Src6, string, string][] = [
    ['g', 'Из Google', 'Входы на сайт из поиска Google — по счётчику на сайте (переходы внутри сайта не считаются)'],
    ['b', 'Из Bing', 'Входы на сайт из Bing — по счётчику на сайте'],
    ['s', 'Др. поиск', 'Входы из других поисковиков: Яндекс, DuckDuckGo, Yahoo, Ecosia…'],
    ['ai', 'Из ИИ', 'Входы из ИИ-помощников: ChatGPT, Perplexity, Gemini, Copilot, Claude (в том числе по их метке utm_source)'],
    ['d', 'Прямые', 'Без адреса, откуда пришли: набрали адрес, закладка, приложение, мессенджер'],
    ['o', 'Прочее', 'Соцсети, другие сайты и ссылки с метками utm']
  ];
  type Site = { host: string; impr: number; gsc: number; src: Src6 | null; bImpr: number | null; bClicks: number | null; views: number; seconds: number; avg: number | null; buttons: number; submits: number; rateSubmit: number | null; rateButton: number | null; visits: number; bounces: number; bounce: number | null };
  const sitesRaw = $derived.by(() => {
    const m = new Map<string, Site>();
    const get = (h: string) => m.get(h) ?? (m.set(h, { host: h, impr: data.gscImpr[h] ?? 0, gsc: data.gsc[h] ?? 0, src: null, bImpr: bingOf(h)?.impressions ?? null, bClicks: bingOf(h)?.clicks ?? null, views: 0, seconds: 0, avg: null, buttons: 0, submits: 0, rateSubmit: null, rateButton: null, visits: data.visits[h]?.visits ?? 0, bounces: data.visits[h]?.bounces ?? 0, bounce: data.visits[h]?.visits ? data.visits[h].bounces / data.visits[h].visits : null }), m.get(h)!);
    for (const r of data.clicks) {
      const s = get(r.host);
      if (r.kind === 'view' && r.target !== '') {
        const src = sourceOf(r.target);
        s.src ??= { g: 0, b: 0, s: 0, ai: 0, d: 0, o: 0 };
        if (src) {
          const col: keyof Src6 = src.key === 'Google' ? 'g' : src.key === 'Bing' ? 'b' : src.group === 'search' ? 's' : src.group === 'ai' ? 'ai' : src.group === 'direct' ? 'd' : 'o';
          s.src[col] += r.n;
        }
      }
      if (r.kind === 'view') s.views += r.n;
      else if (r.kind === 'submit') s.submits += r.n;
      else if (r.kind === 'button' || r.kind === 'out') s.buttons += r.n;
    }
    for (const h of data.hosts) get(h);
    for (const t of data.time) get(t.host).seconds += t.seconds;
    for (const s of m.values()) {
      s.avg = s.views ? s.seconds / s.views : null;
      s.rateSubmit = s.views ? s.submits / s.views : null;
      s.rateButton = s.views ? s.buttons / s.views : null;
    }
    return [...m.values()];
  });
  type K = 'host' | 'impr' | 'gsc' | 'bImpr' | 'bClicks' | 'views' | 'src_g' | 'src_b' | 'src_s' | 'src_ai' | 'src_d' | 'src_o' | 'avg' | 'bounce' | 'buttons' | 'submits' | 'rateButton' | 'rateSubmit';
  // По умолчанию — по переходам к оплате, от больших к меньшим (просьба владелицы
  // 10.11.2026); при равных переходах — по кликам из Google.
  const sort = new TableSort<K>('submits', -1, ['impr', 'gsc', 'bImpr', 'bClicks', 'views', 'src_g', 'src_b', 'src_s', 'src_ai', 'src_d', 'src_o', 'avg', 'bounce', 'buttons', 'submits', 'rateButton', 'rateSubmit']);
  const byGsc = $derived([...sitesRaw].sort((a, b) => (b.gsc ?? -1) - (a.gsc ?? -1)));
  const sites = $derived(sort.apply(byGsc, (s, k) => (k.startsWith('src_') ? (s.src ? s.src[k.slice(4) as keyof Src6] : null) : s[k as Exclude<K, `src_${string}`>])));

  type DK = 'label' | 'kind' | 'page' | 'target' | 'n';
  const dsort = new TableSort<DK>('n', -1, ['n']);
  const detail = (h: string) => dsort.apply(data.clicks.filter((r) => r.host === h && r.kind !== 'view' && (withLinks || r.kind !== 'link')), (r, k) => r[k]);

  // По страницам сайта: просмотры, среднее время, нажатия, заказы.
  type Page = { page: string; views: number; avg: number | null; buttons: number; submits: number };
  type PK = 'page' | 'views' | 'avg' | 'buttons' | 'submits';
  const psort = new TableSort<PK>('views', -1, ['views', 'avg', 'buttons', 'submits']);
  function pagesOf(h: string): Page[] {
    const m = new Map<string, Page & { seconds: number }>();
    const get = (p: string) => m.get(p) ?? (m.set(p, { page: p, views: 0, avg: null, buttons: 0, submits: 0, seconds: 0 }), m.get(p)!);
    for (const r of data.clicks) {
      if (r.host !== h) continue;
      const p = get(r.page);
      if (r.kind === 'view') p.views += r.n;
      else if (r.kind === 'submit') p.submits += r.n;
      else if (r.kind === 'button' || r.kind === 'out') p.buttons += r.n;
    }
    for (const t of data.time) if (t.host === h) get(t.page).seconds += t.seconds;
    for (const p of m.values()) p.avg = p.views ? p.seconds / p.views : null;
    return psort.apply([...m.values()], (p, k) => p[k]);
  }
  /** 75 → «1 мин 15 с» */
  const dur = (sec: number | null) => {
    if (sec === null) return '—';
    const s = Math.round(sec);
    return s < 60 ? `${s} с` : `${Math.floor(s / 60)} мин ${s % 60} с`;
  };
  const fmt = (n: number) => n.toLocaleString('ru-RU');
  const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
  const fmtDay = (iso: string) => iso.split('-').reverse().join('.');
  // «Проверка счётчиков»: вывод по журналу приёма событий за 7 дней (см. counter-verdict.ts).
  const fmtTs = (ts: number) => new Date(ts).toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const LEVEL_RANK: Record<Finding['level'], number> = { bad: 0, warn: 1, wait: 2, ok: 3 };
  const checks = $derived.by(() =>
    data.hosts
      .map((h: string) => {
        const rows = data.counterLog[h] ?? [];
        // Журнал ведётся с обновления панели: пусто, но события раньше были — не «сломано».
        const f: Finding[] = !rows.length && data.lastSeen[h]
          ? [{ level: 'wait', text: `С начала журнала (${data.counterLogStart ? fmtDay(data.counterLogStart) : 'сегодня'}) на сайт ещё никто не заходил — ждём посетителей. Раньше события были (последнее ${fmtDay(data.lastSeen[h])}). Связь можно проверить кнопкой «Проверить сайт» ниже.` }]
          : counterVerdict(rows, fmtTs);
        return { h, f, rank: Math.min(...f.map((x) => LEVEL_RANK[x.level])) };
      })
      .sort((a: { rank: number; h: string }, b: { rank: number; h: string }) => a.rank - b.rank || a.h.localeCompare(b.h))
  );
  const checkOf = (h: string) => checks.find((c: { h: string }) => c.h === h);
  // Единый счётчик: файлы для сайта и проверка связи сайт → панель.
  let kitHost = $state('');
  let kitEvents = $state('');
  let kit = $state<{ host: string; events: string; version: string; page: string; module: string } | null>(null);
  let kitErr = $state<string | null>(null);
  let ping = $state<{ step: string; target: string; status?: number; detail?: string } | null>(null);
  let pingBusy = $state(false);
  const kitQuery = () => `h=${encodeURIComponent(kitHost)}${kitEvents.trim() ? `&e=${encodeURIComponent(kitEvents.trim())}` : ''}`;
  async function loadKit() {
    kitErr = null;
    kit = null;
    if (!kitHost) return;
    const r = await fetch(`/clicks/kit?${kitQuery()}`);
    if (!r.ok) {
      kitErr = (await r.json().catch(() => ({})))?.message ?? `HTTP ${r.status}`;
      return;
    }
    kit = await r.json();
  }
  const PING_TEXT: Record<string, string> = {
    ok: 'Работает: сайт отвечает, ключ на месте, проверка дошла до панели и принята.',
    unreachable: 'Сайт не ответил на адрес событий.',
    'no-kit': 'На сайте не стоит единый счётчик (адрес событий отвечает, но не им) — или адрес событий указан не тот.',
    'no-key': 'Счётчик стоит, но в Cloudflare Pages нет секрета COUNTER_KEY — сайт ничего не отправляет.',
    'bad-key': 'Сайт отправил проверку, но панель её отбросила: ключ сайта не подходит. Обновите секрет COUNTER_KEY.',
    'no-arrival': 'Сайт принял проверку, но в панель она не пришла за 10 секунд. Повторите через 10–20 секунд; если снова — сайт не может достучаться до панели.'
  };
  async function runPing() {
    if (!kitHost) return;
    pingBusy = true;
    ping = null;
    try {
      const r = await fetch('/clicks/ping', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ h: kitHost, e: kitEvents.trim() || kit?.events }) });
      ping = r.ok ? await r.json() : { step: 'unreachable', target: '', detail: `HTTP ${r.status}` };
    } finally {
      pingBusy = false;
    }
  }
  const checksBad = $derived(checks.filter((c: { rank: number }) => c.rank < 2).length);
  const checksWait = $derived(checks.filter((c: { rank: number }) => c.rank === 2).length);
  const periodLabel = $derived(data.period.startDate === data.period.endDate ? fmtDay(data.period.startDate) : `${fmtDay(data.period.startDate)} – ${fmtDay(data.period.endDate)}`);
  // Итого по всем сайтам в таблице: суммы, а среднее время и доли — по всем вместе.
  const totals = $derived(
    sitesRaw.reduce(
      (a, s) => ({
        n: a.n + 1, impr: a.impr + s.impr, gsc: a.gsc + s.gsc, bImpr: a.bImpr + (s.bImpr ?? 0), bClicks: a.bClicks + (s.bClicks ?? 0), v: a.v + s.views, sec: a.sec + s.seconds, b: a.b + s.buttons, s: a.s + s.submits,
        src: { g: a.src.g + (s.src?.g ?? 0), b: a.src.b + (s.src?.b ?? 0), s: a.src.s + (s.src?.s ?? 0), ai: a.src.ai + (s.src?.ai ?? 0), d: a.src.d + (s.src?.d ?? 0), o: a.src.o + (s.src?.o ?? 0) },
        withSrc: a.withSrc + (s.src ? 1 : 0),
        vis: a.vis + s.visits,
        bnc: a.bnc + s.bounces
      }),
      { n: 0, impr: 0, gsc: 0, bImpr: 0, bClicks: 0, v: 0, sec: 0, b: 0, s: 0, src: { g: 0, b: 0, s: 0, ai: 0, d: 0, o: 0 } as Src6, withSrc: 0, vis: 0, bnc: 0 }
    )
  );
  const sitesWord = (n: number) => {
    const d = n % 10, h = n % 100;
    return d === 1 && h !== 11 ? 'сайт' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'сайта' : 'сайтов';
  };
</script>

<svelte:head><title>Кнопки · GSC Hub</title></svelte:head>

<div class="desk is-sticky-host">
  <section class="pane">
    <details class="border-b border-line" open={Object.keys(data.lastSeen).length === 0}>
      <summary class="cursor-pointer px-3 py-2 text-sm font-semibold">Ключ счётчика</summary>
      <div class="space-y-2 px-3 pb-3 text-sm text-ink-2">
        <p>
          Счётчик на сайт ставится <b>единым</b> — блок «Единый счётчик» ниже: файлы для сайта и «Проверить сайт» (правило сети с
          13.11.2026). Cloudflare Worker и самодельные счётчики больше не ставить. Здесь — ключ, которым сайты подписывают события: один
          на все сайты, кладётся секретом <code>COUNTER_KEY</code> в репозиторий сайта на GitHub. Новый ключ не ломает сайты: старые
          принимаются, пока их не отозвать.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn btn-pri btn-sm" onclick={() => copy(data.counterKey, 'key')}>{copied === 'key' ? 'Скопировано ✓' : 'Копировать ключ'}</button>
          <form method="POST" action="?/rotateKey" use:enhance={({ cancel }) => { if (!confirm('Выдать новый ключ? Старые ключи продолжат работать, пока вы их не отзовёте — сайты не сломаются.')) cancel(); }}>
            <button class="btn btn-ghost btn-sm">Новый ключ</button>
          </form>
        </div>
        {#if form?.rotated}<p class="text-xs text-emerald-700">Новый ключ выдан — ставьте его на новые сайты. Старые ключи продолжают работать.</p>{/if}
        {#if form?.keyError}<p class="text-xs text-bad">{form.keyError}</p>{/if}
        {#if data.keys.length}
          <div class="text-xs">
            <div class="mb-1 font-semibold text-ink-2">Ключи (принимается любой не отозванный)</div>
            <table class="app-table rounded border border-line bg-pane">
              <thead><tr><th>Ключ</th><th>Выдан</th><th>Последний раз</th><th>С каких сайтов приходит</th><th></th></tr></thead>
              <tbody>
                {#each data.keys as k (k.hash)}
                  <tr class={k.revokedAt ? 'opacity-50' : ''}>
                    <td class="whitespace-nowrap font-mono">{k.prefix}…{#if k.current} <span class="badge badge-ok">текущий</span>{/if}{#if k.revokedAt} <span class="badge badge-bad">отозван</span>{/if}</td>
                    <td class="whitespace-nowrap">{new Date(k.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                    <td class="whitespace-nowrap">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                    <td class="pii">{k.hosts.join(', ') || '—'}</td>
                    <td class="text-right">
                      {#if !k.current && !k.revokedAt}
                        <form method="POST" action="?/revokeKey" use:enhance={({ cancel }) => { if (!confirm(k.hosts.length ? `Отозвать ключ ${k.prefix}…? Перестанут считать: ${k.hosts.join(', ')} — им нужно будет поставить текущий ключ.` : `Отозвать ключ ${k.prefix}…?`)) cancel(); }}>
                          <input type="hidden" name="hash" value={k.hash} />
                          <button class="btn btn-ghost btn-sm text-bad" title="Если ключ утёк">Отозвать</button>
                        </form>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        <ul class="ml-5 list-disc text-xs text-ink-3">
          <li>Просмотры и время считаются только у настоящих браузеров; боты и проверялки отсеиваются. Время — только пока страница видна на экране.</li>
          <li>«Перешли к оплате» — нажали кнопку заказа и реально ушли на оплату / к партнёру; записывается на ту страницу, где нажали. Нажатие, после которого сайт не пустил дальше (например, сумма меньше минимума), не считается.</li><li>«Другие кнопки» — остальные кнопки и ссылки (например, «Order coins» в шапке, ссылки на другие сайты).</li>
          <li>Чтобы кнопка считалась под своим именем, можно добавить ей <code>data-track="Название"</code>. Без cookie и личных данных.</li>
        </ul>
        {#if Object.keys(data.lastSeen).length}
          <p class="text-xs">Данные приходят с: {#each Object.entries(data.lastSeen) as [h, d], i (h)}{i ? ', ' : ''}<span class="pii">{h}</span> <span class="text-ink-4">(последнее {fmtDay(d)})</span>{/each}</p>
        {/if}
      </div>
    </details>

    <div class="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
      <h1 class="text-base font-semibold">Кнопки</h1>
      <PeriodNote start={data.period.startDate} end={data.period.endDate} />
      <span class="text-xs text-ink-3">{periodLabel}</span>
      <span class="text-xs text-ink-3">· {fmt(totals.n)} {sitesWord(totals.n)} · показов в Google {fmt(totals.impr)} · кликов из Google {fmt(totals.gsc)}{bingCovers ? ` · кликов из Bing ${fmt(totals.bClicks)}` : ''} · просмотров {fmt(totals.v)} · других кнопок {fmt(totals.b)} · перешли к оплате {fmt(totals.s)}</span>
      {#if data.bingState === 'loading'}<span class="text-xs text-ink-3">· Bing загружается</span>{:else if data.bingLatest && data.period.endDate > data.bingLatest}<span class="text-xs text-ink-3" title="Bing выкладывает данные с опозданием на 1–3 дня">· Bing — данные по {fmtDay(data.bingLatest)}</span>{/if}
      <label class="ml-auto flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" bind:checked={withLinks} /> показывать и обычные ссылки</label>
    </div>

    {#if allSourcesTotal}
      <div class="border-b border-line px-3 py-2 text-xs text-ink-2">
        <span class="font-semibold text-ink">Откуда пришли</span>
        <span class="text-ink-3">· входов на сайты {fmt(allSourcesTotal)}:</span>
        {#each groupTotals as [g, n] (g)}<span class="ml-2 whitespace-nowrap">{GROUP_LABEL[g]} <b class="app-num">{fmt(n)}</b> <span class="text-ink-3">({share(n, allSourcesTotal)})</span></span>{/each}
        <div class="mt-1 text-ink-3">
          {#each allSources.slice(0, 12) as x (x.key)}<span class="mr-3 whitespace-nowrap">{x.label} <span class="app-num text-ink-2">{fmt(x.n)}</span></span>{/each}
        </div>
      </div>
    {/if}

    {#if checks.length}
      <!-- Проверка счётчиков: что панель получила от каждого сайта и что отбросила, с причиной. -->
      <details class="border-b border-line" open={checksBad > 0}>
        <summary class="cursor-pointer select-none px-3 py-2 text-xs hover:bg-sunk">
          <span class="font-semibold text-ink">Проверка счётчиков</span>
          <span class="text-ink-3">· за 7 дней · работает {checks.length - checksBad - checksWait} из {checks.length}{checksWait ? ` · ждём посетителей ${checksWait}` : ''}</span>
          {#if checksBad}<span class="badge badge-warn ml-1">проблемы у {checksBad}</span>{/if}
        </summary>
        <div class="px-3 pb-3">
          <p class="mb-2 text-xs text-ink-3">
            Что панель получила от счётчика каждого сайта и что отбросила — с причиной. Журнал ведётся с {data.counterLogStart ? fmtDay(data.counterLogStart) : 'этого обновления панели'}:
            сайты, на которые с тех пор никто не заходил, появятся здесь с первыми посетителями.
          </p>
          <table class="app-table rounded border border-line bg-pane">
            <thead><tr><th>Сайт</th><th>Состояние</th><th>Что видит панель</th></tr></thead>
            <tbody>
              {#each checks as c (c.h)}
                <tr>
                  <td class="pii whitespace-nowrap font-medium text-ink">{c.h}</td>
                  <td class="whitespace-nowrap"><span class="badge {c.rank === 0 ? 'badge-bad' : c.rank === 1 ? 'badge-warn' : c.rank === 2 ? 'badge-muted' : 'badge-ok'}">{c.rank === 0 ? 'не работает' : c.rank === 1 ? 'частично' : c.rank === 2 ? 'ждём посетителей' : 'работает'}</span></td>
                  <td class="text-xs text-ink-2">{#each c.f as f, i (i)}<div>{f.text}</div>{/each}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    {/if}

    <!-- Единый счётчик: один код на все сайты, у каждого свои имена; ставится и проверяется отсюда. -->
    <details class="border-b border-line">
      <summary class="cursor-pointer select-none px-3 py-2 text-xs hover:bg-sunk">
        <span class="font-semibold text-ink">Единый счётчик</span>
        <span class="text-ink-3">· файлы для сайта и проверка связи сайт → панель</span>
      </summary>
      <div class="px-3 pb-3 text-xs text-ink-2">
        <p class="mb-2 max-w-4xl">
          Один и тот же счётчик для всех сайтов: просмотры с источником (Google, Bing, ИИ, прямые…), время на странице, нажатия и
          переход к оплате. У каждого сайта свои имена переменных, полей и свой адрес событий — снаружи сайты не связать. В браузер
          ничего не пишется; вместо IP — код посетителя, один и тот же у человека весь день (отказы и источник оплаты считаются верно).
        </p>
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <select class="pii input h-7 w-auto text-xs" bind:value={kitHost} onchange={() => { kit = null; ping = null; }} aria-label="Сайт">
            <option value="">— сайт —</option>
            {#each data.hosts as h (h)}<option value={h}>{h}</option>{/each}
          </select>
          <input class="input h-7 w-44 text-xs" bind:value={kitEvents} placeholder="адрес событий, напр. /segnale/" aria-label="Адрес событий на сайте" title="Свой адрес сайта для событий счётчика, словом языка сайта. Пусто — панель придумает сама" />
          <button type="button" class="btn btn-sec btn-sm" disabled={!kitHost} onclick={loadKit}>Показать код</button>
          <button type="button" class="btn btn-pri btn-sm" disabled={!kitHost || pingBusy} onclick={runPing}>{pingBusy ? 'Проверяю…' : 'Проверить сайт'}</button>
        </div>
        {#if kitErr}<p class="mb-2 text-bad">{kitErr}</p>{/if}
        {#if ping}
          <p class="mb-2 rounded border px-2 py-1.5 {ping.step === 'ok' ? 'border-up/40 bg-up/10 text-ink' : 'border-warn bg-warn-t text-ink'}">
            <span class="font-semibold">{ping.step === 'ok' ? 'Работает.' : 'Не работает.'}</span> {PING_TEXT[ping.step] ?? ping.step}
            {#if ping.target}<span class="pii text-ink-3"> · {ping.target}{ping.status ? ` · ответ ${ping.status}` : ''}{ping.detail ? ` · ${ping.detail}` : ''}</span>{/if}
          </p>
        {/if}
        {#if kit}
          <ol class="mb-2 ml-4 list-decimal space-y-0.5">
            <li>Код страницы — в конец общего JS сайта (файла, который есть на каждой странице). Он шлёт события на <code class="pii">{kit.events}</code>.</li>
            <li><code>gsc-counter.js</code> — в корень репозитория; в <code>functions/_middleware.js</code>: <code>import {'{'} gscCounter {'}'} from '../gsc-counter.js';</code> и <code>export const onRequest = [gscCounter, …свой middleware…];</code> (своего нет — <code>export {'{'} onRequest {'}'} from '../gsc-counter.js';</code>). Если у сайта есть <code>_routes.json</code> — добавить в него <code class="pii">{kit.events}</code> и адрес перехода к кассе.</li>
            <li>Секрет Cloudflare Pages <code>COUNTER_KEY</code> — тот же ключ, что везде.</li>
            <li>Старый счётчик сайта убрать целиком (код на странице, пересылку и подсчёт перехода к оплате) — иначе посчитает дважды.</li>
            <li>Выложить и нажать «Проверить сайт».</li>
          </ol>
          <div class="grid gap-2 lg:grid-cols-2">
            {#each [['Код страницы', kit.page, 'page'], ['gsc-counter.js (сервер)', kit.module, 'module']] as [title, code, f] (f)}
              <div>
                <div class="mb-1 flex items-center gap-2">
                  <span class="font-semibold text-ink">{title}</span>
                  <button type="button" class="btn btn-ghost btn-sm" onclick={() => copy(code, f)}>{copied === f ? 'Скопировано ✓' : 'Копировать'}</button>
                  <a class="btn btn-ghost btn-sm" href="/clicks/kit?{kitQuery()}&f={f}">Скачать</a>
                </div>
                <textarea readonly class="pii input h-40 w-full py-1 font-mono text-[11px]">{code}</textarea>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </details>

    {#if sites.length === 0}
      <p class="p-3 text-ink-3">В выбранных консолях нет сайтов. Отметьте консоль в шапке («Консоли»).</p>
    {:else}
      <!-- Названия колонок и «Итого» прилипают под шапкой панели при прокрутке
           страницы (--nav-h — её высота). Таблица — по ширине экрана (is-fit). -->
      <div>
        <table class="app-table is-roomy is-fit">
          <thead class="sticky z-10" style="top: var(--nav-h, 40px)">
            <tr>
              <SortTh {sort} k="host" label="Сайт" />
              <SortTh {sort} k="impr" label="Показы в Google" num title="Search Console за тот же период: сколько раз сайт показали в поиске" />
              <SortTh {sort} k="gsc" label="Клики из Google" num title="Search Console за тот же период" />
              {#if showBing}
                <SortTh {sort} k="bImpr" label="Показы в Bing" num title="Bing Webmaster за тот же период (Bing выкладывает данные с опозданием на 1–3 дня)" />
                <SortTh {sort} k="bClicks" label="Клики из Bing" num title="Bing Webmaster за тот же период (Bing выкладывает данные с опозданием на 1–3 дня)" />
              {/if}
              <SortTh {sort} k="views" label="Просмотры страниц" num title="Сколько раз открыли страницы сайта: каждое открытие страницы — один просмотр, в том числе переход на другую страницу сайта, обновление и «Назад». Боты не считаются. Входы на сайт (откуда пришли) — в колонках справа, остальное — переходы внутри сайта" />
              {#each SRC_COLS as [c, label, title] (c)}<SortTh {sort} k={`src_${c}` as K} {label} num {title} />{/each}
              <SortTh {sort} k="avg" label="Среднее время" num title="Сколько в среднем страница была открыта на экране (свёрнутая вкладка не считается)" />
              <SortTh {sort} k="bounce" label="Отказы" num title="Bounce rate: доля визитов, в которых посетитель открыл одну страницу и ничего не нажал (ни второй страницы, ни кнопки, ни ссылки) и ушёл. Визит — вход на сайт и всё, что было дальше без перерыва в 30 минут. Только сайты, чей счётчик передаёт, откуда пришёл посетитель; считается с 12.11.2026" />
              <SortTh {sort} k="buttons" label="Другие кнопки" num title="Нажатия кнопок и ссылок, после которых заказа ещё нет: «Order coins» в шапке, ссылки на другие сайты" />
              <SortTh {sort} k="rateButton" label="% от просмотров" num title="Другие кнопки / просмотры страниц" />
              <SortTh {sort} k="submits" label="Перешли к оплате" num title="Нажали кнопку заказа («Continue to checkout», «Afrekenen»…) и реально ушли на оплату / к партнёру. Если сайт не пустил (например, сумма мала) — не считается" />
              <SortTh {sort} k="rateSubmit" label="% от просмотров" num title="Перешли к оплате / просмотры страниц" />
            </tr>
            <!-- Итого — первой строкой и своим цветом, чтобы не путать с сайтами -->
            <tr class="is-total" title="Сумма по всем сайтам в таблице; среднее время и доли — по всем сайтам вместе">
              <td class="whitespace-nowrap text-acc">Итого: {fmt(totals.n)} {sitesWord(totals.n)}</td>
              <td class="num app-num">{fmt(totals.impr)}</td>
              <td class="num app-num">{fmt(totals.gsc)}</td>
              {#if showBing}
                <td class="num app-num" title={bingCovers ? '' : bingWhy('')}>{bingCovers ? fmt(totals.bImpr) : '—'}</td>
                <td class="num app-num" title={bingCovers ? '' : bingWhy('')}>{bingCovers ? fmt(totals.bClicks) : '—'}</td>
              {/if}
              <td class="num app-num">{fmt(totals.v)}</td>
              {#each SRC_COLS as [c] (c)}<td class="num app-num" title={totals.withSrc < totals.n ? `Только сайты, чей счётчик передаёт источник: ${totals.withSrc} из ${totals.n}` : ''}>{totals.withSrc ? fmt(totals.src[c]) : '—'}</td>{/each}
              <td class="num app-num">{dur(totals.v ? totals.sec / totals.v : null)}</td>
              <td class="num app-num" title={totals.vis ? `Визитов ${totals.vis}, из них отказов ${totals.bnc}` : ''}>{totals.vis ? pct(totals.bnc / totals.vis) : '—'}</td>
              <td class="num app-num">{fmt(totals.b)}</td>
              <td class="num app-num">{pct(totals.v ? totals.b / totals.v : null)}</td>
              <td class="num app-num">{fmt(totals.s)}</td>
              <td class="num app-num">{pct(totals.v ? totals.s / totals.v : null)}</td>
            </tr>
          </thead>
          <tbody>
            {#each sites as s, i (s.host)}
              <tr class="is-site cursor-pointer" class:is-alt={i % 2 === 1} class:is-selected={open.has(s.host)} onclick={() => toggle(s.host)}>
                <td class="pii font-semibold text-ink">
                  <span class="flex items-center gap-1">
                    <svg viewBox="0 0 16 16" class="h-3 w-3 shrink-0 text-ink-4 transition-transform {open.has(s.host) ? 'rotate-90' : ''}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
                    {s.host}
                    <a class="inline-flex rounded p-0.5 text-ink-4 hover:bg-sunk hover:text-acc" href="https://{s.host}/" target="_blank" rel="noopener noreferrer" title="Перейти на сайт (в новой вкладке)" aria-label="Перейти на сайт {s.host}" onclick={(e) => e.stopPropagation()}><svg viewBox="0 0 16 16" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3.5h3.5V7M12.5 3.5 7 9"/></svg></a>
                    {#if !data.lastSeen[s.host]}<span class="badge badge-muted ml-1 whitespace-nowrap font-normal" title={(checkOf(s.host)?.f ?? []).map((f: Finding) => f.text).join(' ') || 'От сайта ещё не записано ни одного события'}>{(data.counterLog[s.host] ?? []).length ? 'события отброшены' : 'нет событий'}</span>{/if}
                    {#if data.noConsole.includes(s.host)}<span class="badge badge-warn ml-1 whitespace-nowrap font-normal" title="Счётчик работает. Показов и кликов Google нет: консоль этого сайта отключена или Google не ответил — см. плашку вверху и страницу Accounts">нет консоли Google</span>{/if}
                  </span>
                </td>
                {#if data.gscErr[s.host]}
                  <td class="num app-num text-dn" colspan="2" title={data.gscErr[s.host]}>ошибка Google</td>
                {:else}
                  <td class="num app-num">{data.noConsole.includes(s.host) ? '—' : fmt(s.impr)}</td>
                  <td class="num app-num">{data.noConsole.includes(s.host) ? '—' : fmt(s.gsc)}</td>
                {/if}
                {#if showBing}
                  <td class="num app-num" title={s.bImpr === null ? bingWhy(s.host) : ''}>{s.bImpr === null ? '—' : fmt(s.bImpr)}</td>
                  <td class="num app-num" title={s.bClicks === null ? bingWhy(s.host) : ''}>{s.bClicks === null ? '—' : fmt(s.bClicks)}</td>
                {/if}
                <td class="num app-num">{fmt(s.views)}</td>
                {#each SRC_COLS as [c] (c)}
                  {#if s.src}<td class="num app-num {s.src[c] ? '' : 'text-ink-4'}">{fmt(s.src[c])}</td>
                  {:else}<td class="num text-ink-4" title="Счётчик этого сайта не передаёт, откуда пришёл посетитель">—</td>{/if}
                {/each}
                <td class="num app-num">{dur(s.avg)}</td>
                <td class="num app-num" title={s.visits ? `Визитов ${s.visits}, из них отказов ${s.bounces}` : 'Нет данных: счётчик сайта не передаёт, откуда пришёл посетитель, или визитов ещё не было'}>{s.bounce === null ? '—' : pct(s.bounce)}</td>
                <td class="num app-num">{fmt(s.buttons)}</td>
                <td class="num app-num">{pct(s.rateButton)}</td>
                <td class="num app-num font-semibold">{fmt(s.submits)}</td>
                <td class="num app-num">{pct(s.rateSubmit)}</td>
              </tr>
              {#if open.has(s.host)}
                {@const list = detail(s.host)}
                {@const pages = pagesOf(s.host)}
                {@const sr = sourceRows(s.host)}
                {@const srcs = sr.rows}
                {@const srcTotal = srcs.reduce((a, x) => a + x.n, 0)}
                <tr class="bg-sunk hover:bg-sunk">
                  <td colspan={(showBing ? 12 : 10) + SRC_COLS.length} class="px-3 py-2">
                    <div class="mb-1 text-xs font-semibold text-ink-2">Откуда пришли <span class="font-normal text-ink-3">— входы на сайт (переходы внутри сайта не считаются) и сколько из них перешли к оплате</span></div>
                    {#if srcs.length || sr.unknownPay}
                      <table class="app-table mb-3 rounded border border-line bg-pane">
                        <thead>
                          <tr><th>Источник</th><th>Что это</th><th class="num">Входов</th><th class="num">Доля</th><th class="num" title="Переходы к оплате посетителей, пришедших из этого источника (тот же посетитель в течение 30 минут после входа)">Перешли к оплате</th><th class="num">% от входов</th></tr>
                        </thead>
                        <tbody>
                          {#each srcs as x (x.key)}
                            <tr>
                              <td class="pii font-medium">{x.label}</td>
                              <td class="text-xs text-ink-3">{GROUP_LABEL[x.group]}</td>
                              <td class="num app-num">{fmt(x.n)}</td>
                              <td class="num app-num">{share(x.n, srcTotal)}</td>
                              <td class="num app-num {x.pay ? 'font-semibold' : 'text-ink-4'}">{fmt(x.pay)}</td>
                              <td class="num app-num">{x.n ? share(x.pay, x.n) : '—'}</td>
                            </tr>
                          {/each}
                          {#if sr.unknownPay}
                            <tr>
                              <td class="font-medium text-ink-3">Источник неизвестен</td>
                              <td class="text-xs text-ink-3" colspan="3" title="Источник переходов к оплате панель записывает с 06.11.2026 15:07. Неизвестен он и тогда, когда вход посетителя был больше 30 минут назад, счётчик сайта не передаёт источник или на страницу заказа зашли напрямую">откуда пришли, не видно: переход был до 06.11 15:07 или вход не найден</td>
                              <td class="num app-num font-semibold">{fmt(sr.unknownPay)}</td>
                              <td class="num">—</td>
                            </tr>
                          {/if}
                        </tbody>
                      </table>
                    {:else if sendsSources(s.host)}
                      <p class="mb-3 text-xs text-ink-3">За этот период входов нет.</p>
                    {:else}
                      <p class="mb-3 text-xs text-ink-3">Счётчик этого сайта не передаёт источник. Поставьте на сайт единый счётчик — блок «Единый счётчик» вверху страницы.</p>
                    {/if}
                    {#if pages.length}
                      <div class="mb-1 text-xs font-semibold text-ink-2">Страницы</div>
                      <table class="app-table mb-3 rounded border border-line bg-pane">
                        <thead>
                          <tr>
                            <SortTh sort={psort} k="page" label="Страница" />
                            <SortTh sort={psort} k="views" label="Просмотры" num />
                            <SortTh sort={psort} k="avg" label="Среднее время" num />
                            <SortTh sort={psort} k="buttons" label="Другие кнопки" num />
                            <SortTh sort={psort} k="submits" label="Перешли к оплате" num />
                          </tr>
                        </thead>
                        <tbody>
                          {#each pages as pg (pg.page)}
                            <tr>
                              <td class="pii text-xs"><a class="hover:text-acc hover:underline" href="https://{s.host}{pg.page}" target="_blank" rel="noopener noreferrer">{pg.page}</a></td>
                              <td class="num app-num">{fmt(pg.views)}</td>
                              <td class="num app-num">{dur(pg.avg)}</td>
                              <td class="num app-num">{fmt(pg.buttons)}</td>
                              <td class="num app-num font-semibold">{fmt(pg.submits)}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                      <div class="mb-1 text-xs font-semibold text-ink-2">Кнопки и ссылки</div>
                    {/if}
                    {#if list.length === 0}
                      <p class="text-xs text-ink-3">За этот период нажатий нет.</p>
                    {:else}
                      <table class="app-table rounded border border-line bg-pane">
                        <thead>
                          <tr>
                            <SortTh sort={dsort} k="label" label="Кнопка / текст" />
                            <SortTh sort={dsort} k="kind" label="Что это" />
                            <SortTh sort={dsort} k="page" label="На какой странице" />
                            <SortTh sort={dsort} k="target" label="Куда ведёт" />
                            <SortTh sort={dsort} k="n" label="Нажатий" num />
                          </tr>
                        </thead>
                        <tbody>
                          {#each list as r (r.page + r.kind + r.label + r.target)}
                            <tr>
                              <td class="font-medium">{r.label}</td>
                              <td class="text-xs {r.kind === 'submit' ? 'font-semibold text-emerald-700' : 'text-ink-3'}">{KIND[r.kind]}</td>
                              <td class="pii text-xs"><a class="hover:text-acc hover:underline" href="https://{s.host}{r.page}" target="_blank" rel="noopener noreferrer">{r.page}</a></td>
                              <td class="pii break-all text-xs text-ink-3">{r.target || '—'}</td>
                              <td class="num app-num">{fmt(r.n)}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    {/if}
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
