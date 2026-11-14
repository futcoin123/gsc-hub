# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versions are git tags.

Русская версия — [CHANGELOG.ru.md](CHANGELOG.ru.md).

## [Unreleased]

### Added
- **Country keywords as a column, from the topic.** In the group brief and
  the CSV the country keywords are the last column, one per row of the
  country block (5–10 per country; extra key-only rows when the block is
  shorter). Topic keywords of the country from the FUT key map come first
  (commercial coin groups by volume, no past seasons; `scripts/key-map.mjs`
  adds them to the encrypted map), then the country's site keys. The sticky
  brief header shows the current block ("futcoin · Spain").
- **Country keywords in the group brief.** Each country block header lists up
  to 10 keywords of that country from the FUT key map (main keys of the
  country's sites first, then secondary keys and their variants); the CSV gets
  a "Ключи гео" column. futcoin label only for now. Position, impressions,
  clicks and CTR are dropped from the CSV.
- **Site labels.** Every site can carry a project label: all sites in the
  panel on 13 Nov 2026 got `futcoin`, new sites come without one. The label
  shows in site keys (next to the site), in groups (group sites and the brief)
  and goes into the CSV as a "Метка" column. Click to change, empty to remove;
  existing labels are suggested.
- **Group brief in blocks.** With no column picked, the brief is ordered by
  site label (each project its own block), then by country, then site, page
  and anchor, with a header and link count per block. The CSV uses the same
  order.
- **Unified counter.** One counter for every site instead of hand-written ones:
  the panel gives a site its page code (appended to the site's own JS) and
  `gsc-counter.js` for Pages Functions (Buttons → "Единый счётчик", or
  `node scripts/counter-kit.mjs`). Each site gets its own variable, field and
  event-path names, so sites cannot be linked from outside; nothing is stored in
  the browser. It counts views with their source (Google, Bing, AI, direct,
  utm), time, clicks and checkouts (a redirect to the checkout after a click on
  the site). The visitor code is an HMAC of the key over the date and IP — the
  same all day on every Cloudflare server, so bounces and checkout sources are
  right (the old per-server salt made a second page look like a new visit).
  "Проверить сайт" checks the site → panel link without adding events.
- **Buttons → "Проверка счётчиков" (counter check).** The panel keeps a log of
  counter events it receives: per site, what was accepted and what was dropped
  and why (wrong site key, site in no connected console, bot, malformed event,
  rate limit). A block above the table gives a 7-day verdict per site — not
  working / partly / working — such as "views arrive without a source" or "only
  checkouts arrive". The panel used to drop such events silently, so zeros could
  not be explained. "счётчик не стоит" becomes "нет событий" or "события
  отброшены" with the reason on hover.
- **"Без консоли" — a separate section for sites that are not in Search
  Console.** Domains are pasted as a list, link buys run as dated campaigns, and
  the site, anchor (or naked link) and page are typed in by hand. Once the links
  are bought the campaign is fixed and lands in the "what was bought and when"
  history, filterable by site; each site shows links bought and the last buy
  date. Campaign briefs export to CSV like groups. The section does not mix with
  Groups, Purchases or the header filter.
- **Custom key on "Ключи сайтов".** An expanded site now has a row above the
  table to type a key and page by hand: for key-map keys with no Google data in
  the period, and for sites with no keys at all. The page can be a URL or a
  `/path/` (this site only); key-map keys and pages are suggested, and a map key
  fills in its own page. The pair goes into the group chosen in "Ключи в
  группу"; with no group chosen the row says so next to itself, not only at the
  top of the page. Below it are the group's pairs that are not in the table for
  the period, with quantity and remove controls.

### Changed
- **"Today" on Buttons shows how far Google's hourly data goes.** Next to the
  totals: the last hour Google has data for today, "no hours yet", or the
  hourly request's error (daily data shown then). An hourly failure used to
  fall back to daily data silently, which is nearly empty for a fresh day.
- **Dashboard is a table instead of cards.** One row per site: clicks,
  impressions, CTR, position and their change (absolute and percent; position
  ▲▼), a totals row on top, sorting by any column. A "Закупки ссылок" column
  shows the latest link purchase from groups (date, link count, anchors on
  hover) with "ещё N" for older ones, linking to the purchase report. Compare
  with the previous period of the same length, a week earlier (periods up to
  a week) or a chosen date. The chart opens when a row is expanded (periods
  longer than a day). Stars pin favourites to the top; favourites are stored
  in the panel per user (browser-stored stars move over by themselves).
  Google search, CSV export and hide left the rows; previously hidden sites
  sit collapsed at the bottom with a restore button.
- **Checkouts are counted more honestly.** A checkout counts only if the same
  visitor opened the site before (marks now live in the database, not in
  memory: after every panel deploy, site tests passed as buyers for three
  hours — fccoinsprice.com got 143 "checkouts" that way), and at most once
  per visitor per 30 minutes: several presses by one person and hundreds of
  presses by a button test are one checkout. Dropped ones show up in the
  counter check ("repeat", "no-visit").
- **"Last purchase" in site keys is per key.** The column used to list every
  link to the page with any anchor, so each homepage key showed another key's
  purchase. It now shows this key on this page only.
- **Counter check on Buttons is always collapsed.** It used to open by itself
  when a site had problems; now only the "проблемы у N" badge in its title
  says so, and it opens on click.
- **Sticky column headers in every table.** When a long list scrolls, the
  column header row stays under the panel header on every page, not only on
  Buttons. Tables inside horizontal-scroll frames (Purchases, Keywords,
  Properties…) included: a small script moves their header
  (`src/lib/sticky-heads.ts`). In fixed-height boxes the header sticks to the
  top of the box.
- **Purchases: "after" follows the header period.** The report used to ignore
  the period switch and always averaged from the day after the purchase to the
  last complete Google day, so Today, Yesterday and 7 days showed the same
  numbers. "After" is now the selected period, limited to days after the
  purchase and to Google's current day: Today is Google's current day (marked
  as incomplete), Yesterday one day, 7 days the post-purchase days among the
  last seven complete ones. "Before" stays the 7 days before the purchase.
  Changing the period recomputes the open purchases at once.
- **A checkout counts only after a page view.** Site checks and robots often
  press the pay button straight away, without a view being sent, and such
  “checkouts” landed in “Went to checkout” (on 13.11 — about ten per site with
  zero views). Now a checkout counts only if the same visitor (a code instead
  of the IP) sent a view, time or click from that site in the last 3 hours;
  otherwise it goes to the log as “no visit”. For the first 3 hours after the
  panel restarts the rule is off. “Time on page is not arriving” shows only
  with at least five views since the last link check.
- **“Counter check” starts at the last successful link check.** The verdict
  used to cover all seven days, so after the sites moved to the unified counter
  the table would have shown the old counters' errors for a week (key does not
  match, site not in a console, views without a source). Now, once the link to
  a site was checked (“Check site” or the post-deploy check) and the key
  matched, only events after that check count; no visitors since —
  “Link to the panel works, no visitors since”. The intake log is now written
  per hour instead of per day (old rows stay daily).
- **Unified counter v2: the link check result is visible from outside.** On
  `{"gsc_ping":1}` the site waits for the panel and answers with an
  `x-counter-ping` header: `ok`, `bad-key` (the site key is wrong), `no-key`
  (no secret). Site sessions check the chain themselves, without a panel login.
  The event path may have two words (`/api/v/`), so older sites keep theirs.
  Code names no longer depend on the version: futcoin.it keeps its own.
- **Buttons: the "connect the counter (Cloudflare)" block is now "Ключ счётчика".**
  The Cloudflare Worker instructions and code are gone — under the network rule
  of 13.11.2026 sites get only the unified counter ("Единый счётчик"). Copy
  key, new key and the key table stay.
- **Counter: events with a valid key are accepted from sites not yet in Search
  Console.** Only the owner's sites have the key; such events used to be dropped,
  leaving new sites at zero. Counter check: a site nobody has visited since the
  log started shows "ждём посетителей" instead of a problem.
- **Buttons page: the table fits the screen and its top rows stick.** Long
  column titles wrap to two lines and cells are tighter, so the last columns no
  longer run off the edge. Column titles and the total row stick under the
  header while the page scrolls (they used to slide under it). The "счётчик не
  стоит" badge stays on one line; "Просмотры страниц" explains what it counts.
- **Header: every tab stays visible.** The email is gone from the header: an
  account icon opens a menu with the email, API, "Сервисы", Users and log out.
  The logo drops its label below 1700px, Blur loses its label, tabs are tighter.
  When the tabs still do not fit (windows under ~1500px) they wrap to a second
  row instead of hiding.
- **Purchases: a blank row between sites** so they do not run together. The
  "весь сайт" row and naked links explain what they measure on hover: the site
  row is every query and page of the site (not a total of the rows below), a
  naked link is its whole target page.
- **Every site gets its own counter file.** The Worker used to serve the same
  `/_e.js` to every site. Now the file and event paths, the names inside, the
  field names and the code order differ per site: the panel derives them from
  the site's hostname and the counter key. Without the key, the files of
  different sites cannot be linked. The page code no longer carries Cyrillic
  text or the button word list — the panel decides what counts as a button.
- **The Worker code is installed once.** The Worker fetches the counter file
  from the panel (`/c/site`, key required) and refreshes it every 10 minutes; it
  forwards page events as they are and the panel decodes them. Future counter
  changes reach the sites on their own. If the panel is down, the site works as
  usual, just without counting; a page never waits for the panel longer than a
  second.

### How to update
One last time, copy the Worker code ("Кнопки" → "Как подключить счётчик") into
the Worker of every site → Deploy. The key and routes stay the same. Until a
site's Worker is updated, the old counter keeps counting.

## [0.9.3] - 2026-10-27

### How to update

```bash
git pull
docker compose up -d --build
```

The purchase history gains a service column automatically; existing data stays
in the mounted volume. Reload open browser tabs.

### Added
- **369Team homepage links.** Choose homepage links in the purchase window.
  The quote uses the account's link price, with a 30% per-row bonus rounded down.
  Place a bare link or supply surrounding text containing `$LINK` exactly once.
  Language and FieldLink traffic tiers are not required.
- Homepage order details, donor URLs, CSV export and backlink monitoring.
- Separate post and homepage-link prices in the 369Team settings card.

### Changed
- The purchase history stores the placement service so results and background
  checks use the correct provider endpoints. Payment re-checks the quoted price;
  paid order requests are never retried automatically.

## [0.9.2] - 2026-10-27

### Fixed
- Require a text subject when buying FieldLink homepage links. The purchase
  dialog and server now reject an empty subject before submitting the order.

## [0.9.1] - 2026-10-23

### How to update

```bash
git pull
docker compose up -d --build
```

No database schema changes. Existing data stays in the mounted volume. Reload
open browser tabs. Homepage-link purchases require a FieldLink API key with
`links:write`; obtain a quote and confirm its amount before starting an order.

### Added
- **FieldLink homepage links.** Choose posts or homepage links in the purchase
  window. Homepage links support traffic tiers priced at 1, 2 and 5 credits,
  automatic donor matching and an optional text subject. There is no link bonus.
- **Homepage-link results.** Order details and CSV include the donor, traffic
  tier, placement text and the content subject when supplied.
- **Provider services.** Available placement types and link tiers are declared
  per provider. 369Team continues to support posts in the hub.
- Swedish (`sv`) in the purchase language selector.

### Fixed
- New FieldLink posts use automatic topic selection instead of a forced casino
  topic. Estimates use account prices; the post bonus rounds down. The actual
  quote remains authoritative for payment.
- Purchase retries reuse their attempt ID; a later identical campaign can create
  a new task. FieldLink admission errors explain how to recover.
- External order history follows all pages instead of stopping at 100 orders.

### Changed
- Updated application dependencies and patched vulnerable transitive cookie and
  CSS selector packages. Major framework migrations remain separate.
- 369Team registration links now open its referral-enabled Telegram bot.

## [0.9.0] - 2026-10-06

### How to update

```bash
git pull
docker compose up -d --build
```

New SQLite tables are created automatically on startup; existing data stays in
the mounted volume. Reload open browser tabs. Configure the optional backlink
proxy and indexing API key in Settings. No indexing purchases are automatic.

### Added
- **Domain URL filters.** Save URL exclusions per site and filter the Striking
  Distance table by URL fragments, including “contains” and “does not contain”.
- **Custom page purchases.** Buy links for a path on the current domain with
  custom link text, using the shared purchase dialog and purchase events.
- **Backlink monitoring.** Weekly and manual checks show link availability,
  anchor changes and rel attributes. Missing links require a second observation
  at least a day later. Optional authenticated SOCKS4/5 proxy; checks use a
  Googlebot user agent and inspect HTML without JavaScript.
- **Provider pulse.** Compare backlink counts and percentages across providers
  and view recorded history of live, missing and unknown links.
- **Indexers settings and domain submissions.** Configure NeuralIndexer, submit
  pages or recursive sitemaps, and review URL counts, cost and balance before
  sending. Submission history records accepted URLs and charges; retries reuse
  the same request ID. Acceptance by the service does not confirm indexing.
- **Video demo.** A 90-second walkthrough with synthetic data, Russian narration
  and subtitles is linked from both READMEs.

### Changed
- Striking Distance columns can be sorted. Site pages remember geography and
  date range preferences.
- Provider status and placement reads are cached; manual refresh is available.
  Progress polling runs while a backlink check is active.

### Fixed
- Backlink checks no longer flag an anchor mismatch when the purchase brief
  has no expected anchor text. Rel warnings remain independent.
- Malformed indexing JSON returns a client error instead of a server error.
- URL wildcard filters avoid exponential regular-expression backtracking.
- Indexing and sitemap request user agents read the version from the manifest.

## [0.8.1] - 2026-10-04

### How to update

```bash
git pull
docker compose up -d --build
```

No schema changes. Existing Magiclinks purchase history appears automatically;
SQLite data stays in the mounted volume. Reload any open browser tabs.

### Added
- **Link purchases on traffic charts.** One purple event per order and site,
  with the ordered quantity and provider, appears on the site chart, dashboard
  and portfolio pulse. Its date is the purchase date (UTC), not the placement
  date. Historical purchases are included without a backfill.
- **Events filter and order links.** `/events` can filter merges and purchases;
  purchase descriptions and the site's event list link to the order.
- The read-only MCP `site_events` tool includes link purchases alongside merges.

### Changed
- The Magic 369 provider is now labelled **369Team** throughout the UI and docs.
  Provider IDs and API settings remain compatible.

### Fixed
- Nearby merge and purchase markers retain both colors on charts. Orders with
  identical descriptions no longer collide in dashboard event keys.

## [0.8.0] - 2026-09-29

A new look, charts that explain themselves, and a way in for scripts and AI
agents. Existing instances migrate on start; nothing needs to be configured.

### How to update

```bash
git pull
docker compose up -d --build
```

The schema migrates forward at start (new tables `api_keys`, `site_events`,
`magiclinks_purchases`; nothing is dropped). Data survives: SQLite lives in the
mounted `./data`. Rollback is `git checkout v0.7.1 && docker compose up -d
--build`; the extra tables are simply ignored by the older version. If a browser
tab was open during the update, reload it once - a tab still running the old
build can show an error page on its first click. Full details, including the
sequence for an AI agent: [Updating](README.md#updating).

### Added
- **Charts with context.** The site page draws a full traffic chart with Google
  ranking updates shaded in; the Sites page opens with a portfolio pulse on the
  same bands.
- **Site events.** Mark domain merges, migrations or anything else on a site's
  timeline; markers show on the charts and dashboard cards, `/events` lists
  them all.
- **Machine API with scoped keys.** Keys are created on `/api`, shown once and
  stored as sha256. Each key can be limited to a set of sites; everything else
  answers `404`. Endpoints cover sites, queries, the main landing page per
  query, geo and site events. Agent docs at `/api/v1/doc.md`.
- **MCP server** at `/api/v1/mcp` with nine read-only tools and four agent
  skills served as MCP prompts and files. MCP never writes and never spends
  money. Setup: [docs/MCP-SETUP.md](docs/MCP-SETUP.md).
- **SERP monitor integration** (optional): a real-position column and a
  "check now" button on the site page (`SERP_MONITOR_URL`,
  `SERP_MONITOR_TOKEN`, `SERP_API_TOKEN`).
- **Link buying** (optional): buy posts with links to striking-distance pages
  straight from the striking tables, through
  [FieldLink](https://seoboost-root.info/r/flt_czhTpL1GKPqQXI2h1c463ULMS2IEzV6fjJow2hiGlMg) (referral link)
  or 369Team (`magiclinks.online`, keys via Telegram
  [@links_369](https://t.me/links_369)). The window defaults to the provider
  with the larger balance and re-checks the price right before paying; `/magiclinks`
  lists orders from both with progress and, for FieldLink, indexing status.
  Striking tables mark query + URL pairs already bought.
- **Dashboard:** site cards in the OpenGSC style and a separate **Today** that
  is never compared with anything while it is still filling up.

### Changed
- **Redesign.** A denser, trading-terminal look across the app; Portfolio is in
  the top menu.
- **Search Console responses are cached in memory for up to 60 minutes.** Page
  switches are faster and quota lasts longer; **Refresh** drops the cache and a
  restart starts cold. Search Analytics responses are never written to disk.
- **`.env` is optional for Docker Compose** (Compose 2.24+): a fresh checkout
  starts straight into the setup wizard.

### Fixed
- **`pnpm dev` on a fresh clone works again.** With no `ORIGIN` configured the
  access guard treated the dev server as exposed and answered `503` to
  everything, the setup wizard included. The dev server now states its own
  loopback origin; the `503` text also says what to set.
- The period selector works on the site page tabs, and search operators
  (`site:` and the like) no longer leak into keyword lists.
- Privacy Blur covers dashboard site cards and metrics.
- MCP answers with the protocol version the client asks for and hides junk
  queries the same way the hub's screens do.

## [0.7.1] — 2026-08-26

Nothing changes for a running instance. What changed is how this project gets
released: the tooling that publishes it now lives in the repository.

### How to update

```bash
git pull
docker compose up -d --build
```

There is nothing to gain by updating — the application is byte-for-byte the
same as v0.7.0. Update only if you want the release tooling in your checkout.
Data survives regardless: SQLite lives in the mounted `./data`, not in the
image. Rollback is `git checkout v0.7.0 && docker compose up -d --build`. Full
details, including the sequence for an AI agent: [Updating](README.md#updating).

### Changed
- **Releases are one command.** `scripts/publish.sh` builds the public tree,
  commits it as a child of the previous release, tags it, pushes branch and tag
  in a single atomic push, and creates the GitHub release. It is idempotent: a
  retry after a dropped connection finishes the release instead of starting a
  second one. It never force-pushes, and it refuses to publish when the public
  branch has moved under it.
- **What stays out of the public tree is declared, not remembered.**
  `.publicignore` lists it in gitignore syntax, and any path that would become
  public for the first time is printed and has to be confirmed by hand before
  anything is pushed.
- The application itself is untouched — no change under `src/`.

## [0.7.0] — 2026-08-24

A running instance now says what it is, and says when it has fallen behind.

### How to update

```bash
git pull
docker compose up -d --build
```

Data survives — SQLite lives in the mounted `./data`, not in the image, and
schema migrations run at start. From a source checkout: `git pull && pnpm
install && pnpm dev`. Rollback is `git checkout v0.6.8 && docker compose up -d
--build`, but do not roll back across a schema migration without copying
`data/gsc-hub.db` aside first. Full details, including the sequence for an AI
agent: [Updating](README.md#updating).

### Added
- **The footer prints the version this instance is running**, linked to its
  release notes. In a container that is the release tag; on a dev host the
  commit of the working tree is shown beside it, since the image carries neither
  git nor `.git`.
- **A dismissible banner when a newer release exists.** The check runs in the
  browser once every 12 hours against the GitHub Releases API and is cached in
  `localStorage` — the server makes no outbound call and stores nothing for it.
  Dismissal is remembered per version, so the next release shows up again.
  `UPDATE_CHECK=off` removes the check entirely; the footer keeps the version.
- `pnpm release <x.y.z>` bumps the manifest and commits it. The footer reads its
  version from there, so a bump that never happens makes the app misreport
  itself — as it already had, at 0.6.0 in the manifest against tag v0.6.8.
- README documents updating both ways: the commands a person runs, and a
  deterministic sequence an AI agent can follow, including what to do when
  `git pull --ff-only` refuses or a build fails.

### Changed
- Footer links: Telegram now points at @izzypizzy_seo, and a link to the site
  was added.

## [0.6.8] — 2026-08-23

International domains, and the last of the branded-split work.

### Fixed
- **A site registered as `https://пример.рф/` gets a usable brand term.**
  `new URL()` normalises an international hostname to its ASCII form, so that
  property arrived as `xn--e1afmkfd.xn--p1ai` and produced a brand term no
  Russian query will ever contain — while the same site registered as
  `sc-domain:пример.рф` kept its Unicode spelling. One site, two different
  splits, depending on how it happened to be added. Hostnames are decoded before
  the term is derived.
- **Brand terms and queries are compared in one Unicode normal form.** A term
  containing `é` written as `e` + combining acute did not match the same word
  typed precomposed, in either direction.
- The site detail page now says which of the entered terms are short enough to
  be matched as whole words only. The rule existed since 0.6.6 but was invisible:
  someone typing `co` had no way to know it behaves differently from `example`,
  or why the split looked wrong.

### Security
- The punycode decoder is bounded and its arithmetic is checked. Written without
  the overflow guards RFC 3492 requires, a label of a few hundred continuation
  digits drove the working exponent to `Infinity`, after which the bias loop
  divided `Infinity` by 35 forever — synchronously, on the process's only
  thread. A hostname reaches this code from a Search Console response and from
  stored account rows, so a single malformed one could hang the server. Labels
  are now refused past the DNS limits, every multiply and add is checked, and a
  decoded code point outside the Unicode scalar range is rejected.

## [0.6.7] — 2026-08-23

Every date this app asks Search Console for was wrong, in three different ways
at once. **Expect the numbers to move after upgrading** — they were not right
before.

### Fixed
- **Dates are computed in Search Console's timezone.** Its daily rows are keyed
  to `America/Los_Angeles`, but every window came from
  `toISOString().slice(0, 10)`, which is UTC. For roughly a third of each day in
  Europe the app asked for a date the data does not have yet, and quietly got
  less back than it thought.
- **A window of N days now holds N days.** `gscDateRange(days)` built an
  inclusive range from `now-days` to `now`, which spans `days + 1` dates. The
  dashboard compared 8 current days against 7 previous ones, so every
  "vs previous period" delta was inflated by about a seventh at the 7-day
  setting, ~3.6% at 28 days.
  (thanks @klimenkoalex — [#3](https://github.com/izzipizzy/gsc-hub/pull/3))
- **Periods end at the last completed day.** Today is still accumulating, so
  including it compared a partial day against whole ones — the delta was heavily
  negative in the morning and recovered by evening, entirely as an artifact of
  when you looked.
- **The CSV export used the same window as the screen.** It had its own date
  helpers, so the same `days` produced different numbers in the interface and in
  the file.
- Day arithmetic no longer subtracts 86,400,000 milliseconds, which drifts
  across a daylight-saving transition in the target zone. Dates are handled as
  `YYYY-MM-DD` strings, and the test suite runs identically under `TZ=UTC`,
  `Europe/Moscow` and `America/Los_Angeles`.
- The decay comparison's two windows are equal in length and no longer share a
  boundary date, so one day's traffic is not counted in both halves.

### Added
- **Today is its own line on the dashboard**, labelled with the Search Console
  date it belongs to and marked as still filling. It carries no delta — a
  partial day has nothing it can honestly be compared against — and says so when
  some properties could not be read, rather than presenting a short sum as a
  total. It loads after the page renders, since it costs one request per
  property.
- **Comparison disappears when there is nothing to compare against.** Search
  Console keeps roughly 16 months, so past half of that the previous period
  lands where there is no data and every site showed a confident −100%. The
  deltas are hidden now, and the second fan-out is skipped — halving the request
  count on long ranges.

## [0.6.6] — 2026-08-23

Corrections to v0.6.5, plus the bounded CSV export.

**`EXPOSED_MODE=0` did not work in v0.6.5.** The release notes said it would
restore single-user mode on a network you trust. It silenced only one of the two
signals the guard uses, so an instance reached over a LAN address or a `.local`
name still returned 503 — the exact case the flag exists for. If you set it and
got 503 anyway, this is why.

### Fixed
- `EXPOSED_MODE` now outranks both the configured origin and the request host,
  in both directions. Setting it is a statement about the deployment, and half
  of it being honoured is worse than neither.
- An unrecognised `EXPOSED_MODE` value — `treu`, `yes`, `2` — no longer falls
  back to auto-detection. A typo in "this instance is exposed" should not be
  read as "decide for me", so anything that is not an off value means exposed.
- IPv6 loopback origins are parsed rather than string-matched. `new URL()`
  rewrites `::ffff:127.0.0.1` as `::ffff:7f00:1`, so the form that actually
  arrives was treated as public — an unexpected 503 on a genuinely local
  deployment.
- Brand terms of three characters or fewer match on word boundaries; four and
  up still match as substrings. v0.6.5 drew that line at five, which meant a
  four-letter brand stopped matching `brandlogin` or `mybrand`.

### Added
- The CSV export pages past 25,000 rows. A single request is all Search Console
  will answer, so any larger property exported a file that stopped there — no
  error, no warning, nothing in the file to say so. The walk is bounded by
  `GSC_EXPORT_MAX_ROWS` (250,000 by default), streamed so it advances at the
  speed of the download rather than buffering, and stops when the download is
  cancelled. If the cap did stop it, the file's last line says so.
  (thanks @klimenkoalex — [#4](https://github.com/izzipizzy/gsc-hub/pull/4))
- `GSC_EXPORT_MAX_ROWS` and `GSC_EXPORT_PAGE_SIZE`, both parsed as positive
  integers and clamped — the page size to the 25,000 rows one response can
  carry, since asking for more silently skips everything past it.

## [0.6.5] — 2026-08-23

Security release, and a correction to v0.6.3.

**v0.6.3 promised more than it delivered.** It said the app would stop falling
back to anonymous local admin on anything other than loopback. In fact it
treated private IP ranges (`10.x`, `192.168.x`, `172.16–31.x`) and `.local`
names as local, so an instance on a LAN, a VPN or a Docker network still served
full admin to anyone who could reach it. If you deployed 0.6.3 or 0.6.4 anywhere
other than `localhost`, this release is the one that does what that one said.

### Breaking
- An app reached over a LAN address or a `.local` name now returns 503 unless a
  login is configured, where 0.6.3 and 0.6.4 served it. If that network is one
  you trust and you want the single-user mode back, set `EXPOSED_MODE=0`
  explicitly. If it is not, set `ADMIN_EMAIL` and `ADMIN_PASSWORD`.

### Security
- Only real loopback counts as local: `localhost`, `*.localhost`, the whole
  `127.0.0.0/8` block, `::1` and IPv4-mapped loopback. "Not routable from the
  internet" is not the same as "only this machine can reach it" — a neighbour on
  the same Wi-Fi, VPN or Docker network reaches `192.168.1.20` and `gsc.local`
  perfectly well.
- An unconfigured origin is treated as exposed rather than as loopback. A tunnel
  publishes the container without the backend ever learning a new URL, so the
  absence of `ORIGIN` says nothing about who can reach the app.
- A blank `ORIGIN` no longer shadows `AUTH_URL`. Compose passes an unset
  variable through as an empty string, so `ORIGIN: ${ORIGIN}` with nothing set
  discarded a valid `AUTH_URL` and pushed the app into the case above.
- The guard now also treats a request arriving on a non-loopback host as
  exposed. The configured origin cannot see a publisher the app was never told
  about — a tunnel, an OrbStack label, a bind on `0.0.0.0` — so either signal
  saying "exposed" is enough. `EXPOSED_MODE=0` silences both.
- The exposed check requires an actual admin, not merely any user. `manager` is
  a user but cannot reach `/setup` or `/admin/users`, so an instance whose only
  account was a manager ran with nobody able to administer it.
- The first-admin check is retaken inside the transaction, so two concurrent
  setup submissions can no longer both create an admin.
- Exported CSV neutralises leading `=`, `+`, `-` and `@` in text fields,
  including where whitespace, a tab or a carriage return hides the prefix.
  Search queries reach the export verbatim and anyone can run a search that
  starts with `=`. Numbers are untouched, so clicks, CTR and position are
  unchanged.
- Changing a password now revokes that user's sessions. They are random tokens
  carrying nothing derived from the password, so every existing session stayed
  valid for the rest of its 30 days — including whoever the change was meant to
  lock out.

### Fixed
- The address-wide login throttle no longer uses the per-account limit. Behind a
  reverse proxy that address is the proxy, so five failures from anywhere locked
  out every user, the owner included, for fifteen minutes. It has its own, far
  looser limit, and the throttle map is now swept instead of growing for the
  life of the process.

### Changed
- `EXPOSED_MODE` is declared in both compose files, so a value set in the
  deployment environment actually reaches the process.

## [0.6.4] — 2026-08-23

### Fixed
- The default brand term is now the registrable label, not the second-to-last
  one. For every multi-label public suffix the old rule returned a fragment of
  the suffix — `co` for `example.co.uk`, `com` for `store.example.com.au`. That
  term is matched case-insensitively as a *substring*, so the branded split did
  not merely get noisy, it inverted: `discount code` and `cost of delivery`
  counted as branded while `example login` did not. Derived from the Public
  Suffix List. (thanks @klimenkoalex — [#5](https://github.com/izzipizzy/gsc-hub/pull/5))
- Private suffixes are consulted, so `user.github.io` yields `user` rather than
  `github`, and `name.blogspot.com` yields `name` rather than `blogspot`.
- An IP host is kept whole instead of falling through to the old rule, which
  returned an octet — `168` as a brand term matches a great many queries.

Per-site overrides in `site_branded_keywords` are untouched and still win over
the default. Sites already storing one see no change.

Known limitation, tracked in [#8](https://github.com/izzipizzy/gsc-hub/issues/8):
the split still matches terms as substrings, so a short *manual* override (`go`,
`it`, `ai`) produces the same false positives this release removes from the
defaults.

## [0.6.3] — 2026-08-23

Security release. **Upgrade if you run this app on anything other than
loopback.** Two shortcuts meant for a single-user localhost install could hand a
visitor full admin over every connected Search Console account when the app was
reachable from the internet.

### Security
- An instance behind a public origin no longer falls back to anonymous local
  admin. `decideRoute` passed *every* request as admin whenever login was off —
  a mode intended for a loopback install, but nothing checked that the request
  came from loopback. A deployment that lost its `ADMIN_EMAIL`/`ADMIN_PASSWORD`,
  or came up on a fresh volume, served an open panel. It now refuses to serve
  anything (503) until a login is configured.
- The setup wizard is no longer reachable anonymously on a public origin. `/setup`
  is deliberately open until setup completes, which on a public host meant the
  first visitor could claim the instance. Configure `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` through the
  environment when deploying exposed.
- A rejected setup form no longer leaves the app configured. The Google
  credentials were written before the admin password was validated, and
  `isSetupComplete()` only looks at those credentials — so a failed submission
  flipped the app from "redirect everything to /setup" to "set up, no login,
  everything open". Nothing is written now until every field is accepted, and
  the writes happen in one transaction. (thanks @klimenkoalex — [#2](https://github.com/izzipizzy/gsc-hub/pull/2))
- Exposed mode always enables login. `LOGIN_ENABLED` was set only when creating
  the first admin, so a second submission completed setup with login switched off.
- Reconfiguring a completed setup now requires an admin, instead of accepting an
  anonymous POST to `/setup`.
- The login throttle can no longer be bypassed with whitespace. The user lookup
  trims and lowercases the email while the throttle key only lowercased it, so
  `" admin@example.com"` was a fresh five-attempt bucket against the same
  password hash. A per-address bucket was added alongside it, so one client
  cannot spend a full allowance against each of many accounts in turn.

### Added
- `EXPOSED_MODE` forces the exposed/loopback decision either way. By default it
  is derived from `ORIGIN` (falling back to `AUTH_URL`): loopback addresses,
  mDNS `.local` names and private IP ranges are treated as not exposed.
- Per-site link into the Search Console UI that opens under the owning account,
  landing directly on Performance → Search results.

## [0.6.2] — 2026-08-04

Reliability release for large portfolios: the per-site fan-out no longer melts
the socket pool, and an expired token is refreshed once instead of once per site.

### Fixed
- Per-site fan-outs are bounded to 8 concurrent Search Console calls instead of
  one connection per property. On a ~200-site account the unbounded fan-out
  saturated the socket pool and the whole batch died with `UND_ERR_CONNECT_TIMEOUT`,
  so the Sites table rendered dashes. (thanks @KuznetsovRA — [#1](https://github.com/izzipizzy/gsc-hub/pull/1))
- An expired access token is now refreshed once per account per fan-out. The
  shared account row is updated in place and concurrent refreshes are deduped, so
  a 200-site page load no longer sends 200 token-endpoint requests — a burst
  Google can answer with 400s that were being read as `invalid_grant` and marked
  the account revoked.

### Changed
- Fan-out concurrency is tunable via `GSC_CONCURRENCY` (default 8). URL Inspection
  runs narrower under `GSC_INSPECT_CONCURRENCY` (default 4) — it is capped by quota
  (2000/day, 600/min per property), not by the socket pool.

## [0.6.1] — 2026-07-19

### Added
- Browser **setup wizard** at `/setup`: configure Google OAuth keys and access
  mode without editing `.env`. `AUTH_SECRET` is auto-generated and stored in SQLite.
- Admin for exposed deployments is now created in the browser (argon2), not via
  `ADMIN_PASSWORD` env — removes the env-quoting / one-shot-seed lockout traps.

### Fixed
- Single-user (loopback) mode no longer forces a login redirect; it runs as a
  local admin. Login is enabled only when an admin exists or env creds are set.
- Token refresh resolves the Google OAuth client credentials through the config
  layer (env or wizard-stored), so a wizard-configured self-host keeps refreshing
  access tokens instead of failing once the first one expires.

### Changed
- Config precedence: environment variables override the wizard-stored values;
  env-provided fields are shown read-only in the wizard.

### Security
- Before setup completes, `/setup` is reachable without authentication. On a
  publicly-exposed instance with no `GOOGLE_*`/`ADMIN_*` env set, the first
  visitor could complete the wizard and claim the admin account — set env
  before exposing, or complete `/setup` yourself first.

## [0.6.0] — 2026-07-18

Big release: a full SEO analytics suite on top of Search Console — per-site
deep-dives and a portfolio-wide view — plus Bing/IndexNow, site health checks,
and optional multi-user login. All analytics are live-fetched; no GSC data is
stored.

### Added

**Per-site analytics** — a new detail page at `/properties/[site]` with tabs:
- **Striking Distance** — queries ranking at positions 4–20 with real
  impressions (the fastest wins to page 1).
- **Keyword Cannibalization** — queries where several of your own URLs compete,
  with a clear winner/loser breakdown.
- **CTR Benchmark** — your actual click-through rate by position vs an
  industry-reference curve, plus the pages that under-perform it.
- **Content Decay** — pages losing clicks **or impressions** vs the previous
  period.
- **Branded vs non-branded** split, with editable brand terms per site.
- **Site Health** — SSL (expiry/issuer/grade), Google Safe Browsing, and Core
  Web Vitals (PageSpeed Insights, mobile). Run on demand, cached per site.

**Portfolio analytics** — a new `/properties/portfolio` view aggregating every
non-hidden site:
- Tabbed Striking / Cannibalization / CTR / Branded / Decay, all
  **URL-addressable** (`?tab=`), computed from a single query fan-out.
- **Country (Geo) filter** and **copy-queries-to-clipboard**, both respecting
  the current filter.
- Per-decaying-page **index status** via the GSC URL Inspection API, with a
  direct link into the right Google account's inspection panel.
- Async streaming (the shell renders immediately) + a short in-memory result
  cache, so re-opens and period switches are instant.

**Other**
- **Sparklines** of daily clicks on the site cards.
- **Privacy Blur** — one click blurs PII (emails, domains, metrics) for
  screenshots and screen-sharing.
- **Bing Webmaster + IndexNow** — Bing performance data, merged GSC/Bing keys,
  submit sitemap to Bing, push URLs to IndexNow, and an IndexNow-key indicator.
- **Optional login & roles** (`admin` / `manager`) for when you expose the app
  beyond loopback: login form, server sessions (argon2-hashed passwords), a user
  management page, and per-owner account scoping. Off by default — the tool stays
  single-user and loopback-only unless `ADMIN_EMAIL`/`ADMIN_PASSWORD` are set.
- `/properties` niceties: junk-query filters, custom day range, export-all-queries
  CSV, print/PDF stylesheet, sitemap management popup, per-account totals, and an
  average-position range filter.

### Changed
- Analytics are computed **live** — no GSC data is persisted. The database holds
  only OAuth tokens plus small per-site config (brand terms) and a cache of the
  external health checks.
- Secure cookies turn on automatically when `ORIGIN` starts with `https://`.

### Notes / upgrade
- Site Health is optional and needs its own Google API key(s): set `PAGESPEED_KEY`
  and `GOOGLE_SAFE_BROWSING_KEY` (one key works for both — enable the PageSpeed
  Insights API and the Safe Browsing API). Without them the Health tab stays
  hidden; nothing else needs them.
- New tables (`site_branded_keywords`, `site_health`) are created automatically by
  the startup migration.

## [0.3.1] — 2026-06-11

### Added
- **Totals bar** on `/properties`: sums Sites / Impressions / Clicks across all
  non-hidden sites for the selected period.

## [0.3.0] — 2026-06-08

Major release: deploy moved to Docker Compose + OrbStack, sitemap submitting was
added, and query analytics / mobile UI were expanded.

### Added
- **Sitemap submit.** A per-site **Submit sitemap** button resubmits every
  sitemap Search Console already knows for the property (falling back to a
  guessed `/sitemap.xml` if none are registered), plus a **Submit all sitemaps**
  toolbar button that fans out across all visible sites in parallel. Failure
  reasons surface in the row tooltip.
- **Query breakdown by page and country** (query × page × country) in the Top
  queries table.
- **Google SERP link**: click a query's position cell to open the Google SERP for
  that query in the matching country.
- **"G" badge** next to each site for a one-click Google `site:` indexation check.
- **1-day and 60-day** periods in addition to 3/7/28.
- **Docker Compose + OrbStack deploy**: multi-stage `Dockerfile`, `compose.yaml`
  (served at `https://gsc.local` with automatic TLS), `.dockerignore`. The
  container also binds `127.0.0.1:5173 → 3000` so OAuth can run over localhost.

### Changed
- OAuth scope is now `webmasters` (read-write) instead of `webmasters.readonly`,
  required for sitemap submitting. Revert `src/auth.ts` to `.readonly` for
  read-only use.
- Deploy story switched from pm2 to Docker Compose (the pm2 ecosystem config was
  removed).
- Secrets are injected at runtime via `$env/dynamic/private` instead of being
  read at build time.
- Both READMEs (en/ru) and `CLAUDE.md` updated for the new deploy and OAuth flow.

### Fixed
- Pinned `@auth/core` to `0.41.2` to match `@auth/sveltekit` 1.11.2; the stray
  `0.34.3` shadowed it and broke sign-in with
  `TypeError: basePath?.replace is not a function`.

### Notes / upgrade
- **Connect accounts over `http://localhost:5173`, not `https://gsc.local`** —
  Google rejects OAuth redirects to the `.local` TLD (`Error 400: invalid_request`).
- Reconnect each account once to grant the read-write scope before sitemap submit
  works.
- The loopback port is intentionally bound to `127.0.0.1` only; the app has no
  built-in auth and the DB holds OAuth tokens — do not expose it to the network.

## [0.2.0] — 2026-05-02

### Added
- Inline **URL Inspection** expansion per site (top 10 URLs: verdict, coverage,
  robots, last crawl, canonical mismatch).
- 12-hour SQLite cache for URL Inspection responses, with a force-refresh option,
  to stay under Google's 2000-call/day quota.
- Sitemap fallback for URL selection when a site has few/no impressions; the
  homepage is always included.

## [0.1.0] — 2026-05-02

- Initial release: multi-account Google Search Console hub — OAuth connect,
  unified sites table, aggregated top queries/pages, per-site dashboard with
  sparklines and period-over-period deltas, 16-month query history, CSV exports.

[0.6.2]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.6.2
[0.6.1]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.6.1
[0.6.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.6.0
[0.3.1]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.3.1
[0.3.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.3.0
[0.2.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.2.0
[0.1.0]: https://github.com/izzipizzy/gsc-hub/releases/tag/v0.1.0
