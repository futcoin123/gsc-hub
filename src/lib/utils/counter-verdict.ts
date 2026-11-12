// Вывод по журналу приёма событий счётчика: что с сайтом не так, простыми
// словами. Общий для страницы «Кнопки» и тестов.

export interface CounterLogRow {
  /** view — просмотр с источником, view-nosrc — без, time, submit, click. */
  kind: string;
  /** ok или причина отказа: bad-key, unknown-site, bot, limit, bad-event. */
  outcome: string;
  n: number;
  lastAt: number;
}

export interface Finding {
  level: 'ok' | 'warn' | 'bad';
  text: string;
}

const sum = (rows: CounterLogRow[], f: (r: CounterLogRow) => boolean) => rows.filter(f).reduce((a, r) => a + r.n, 0);
const last = (rows: CounterLogRow[], f: (r: CounterLogRow) => boolean) => rows.filter(f).reduce((a, r) => Math.max(a, r.lastAt), 0);

/** Находки по сайту за период журнала: сначала проблемы, «всё в порядке» — только если проблем нет. */
export function counterVerdict(rows: CounterLogRow[], fmtTime: (ts: number) => string = (ts) => new Date(ts).toISOString()): Finding[] {
  if (!rows.length) {
    return [{ level: 'bad', text: 'От сайта не пришло ни одного события. Счётчик на сайте ничего не отправляет в панель (или сайт никто не открывал).' }];
  }
  const out: Finding[] = [];
  const rejected = (o: string) => sum(rows, (r) => r.outcome === o);
  const when = (o: string) => fmtTime(last(rows, (r) => r.outcome === o));
  if (rejected('bad-key')) out.push({ level: 'bad', text: `Отброшено ${rejected('bad-key')} событий: ключ сайта не подходит (последнее ${when('bad-key')}). Секрет COUNTER_KEY в Cloudflare у сайта — не действующий ключ панели: обновите его.` });
  if (rejected('unknown-site')) out.push({ level: 'bad', text: `Отброшено ${rejected('unknown-site')} событий: сайта нет ни в одной подключённой консоли Search Console (последнее ${when('unknown-site')}). Добавьте сайт в консоль или переподключите её.` });
  if (rejected('bot')) out.push({ level: 'warn', text: `Отброшено ${rejected('bot')} событий как от бота (последнее ${when('bot')}): сайт передаёт в X-Client-UA не браузер.` });
  if (rejected('bad-event')) out.push({ level: 'warn', text: `Отброшено ${rejected('bad-event')} событий в непонятном формате (последнее ${when('bad-event')}): сайт шлёт поля не так, как ждёт панель.` });

  const ok = (k: string) => sum(rows, (r) => r.outcome === 'ok' && r.kind === k);
  const views = ok('view') + ok('view-nosrc');
  const accepted = sum(rows, (r) => r.outcome === 'ok');
  if (accepted && !views) out.push({ level: 'bad', text: `Просмотры не приходят — только ${[ok('submit') && 'переходы к оплате', ok('click') && 'нажатия', ok('time') && 'время'].filter(Boolean).join(', ')}. Счётчик на страницах сайта не отправляет просмотр.` });
  if (ok('view-nosrc') && !ok('view')) out.push({ level: 'warn', text: 'Просмотры приходят без источника (откуда пришёл посетитель) — колонки «Из Google» … «Прочее» и «Отказы» пустые.' });
  else if (ok('view-nosrc') > ok('view')) out.push({ level: 'warn', text: `Больше половины просмотров без источника (${ok('view-nosrc')} из ${views}).` });
  if (views && !ok('time')) out.push({ level: 'warn', text: 'Время на странице не приходит — «Среднее время» пустое.' });

  if (!out.length) {
    out.push({ level: 'ok', text: `Принято ${accepted} событий (последнее ${fmtTime(last(rows, (r) => r.outcome === 'ok'))}): просмотры с источником${ok('time') ? ', время' : ''}${ok('submit') ? ', переходы к оплате' : ''}${ok('click') ? ', нажатия' : ''}.` });
  }
  return out;
}
