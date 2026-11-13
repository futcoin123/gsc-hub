// Метки сайтов на странице: одно состояние на все таблицы, правка — сразу везде.
import { labelKey } from '$lib/utils/site-label';

export const sl = $state<{ labels: Record<string, string>; error: string | null }>({ labels: {}, error: null });

/** Страница отдала метки из load — взять их. */
export function useLabels(labels: Record<string, string> | undefined) {
  if (labels) sl.labels = labels;
}

export const labelOf = (site: string) => sl.labels[labelKey(site)] ?? null;

/** Все метки, что уже есть, — подсказки в поле. */
export const knownLabels = () => [...new Set(Object.values(sl.labels))].sort();

export async function saveLabel(site: string, label: string) {
  try {
    const res = await fetch('/sites/label', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site, label }) });
    if (!res.ok) throw new Error((await res.text()).slice(0, 200) || `HTTP ${res.status}`);
    sl.labels = (await res.json()).labels;
    sl.error = null;
  } catch (e) {
    sl.error = `Метка не сохранилась: ${(e as Error).message}`;
  }
}
