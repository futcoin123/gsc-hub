// Названия колонок таблиц прилипают под шапкой панели при прокрутке страницы
// (просьба владелицы 13.11.2026: сайтов много, без названий колонок теряешься).
//
// Обычная таблица — CSS sticky (класс is-stick, top: --nav-h). Но большинство
// таблиц стоит в рамке с горизонтальной прокруткой (overflow-x: auto), а внутри
// такой рамки sticky к окну не прилипает. Тогда шапку таблицы сдвигаем вниз
// transform'ом при прокрутке (класс is-float) — в пределах самой таблицы.
// Таблица в рамке своей высоты (max-h… overflow-auto) листается внутри рамки —
// её шапка прилипает к верху рамки (класс is-box). Не трогаем: таблицы внутри
// таблиц, во всплывающих окнах, а также с атрибутом data-nostick.

type Mode = 'stick' | 'float' | 'box' | 'skip';

const SCROLLER = /^(auto|scroll|hidden)$/;

export function stickModeOf(table: HTMLTableElement): Mode {
  if (!table.tHead || table.hasAttribute('data-nostick')) return 'skip';
  if (table.parentElement?.closest('table')) return 'skip';
  let sideways = false;
  for (let el = table.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (el.tagName === 'DIALOG') return 'skip';
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.position === 'absolute') return 'skip';
    if (SCROLLER.test(cs.overflowX) || SCROLLER.test(cs.overflowY)) {
      // Рамка с прокруткой вниз — таблица листается внутри неё, не страницей.
      if (cs.maxHeight !== 'none' || el.scrollHeight > el.clientHeight + 1) return sideways ? 'skip' : 'box';
      sideways = true;
    }
  }
  return sideways ? 'float' : 'stick';
}

/** Включить прилипание; вернёт функцию, которая всё снимает. */
export function stickyHeads(): () => void {
  const modes = new WeakMap<HTMLTableElement, Mode>();
  let floats: HTMLTableElement[] = [];

  const navH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h')) || 40;

  function place() {
    const top = navH();
    // Сначала всё измерить, потом всё сдвинуть — без лишних пересчётов вёрстки.
    const shifts = floats.map((t) => {
      const head = t.tHead;
      if (!head) return 0;
      const r = t.getBoundingClientRect();
      return Math.max(0, Math.min(top - r.top, r.height - head.offsetHeight));
    });
    floats.forEach((t, i) => {
      const head = t.tHead;
      if (!head) return;
      const v = shifts[i] > 0 ? `translateY(${Math.round(shifts[i])}px)` : '';
      if (head.style.transform !== v) head.style.transform = v;
      t.classList.toggle('is-floating', shifts[i] > 0);
    });
  }

  function scan(fresh = false) {
    const next: HTMLTableElement[] = [];
    for (const t of document.querySelectorAll<HTMLTableElement>('table.app-table')) {
      let m = fresh ? undefined : modes.get(t);
      if (!m) {
        m = stickModeOf(t);
        modes.set(t, m);
        t.classList.toggle('is-stick', m === 'stick');
        t.classList.toggle('is-float', m === 'float');
        t.classList.toggle('is-box', m === 'box');
        if (m !== 'float' && t.tHead) t.tHead.style.transform = '';
      }
      if (m === 'float') next.push(t);
    }
    floats = next;
    place();
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const later = (fresh: boolean) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      scan(fresh);
    }, fresh ? 200 : 80);
  };
  const onScroll = () => place();
  const onResize = () => later(true);
  const mo = new MutationObserver(() => later(false));

  scan(true);
  mo.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  return () => {
    if (timer) clearTimeout(timer);
    mo.disconnect();
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    for (const t of floats) if (t.tHead) t.tHead.style.transform = '';
  };
}
