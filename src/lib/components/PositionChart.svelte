<script lang="ts">
  // Средняя позиция по дням (линия; лучшее место — наверху) и клики (столбики
  // внизу). Наведение — цифры дня в строке над графиком, поверх данных ничего.
  import { SERIES } from '$lib/chart-theme';
  type Point = { date: string; clicks: number; impressions: number; position: number | null };
  // Пометки (закупки ссылок, склейки): вертикальная линия в этот день.
  type Mark = { date: string; label: string; color: string };
  let { points, height = 180, events = [] }: { points: Point[]; height?: number; events?: Mark[] } = $props();

  let width = $state(640);
  const M = { top: 10, right: 40, bottom: 20, left: 8 };
  const innerW = $derived(Math.max(60, width - M.left - M.right));
  const posH = $derived(Math.round((height - M.top - M.bottom) * 0.72));
  const barTop = $derived(M.top + posH + 6);
  const barH = $derived(height - M.bottom - barTop);
  const n = $derived(points.length);
  const x = (i: number) => M.left + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);

  const known = $derived(points.filter((p) => p.position !== null).map((p) => p.position as number));
  const best = $derived(known.length ? Math.max(1, Math.floor(Math.min(...known))) : 1);
  const worst = $derived(known.length ? Math.ceil(Math.max(...known)) : 10);
  const span = $derived(Math.max(1, worst - best));
  // Позиция 1 — наверху: чем меньше число, тем выше точка.
  const y = (pos: number) => M.top + ((pos - best) / span) * posH;
  const maxClicks = $derived(Math.max(1, ...points.map((p) => p.clicks)));

  const path = $derived.by(() => {
    let d = '';
    let open = false;
    points.forEach((p, i) => {
      if (p.position === null) { open = false; return; }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.position).toFixed(1)}`;
      open = true;
    });
    return d;
  });
  const every = $derived(Math.max(1, Math.ceil(n / Math.max(2, Math.floor(innerW / 46)))));
  const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

  let hover = $state<number | null>(null);
  function onMove(e: PointerEvent) {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect();
    const px = e.clientX - r.left - M.left;
    hover = n ? Math.max(0, Math.min(n - 1, Math.round((px / innerW) * (n - 1)))) : null;
  }
  const shownPoint = $derived(hover !== null ? points[hover] : null);
  const idxOf = (date: string) => points.findIndex((p) => p.date === date);
  const marks = $derived(events.map((e) => ({ ...e, i: idxOf(e.date) })).filter((e) => e.i >= 0));
  const marksOnHover = $derived(hover === null ? [] : marks.filter((m) => m.i === hover));
  const avgPos = $derived.by(() => {
    let w = 0, s = 0;
    for (const p of points) if (p.position !== null && p.impressions) { s += p.position * p.impressions; w += p.impressions; }
    return w ? s / w : null;
  });
</script>

<div class="text-xs">
  <div class="mb-1 flex flex-wrap items-center gap-3 text-ink-2">
    <span class="flex items-center gap-1"><i class="inline-block h-0.5 w-3 rounded-full bg-ink"></i>Средняя позиция</span>
    <span class="flex items-center gap-1"><i class="inline-block h-2 w-2 rounded-sm" style:background={SERIES.clicks}></i>Клики</span>
    {#if marks.length}<span class="flex items-center gap-1" title={marks.map((m) => `${dm(m.date)}: ${m.label}`).join('\n')}><i class="inline-block h-3 w-0.5" style:background={marks[0].color}></i>Закупки ссылок ({marks.length})</span>{/if}
    <span class="text-ink-3">
      {#if shownPoint}
        {dm(shownPoint.date)}: позиция {shownPoint.position === null ? '— (не показывался)' : shownPoint.position.toFixed(1)} · клики {shownPoint.clicks} · показы {shownPoint.impressions}{#each marksOnHover as m (m.label)}<b class="ml-1" style:color={m.color}>· {m.label}</b>{/each}
      {:else}
        За период: средняя позиция {avgPos === null ? '—' : avgPos.toFixed(1)} · наведите на день, чтобы увидеть его цифры
      {/if}
    </span>
  </div>
  <div bind:clientWidth={width}>
    <svg {width} {height} role="img" aria-label="Средняя позиция и клики по дням" onpointermove={onMove} onpointerleave={() => (hover = null)}>
      <!-- шкала позиций справа: лучшая и худшая за период -->
      <g class="text-ink-3" fill="currentColor" font-size="10">
        <text x={M.left + innerW + 6} y={M.top + 4}>{best}</text>
        <text x={M.left + innerW + 6} y={M.top + posH + 3}>{worst}</text>
      </g>
      <line x1={M.left} x2={M.left + innerW} y1={M.top} y2={M.top} class="text-line" stroke="currentColor" stroke-dasharray="2 3" />
      <line x1={M.left} x2={M.left + innerW} y1={M.top + posH} y2={M.top + posH} class="text-line" stroke="currentColor" stroke-dasharray="2 3" />
      <!-- клики -->
      {#each points as p, i (p.date)}
        {@const h = (p.clicks / maxClicks) * barH}
        {#if p.clicks > 0}<rect x={x(i) - 3} y={barTop + barH - h} width="6" height={h} rx="1" fill={SERIES.clicks} opacity={hover === null || hover === i ? 0.85 : 0.4} />{/if}
      {/each}
      <!-- позиция -->
      <g class="text-ink">
        <path d={path} fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
        {#each points as p, i (p.date)}
          {#if p.position !== null}<circle cx={x(i)} cy={y(p.position)} r={hover === i ? 3.5 : 2.2} fill="currentColor" />{/if}
        {/each}
      </g>
      <!-- закупки ссылок и другие события: линия и флажок наверху -->
      {#each marks as m (m.date + m.label)}
        <line x1={x(m.i)} x2={x(m.i)} y1={M.top - 6} y2={height - M.bottom} stroke={m.color} stroke-width="1.5" stroke-dasharray="4 2" opacity="0.9"><title>{dm(m.date)}: {m.label}</title></line>
        <path d="M{x(m.i)},{M.top - 8} l7,3 l-7,3 z" fill={m.color}><title>{dm(m.date)}: {m.label}</title></path>
      {/each}
      {#if hover !== null}<line x1={x(hover)} x2={x(hover)} y1={M.top} y2={height - M.bottom} class="text-ink-4" stroke="currentColor" stroke-dasharray="3 3" />{/if}
      <!-- даты -->
      <g class="text-ink-3" fill="currentColor" font-size="10">
        {#each points as p, i (p.date)}
          {#if i % every === 0 || i === n - 1}<text x={x(i)} y={height - 6} text-anchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{dm(p.date)}</text>{/if}
        {/each}
      </g>
    </svg>
  </div>
</div>
