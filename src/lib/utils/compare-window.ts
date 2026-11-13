// С чем Dashboard сравнивает выбранный период.
//   prev       — прошлый период той же длины, сразу перед выбранным (по умолчанию);
//   week       — те же дни неделю назад (для периодов до 7 дней);
//   YYYY-MM-DD — свой день начала, длина та же, что у выбранного периода.
export interface CompareChoice {
  key: 'prev' | 'week' | 'custom';
  /** null — окно по умолчанию (прошлый период той же длины). */
  window: { startDate: string; endDate: string } | null;
}

export function compareWindow(raw: string, start: string, days: number, addDays: (d: string, n: number) => string): CompareChoice {
  if (raw === 'week' && days <= 7) {
    const s = addDays(start, -7);
    return { key: 'week', window: { startDate: s, endDate: addDays(s, days - 1) } };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) && raw < start) {
    const end = addDays(raw, days - 1);
    // Окно сравнения не должно залезать в выбранный период.
    return { key: 'custom', window: { startDate: raw, endDate: end < start ? end : addDays(start, -1) } };
  }
  return { key: 'prev', window: null };
}
