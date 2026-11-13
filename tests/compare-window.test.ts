// Dashboard: с чем сравнивать выбранный период.
import { it, expect } from 'vitest';
import { compareWindow } from '../src/lib/utils/compare-window';
import { addCalendarDays } from '../src/lib/server/gsc-calendar';

it('по умолчанию — прошлый период той же длины (окно считает сервер)', () => {
  expect(compareWindow('prev', '2026-11-12', 1, addCalendarDays)).toEqual({ key: 'prev', window: null });
  expect(compareWindow('мусор', '2026-11-12', 1, addCalendarDays)).toEqual({ key: 'prev', window: null });
});

it('неделей раньше — те же дни 7 дней назад, только для периодов до недели', () => {
  expect(compareWindow('week', '2026-11-12', 1, addCalendarDays)).toEqual({ key: 'week', window: { startDate: '2026-11-05', endDate: '2026-11-05' } });
  expect(compareWindow('week', '2026-11-06', 7, addCalendarDays)).toEqual({ key: 'week', window: { startDate: '2026-10-30', endDate: '2026-11-05' } });
  expect(compareWindow('week', '2026-10-16', 28, addCalendarDays).key).toBe('prev');
});

it('своя дата — период той же длины с этого дня, не залезая в выбранный', () => {
  expect(compareWindow('2026-11-01', '2026-11-12', 1, addCalendarDays)).toEqual({ key: 'custom', window: { startDate: '2026-11-01', endDate: '2026-11-01' } });
  expect(compareWindow('2026-11-01', '2026-11-06', 7, addCalendarDays)).toEqual({ key: 'custom', window: { startDate: '2026-11-01', endDate: '2026-11-05' } });
  expect(compareWindow('2026-11-12', '2026-11-12', 1, addCalendarDays).key).toBe('prev'); // не раньше периода
});
