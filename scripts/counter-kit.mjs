#!/usr/bin/env node
// Единый счётчик GSC Hub — файлы для сайта (те же, что «Кнопки» → «Единый счётчик»).
//   node scripts/counter-kit.mjs <домен> </адрес-событий/> --panel <https://адрес-панели> [--out <папка>]
// Пишет в папку (по умолчанию текущую) два файла:
//   gsc-counter.js   — модуль Pages Functions: в корень репозитория сайта;
//   counter-page.js  — код страницы: дописать в конец общего JS сайта.
// Имена в коде выводятся из домена: тот же домен — те же файлы.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { counterKit, cleanEventsPath } from '../src/lib/counter-kit.js';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const panel = opt('--panel');
const out = opt('--out') ?? '.';
const [host, events] = args;
if (!host || !panel || !/^https:\/\/[^/]+$/.test(panel.replace(/\/$/, ''))) {
  console.error('node scripts/counter-kit.mjs <домен> </адрес-событий/> --panel <https://адрес-панели> [--out <папка>]');
  process.exit(1);
}
if (events && !cleanEventsPath(events)) {
  console.error('Адрес событий — одно слово сайта: буквы, цифры, дефис, например /segnale/');
  process.exit(1);
}
const kit = counterKit(host, panel.replace(/\/$/, ''), events);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'gsc-counter.js'), kit.module);
writeFileSync(join(out, 'counter-page.js'), kit.page + '\n');
console.log(`${kit.host}: адрес событий ${kit.events}, версия ${kit.version} → ${join(out, 'gsc-counter.js')}, ${join(out, 'counter-page.js')}`);
