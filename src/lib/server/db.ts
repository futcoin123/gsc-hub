import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS google_accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  label         TEXT,
  access_token  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at    INTEGER NOT NULL,
  scope         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  last_error    TEXT,
  added_at      INTEGER NOT NULL,
  owner_id      TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS url_inspection_cache (
  account_id   TEXT NOT NULL,
  site_url     TEXT NOT NULL,
  urls_hash    TEXT NOT NULL,
  fetched_at   INTEGER NOT NULL,
  payload      TEXT NOT NULL,
  PRIMARY KEY (account_id, site_url, urls_hash)
);

CREATE TABLE IF NOT EXISTS query_filters (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern   TEXT NOT NULL UNIQUE,
  added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_url_exclusions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  site_host TEXT NOT NULL,
  pattern   TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('exact', 'mask', 'not_contains')),
  UNIQUE (site_host, pattern, kind)
);

CREATE TABLE IF NOT EXISTS site_view_settings (
  site_host TEXT PRIMARY KEY,
  settings  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backlink_placements (
  provider TEXT NOT NULL,
  order_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  target_url TEXT NOT NULL,
  expected_anchor TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  result TEXT,
  checked_at INTEGER,
  next_check_at INTEGER NOT NULL DEFAULT 0,
  missing_count INTEGER NOT NULL DEFAULT 0,
  last_job_id INTEGER,
  PRIMARY KEY (provider, order_id, placement_id)
);
CREATE INDEX IF NOT EXISTS idx_backlink_due ON backlink_placements (active, next_check_at);
CREATE TABLE IF NOT EXISTS backlink_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  order_id TEXT NOT NULL,
  placement_id TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  result TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backlink_history ON backlink_history (provider, order_id, placement_id, id);
CREATE TABLE IF NOT EXISTS backlink_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT,
  order_id TEXT,
  placement_id TEXT,
  automatic INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  lease_until INTEGER,
  total INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_backlink_one_job ON backlink_jobs ((1)) WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS backlink_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER UNIQUE,
  captured_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS magiclinks_read_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  retry_after INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS indexnow_keys (
  host      TEXT PRIMARY KEY,
  key       TEXT NOT NULL,
  added_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hidden_sites (
  account_id TEXT NOT NULL,
  site_url   TEXT NOT NULL,
  added_at   INTEGER NOT NULL,
  PRIMARY KEY (account_id, site_url)
);

-- Группы сайтов («Приоритет» и т. п.). Состав хранится доменами, а не
-- property: один сайт в двух консолях (sc-domain: и https://) — один домен.
-- active = 1 у одной группы максимум: её выбрали фильтром в шапке.
CREATE TABLE IF NOT EXISTS site_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  active     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_group_hosts (
  group_id INTEGER NOT NULL REFERENCES site_groups(id) ON DELETE CASCADE,
  host     TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, host)
);

-- Ключи группы: связки «страница + ключ», отмеченные кнопкой + в Striking
-- Distance, пока группа выбрана в шапке. Группа с датой в названии — закупка.
CREATE TABLE IF NOT EXISTS site_group_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES site_groups(id) ON DELETE CASCADE,
  site_url    TEXT NOT NULL,
  query       TEXT NOT NULL,
  page        TEXT NOT NULL,
  position    REAL,
  impressions INTEGER,
  clicks      INTEGER,
  ctr         REAL,
  added_at    INTEGER NOT NULL,
  UNIQUE (group_id, page, query)
);

CREATE TABLE IF NOT EXISTS site_dates (
  host       TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  source     TEXT,
  synced_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_branded_keywords (
  site_url   TEXT PRIMARY KEY,
  terms      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_health (
  site_url   TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS indexing_requests (
  id TEXT PRIMARY KEY,
  site TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  queue TEXT NOT NULL,
  urls TEXT NOT NULL,
  price REAL NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'quoted',
  result TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS indexing_requests_site ON indexing_requests(site, created_at);

CREATE TABLE IF NOT EXISTS app_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_host  TEXT NOT NULL,
  date       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'merge',
  note       TEXT NOT NULL DEFAULT '',
  added_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_site_events_unique
  ON site_events (site_host, date, type, note);

-- Покупки ссылок MagicLinks: что уже куплено на пару «запрос + URL».
-- Сами задания и их статусы живут в сервисе и читаются живьём; здесь только
-- след покупки, чтобы таблицы striking знали, куда уже вкладывались.
CREATE TABLE IF NOT EXISTS magiclinks_purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_host   TEXT NOT NULL,
  target_url  TEXT NOT NULL,
  query       TEXT NOT NULL,
  language    TEXT NOT NULL,
  quantity    INTEGER NOT NULL,
  task_id     TEXT NOT NULL,
  order_id    TEXT NOT NULL,
  provider    TEXT NOT NULL DEFAULT 'fieldlink',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_magiclinks_purchases_pair
  ON magiclinks_purchases (target_url, query);
CREATE INDEX IF NOT EXISTS idx_magiclinks_purchases_site
  ON magiclinks_purchases (site_host);

-- API-ключи для агентов и скриптов. Сам ключ показывается один раз при создании;
-- хранится только sha256 — утёкшая база не даёт войти в API.
CREATE TABLE IF NOT EXISTS api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);

-- Частотность ключей из DataForSEO (Google Ads). Хранится, чтобы не платить
-- за один и тот же ключ дважды. volume NULL — у Google нет данных по ключу.
CREATE TABLE IF NOT EXISTS keyword_volumes (
  query      TEXT NOT NULL,
  location   INTEGER NOT NULL,
  volume     INTEGER,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (query, location)
);

-- Нажатия кнопок на ваших сайтах (счётчик /c.js). Только суммы по дням:
-- ни IP, ни cookie не храним. kind: submit — отправка формы заказа,
-- button — кнопка, out — ссылка на другой сайт, link — обычная ссылка,
-- view — просмотр страницы.
CREATE TABLE IF NOT EXISTS button_clicks (
  day    TEXT NOT NULL,
  host   TEXT NOT NULL,
  page   TEXT NOT NULL,
  kind   TEXT NOT NULL,
  label  TEXT NOT NULL,
  target TEXT NOT NULL,
  n      INTEGER NOT NULL,
  PRIMARY KEY (day, host, page, kind, label, target)
);
CREATE INDEX IF NOT EXISTS idx_button_clicks_host_day ON button_clicks (host, day);

-- Выбор в шапке у каждого пользователя свой: консоли (kind='accounts',
-- value — JSON-список id) и группа-фильтр (kind='group', value — id или '').
-- Нет строки — действует общий выбор (google_accounts.in_use, site_groups.active).
CREATE TABLE IF NOT EXISTS user_selection (
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

-- Переходы к оплате по источнику входа посетителя (Google, ChatGPT, прямой…).
CREATE TABLE IF NOT EXISTS checkout_sources (
  day    TEXT NOT NULL,
  host   TEXT NOT NULL,
  source TEXT NOT NULL,
  n      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, host, source)
);

-- Язык страницы (атрибут lang у <html>) для колонок «Язык» и «Гео»:
-- по главной сайта или его языковой папке; проверяется раз в неделю.
CREATE TABLE IF NOT EXISTS site_locale (
  url        TEXT PRIMARY KEY,
  lang       TEXT,
  error      TEXT,
  checked_at INTEGER NOT NULL
);
-- Отказы: визиты (вход и всё дальше без перерыва в 30 минут) и отказы — визиты
-- без второй страницы и без нажатий. День — день входа (по Берлину).
CREATE TABLE IF NOT EXISTS visit_stats (
  day     TEXT NOT NULL,
  host    TEXT NOT NULL,
  visits  INTEGER NOT NULL DEFAULT 0,
  bounces INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, host)
);
-- Ответы Search Console: копия памяти хаба, чтобы перезапуск сервера
-- (выкладка обновления) не начинал с пустой памяти.
CREATE TABLE IF NOT EXISTS gsc_cache (
  key     TEXT PRIMARY KEY,
  at      INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  value   TEXT NOT NULL
);
-- «Карта ключей FUT»: главные и второстепенные ключи сайтов. Сайт берётся из
-- карты один раз и потом не меняется (правило владелицы 09.11.2026).
CREATE TABLE IF NOT EXISTS key_map_hosts (
  host     TEXT PRIMARY KEY,
  pages    TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
-- Ключ, которым зашифрована карта в открытом репозитории, и что уже взято.
-- Ключи темы по странам из «Карты ключей FUT» (коммерческие группы «Монеты»,
-- по частотности): идут в ТЗ группы колонкой «Ключи гео». Заменяются целиком
-- при каждой новой карте.
CREATE TABLE IF NOT EXISTS key_map_topics (
  country TEXT PRIMARY KEY,
  keys    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS key_map_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  private_key TEXT NOT NULL,
  public_key  TEXT NOT NULL,
  map_hash    TEXT,
  map_updated TEXT,
  imported_at INTEGER
);

-- Даты доменов: из реестра (RDAP) и вписанные вручную (важнее реестра).
CREATE TABLE IF NOT EXISTS domain_dates (
  host              TEXT PRIMARY KEY,
  registered        TEXT,
  expires           TEXT,
  manual_registered TEXT,
  manual_expires    TEXT,
  error             TEXT,
  checked_at        INTEGER NOT NULL DEFAULT 0
);

-- Доступность сайтов: последний результат по каждой проверяемой странице,
-- эталон «нормальной» страницы и история смен состояния.
CREATE TABLE IF NOT EXISTS uptime_checks (
  url        TEXT PRIMARY KEY,
  host       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  level      TEXT NOT NULL,
  data       TEXT NOT NULL,
  since      INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uptime_checks_host ON uptime_checks (host);
CREATE TABLE IF NOT EXISTS uptime_baseline (
  url      TEXT PRIMARY KEY,
  title    TEXT NOT NULL,
  text_len INTEGER NOT NULL,
  shingles TEXT NOT NULL,
  saved_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS uptime_history (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  url     TEXT NOT NULL,
  host    TEXT NOT NULL,
  level   TEXT NOT NULL,
  summary TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uptime_history_host ON uptime_history (host, at);

-- Ключи счётчика: все, что выдавались. Принимается любой не отозванный —
-- смена ключа не ломает сайты со старым. Хранится только sha256.
CREATE TABLE IF NOT EXISTS counter_keys (
  hash         TEXT PRIMARY KEY,
  prefix       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  revoked_at   INTEGER,
  last_used_at INTEGER
);
-- С каких сайтов приходит каждый ключ (чтобы знать, что сломается при отзыве).
CREATE TABLE IF NOT EXISTS counter_key_hosts (
  hash    TEXT NOT NULL,
  host    TEXT NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (hash, host)
);

-- Журнал приёма событий счётчика: по сайту, дню и виду — сколько принято и
-- сколько отброшено и почему (outcome). Раньше /c молча отвечал 204 на всё, и
-- понять, почему у сайта нули, было нельзя. Хранится 30 дней.
CREATE TABLE IF NOT EXISTS counter_log (
  day     TEXT NOT NULL,
  host    TEXT NOT NULL,
  kind    TEXT NOT NULL,
  outcome TEXT NOT NULL,
  n       INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (day, host, kind, outcome)
);

-- Посетители счётчика (код вместо IP, меняется каждый день): когда был на
-- сайте (seen) и когда переходил к оплате (checkout). Переход к оплате
-- засчитывается, только если посетитель до этого был на сайте, и не чаще
-- раза в 30 минут (см. checkoutVerdict). В базе, а не в памяти: перезапуск
-- панели не должен открывать дорогу проверкам сайтов. Хранится 3 часа.
CREATE TABLE IF NOT EXISTS counter_visitors (
  visitor TEXT NOT NULL,
  host    TEXT NOT NULL,
  kind    TEXT NOT NULL,
  at      INTEGER NOT NULL,
  PRIMARY KEY (visitor, host, kind)
);
CREATE INDEX IF NOT EXISTS counter_visitors_at ON counter_visitors(at);

-- Метка сайта (проект): у всех сайтов на 13.11.2026 — «futcoin», у новых —
-- своя (решение владелицы 13.11.2026). Видна в «Ключах сайтов», «Группах» и в
-- ТЗ (CSV). host — домен без www.
CREATE TABLE IF NOT EXISTS site_labels (
  host   TEXT PRIMARY KEY,
  label  TEXT NOT NULL,
  set_at INTEGER NOT NULL
);

-- Раздел «Без консоли»: свои сайты, которых нет в Search Console, и закупки
-- ссылок на них по датам. Отдельно от групп сайтов консолей (site_groups):
-- ни в «Группы», ни в «Закупки», ни в фильтр шапки не попадают.
CREATE TABLE IF NOT EXISTS manual_sites (
  host     TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);

-- Кампания — закупка на дату. fixed_at — когда зафиксировали (куплено).
CREATE TABLE IF NOT EXISTS manual_campaigns (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  date       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  fixed_at   INTEGER
);

-- Ссылки кампании: анкор (anchor = ключ) или безанкор (anchor = '' — текстом
-- полный адрес, '[домен]' — просто адрес), как в site_group_items.
CREATE TABLE IF NOT EXISTS manual_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES manual_campaigns(id) ON DELETE CASCADE,
  host        TEXT NOT NULL,
  page        TEXT NOT NULL,
  anchor      TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'anchor',
  qty         INTEGER NOT NULL DEFAULT 1,
  added_at    INTEGER NOT NULL,
  UNIQUE (campaign_id, page, anchor)
);
CREATE INDEX IF NOT EXISTS manual_links_host ON manual_links (host);

-- Сколько секунд страницы были открыты на экране (сумма за день).
-- Среднее время = seconds / просмотры (kind = 'view' в button_clicks).
CREATE TABLE IF NOT EXISTS page_time (
  day     TEXT NOT NULL,
  host    TEXT NOT NULL,
  page    TEXT NOT NULL,
  seconds INTEGER NOT NULL,
  PRIMARY KEY (day, host, page)
);
`;

export function openDb(path: string): Db {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Seed the default 'site:' filter only when query_filters is first created, so
  // a user who deletes it doesn't get it back on the next restart.
  const filtersExisted = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='query_filters'")
    .get();
  db.exec(SCHEMA);
  // Разовая очистка счётчика кнопок: до перехода на Cloudflare Worker туда
  // попадали боты и неудачные отправки формы — эти цифры неверны.
  db.exec('CREATE TABLE IF NOT EXISTS schema_marks (name TEXT PRIMARY KEY)');
  // Доступность: перепроверить все сайты после исправления ложных тревог
  // (отказ поддельному Googlebot, разовые сетевые сбои).
  if (!db.prepare("SELECT 1 FROM schema_marks WHERE name = 'uptime-v2'").get()) {
    db.transaction(() => {
      db.exec('DELETE FROM uptime_checks;');
      db.prepare("INSERT INTO schema_marks (name) VALUES ('uptime-v2')").run();
    })();
  }
  // Копия памяти Search Console записывалась без Map (страны сайтов, сводки
  // ключей превращались в {}): такие строки после перезапуска ломали страницы.
  if (!db.prepare("SELECT 1 FROM schema_marks WHERE name = 'gsc-cache-v2'").get()) {
    db.transaction(() => {
      db.exec('DELETE FROM gsc_cache;');
      db.prepare("INSERT INTO schema_marks (name) VALUES ('gsc-cache-v2')").run();
    })();
  }
  // Сайты, на которые в группе уже есть ссылки, — в список сайтов группы
  // (раньше туда попадали только кнопкой «+»).
  if (!db.prepare("SELECT 1 FROM schema_marks WHERE name = 'group-hosts-from-items'").get()) {
    db.transaction(() => {
      const rows = db.prepare('SELECT DISTINCT group_id, site_url FROM site_group_items').all() as { group_id: number; site_url: string }[];
      const ins = db.prepare('INSERT OR IGNORE INTO site_group_hosts (group_id, host, added_at) VALUES (?, ?, ?)');
      for (const r of rows) {
        const raw = r.site_url.startsWith('sc-domain:') ? `https://${r.site_url.slice(10)}/` : r.site_url;
        try {
          const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
          if (host) ins.run(r.group_id, host, Date.now());
        } catch {
          // битый адрес — пропускаем
        }
      }
      db.prepare("INSERT INTO schema_marks (name) VALUES ('group-hosts-from-items')").run();
    })();
  }
  if (!db.prepare("SELECT 1 FROM schema_marks WHERE name = 'counter-v2'").get()) {
    db.transaction(() => {
      db.exec('DELETE FROM button_clicks; DELETE FROM page_time;');
      db.prepare("INSERT INTO schema_marks (name) VALUES ('counter-v2')").run();
    })();
  }
  const cols = db.prepare("PRAGMA table_info('google_accounts')").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'owner_id')) {
    db.exec('ALTER TABLE google_accounts ADD COLUMN owner_id TEXT');
  }
  // Когда консоль подключили (в последний раз) и когда сменился её статус —
  // чтобы при отключении было видно, через сколько дней Google снял доступ.
  if (!cols.some((c) => c.name === 'connected_at')) {
    db.exec('ALTER TABLE google_accounts ADD COLUMN connected_at INTEGER');
    db.exec('UPDATE google_accounts SET connected_at = added_at');
  }
  if (!cols.some((c) => c.name === 'status_at')) {
    db.exec('ALTER TABLE google_accounts ADD COLUMN status_at INTEGER');
  }
  // Группа зафиксирована (fixed_at) и сайт группы пройден (done_at).
  const groupCols = db.prepare("PRAGMA table_info('site_groups')").all() as Array<{ name: string }>;
  if (!groupCols.some((c) => c.name === 'fixed_at')) db.exec('ALTER TABLE site_groups ADD COLUMN fixed_at INTEGER');
  const hostCols = db.prepare("PRAGMA table_info('site_group_hosts')").all() as Array<{ name: string }>;
  if (!hostCols.some((c) => c.name === 'done_at')) db.exec('ALTER TABLE site_group_hosts ADD COLUMN done_at INTEGER');
  // Ключ группы: сколько ссылок ставить (qty) и тип: анкорная (anchor) или безанкорная (naked).
  const itemCols = db.prepare("PRAGMA table_info('site_group_items')").all() as Array<{ name: string }>;
  if (!itemCols.some((c) => c.name === 'qty')) db.exec('ALTER TABLE site_group_items ADD COLUMN qty INTEGER NOT NULL DEFAULT 1');
  if (!itemCols.some((c) => c.name === 'kind')) db.exec("ALTER TABLE site_group_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'anchor'");

  // Галочка «Использовать»: снятая консоль не попадает в общие отчёты и в MCP.
  // По умолчанию 1, чтобы уже подключённые консоли работали как раньше.
  if (!cols.some((c) => c.name === 'in_use')) {
    db.exec('ALTER TABLE google_accounts ADD COLUMN in_use INTEGER NOT NULL DEFAULT 1');
  }

  // Область ключа: JSON-массив siteUrl. Пусто — все сайты, поэтому ключи,
  // выданные до появления колонки, продолжают работать как раньше.
  const keyCols = db.prepare("PRAGMA table_info('api_keys')").all() as Array<{ name: string }>;
  if (!keyCols.some((c) => c.name === 'sites')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN sites TEXT');
  }
  // Одна связка одного заказа — одна строка истории. Без этого два импорта,
  // запущенные одновременно (страница и кнопка), успевают оба пройти проверку
  // «заказ уже записан» и удваивают количество.
  db.exec(
    `DELETE FROM magiclinks_purchases
      WHERE id NOT IN (
        SELECT MIN(id) FROM magiclinks_purchases GROUP BY order_id, target_url, query
      )`
  );
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_magiclinks_purchases_unique
       ON magiclinks_purchases (order_id, target_url, query)`
  );
  // Провайдер покупки: до появления второго провайдера все заказы были FieldLink.
  const purCols = db.prepare("PRAGMA table_info('magiclinks_purchases')").all() as Array<{
    name: string;
  }>;
  if (!purCols.some((c) => c.name === 'provider')) {
    db.exec("ALTER TABLE magiclinks_purchases ADD COLUMN provider TEXT NOT NULL DEFAULT 'fieldlink'");
  }

  if (!filtersExisted) {
    db.prepare('INSERT INTO query_filters (pattern, added_at) VALUES (?, ?)').run('site:', Date.now());
  }

  const purchaseCols = db.prepare("PRAGMA table_info('magiclinks_purchases')").all() as { name: string }[];
  if (!purchaseCols.some((c) => c.name === 'service')) {
    db.exec("ALTER TABLE magiclinks_purchases ADD COLUMN service TEXT NOT NULL DEFAULT 'posts'");
  }
  return db;
}

let _instance: Db | null = null;
export function db(): Db {
  if (!_instance) {
    const path = process.env.DB_PATH ?? './data/gsc-hub.db';
    _instance = openDb(path);
  }
  return _instance;
}
