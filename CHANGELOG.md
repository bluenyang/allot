# Changelog

## 0.1.10-rc.1 — 2026-11-27

The calculation fixes found in real use: a weekend and holiday rule for each date, a card's usage period, what a month
is, the month a card bill counts in, charges at the plan in force on their date, and how a subscription is paid. Spec
018 (`.agents/intent/018_real-use-fixes/spec.md`). The version carries a hyphen, so the image is
`ghcr.io/bluenyang/allot:0.1.10-rc.1` and `latest` does not move. Migrations 0044–0049 run at start: three rule columns
on the settings and one on each own monthly date (0044), a copy of the old rule into them (0045), the drop of
`settings.day_shift` (0046), `card.usage_from` (0047), the month basis on the settings (0048) and a subscription's card
and account (0049). Nothing the app, the API or a tool accepted before is refused; the new limits are on the new fields
only (below).

### Upgrading from 0.1.9
- **Back up the database first.** Migration 0045 copies `settings.day_shift` into the three rules of the pay day, the
  transfer day and the card billing day and into every own monthly date of that user, and 0046 drops the column. No date
  moves by the upgrade. Going back to 0.1.9 needs the backup taken before it.
- **Settle pending AI proposals before upgrading** (confirm or reject them under 대기 중인 변경). The shape of the data
  changes, so every proposal made before the upgrade is stale afterwards and cannot be applied; propose again.
- **Numbers that change on the day of the upgrade**, with nothing new chosen yet:
  - *Card bills count one pay earlier.* A card bill (a lump sum or an installment paid by card) counts in the month of
    the pay before it, no longer in the month of its billing date. With a pay day after the billing day (pay day 25,
    billing day 14) the bill of 14 December comes off November's left over: this month's and next month's left over
    move, and the totals over the months stay the same. Buffer refills, split payments and rounds paid from the salary
    or the subscription account count where they did.
  - *Each subscription charge uses the plan in force on its own date.* A plan change dated after a month's charge leaves
    that charge at the old price; a cancellation dated after it leaves it in the lists, and a plan that comes back is
    charged from its date. After a change from monthly to yearly the first billing date on or after the change is the
    first yearly charge. The monthly cost, the subscription transfer and the allocation stay monthly, as before.
  - *The balance projection of an account that pays card bills.* The money for a bill now comes in on the transfer date
    of the month that counts the bill and leaves on the bill date (before, only the bill left). The account that takes
    the left over is no exception: it shows its card money in and its bills out. A one-off round paid from the
    subscription account now leaves the account the subscriptions target sends to.
  - A subscription leaves an account's projection only after you say how it is paid (below); until then it takes nothing
    out, as in 0.1.9.
- **API clients**: `/api/state` and the MCP answers no longer carry `settings.dayShift`; read `payShift`, `transferShift`
  and `billingShift`. A request body may still send `dayShift`: it sets each of the three rules the body leaves out or
  sends back as it is saved (own monthly dates are not touched). A `pnpm db:seed` data file written for 0.1.9 is taken
  the same way.
- **Reverting** (the change history, MCP `propose_revert`): the change that made a card or an account cannot be reverted
  while a subscription is paid with it or the card is the month basis card — unlink it first ("이후에 연결된 항목이 생겨서
  되돌릴 수 없어요", the rule a card used by a spending already had). A revert that would write a row naming a card or an
  account deleted since is refused ("연결된 항목을 찾을 수 없어요"): revert that delete first. As before, a revert is refused
  when a row of that change was changed again afterwards; the delete of a card or an account now also carries the
  subscriptions it set back to no way of paying. Reverting the delete of the month basis card brings the card back and,
  when the basis was not changed since, the basis too.

### Added
- **A weekend and holiday rule for each date** (Settings › General › 기준 일정): the pay day, the transfer day, the card
  billing day and each own monthly date are moved earlier, left or moved later on their own. A card's own billing day
  follows the card billing day's rule. API: `settings.payShift`, `transferShift`, `billingShift` and `shift` on a
  schedule item.
- **A card's usage period** (월급 분배 › 통장·생활비·설정 › a card: 이용 기간 시작일, 1–31 or empty): what is bought from
  that day of a month to the day before it in the next month is billed on the first billing day after the period ends
  (billing day 25, first day 12: 12 November to 11 December is billed on 25 December). Empty is the rule of 0.1.9, the
  billing day of the month after the purchase. It decides the dates of a new card spending's rounds, the day a buffer
  use's card bill leaves, a subscription's card bill and the 청구 대기 state; saved rounds keep their dates.
- **What a month is** (Settings › General › 달의 기준): the calendar month (default), the usage period of a card you
  pick, or one actual pay date to the day before the next. A period over two months is named after the month it starts
  in when its first day is the 15th or earlier, else the month it ends in — or pick which. The home, income,
  allocation, spending, subscriptions, savings and investment screens, the notices, the CSV files and the MCP tools
  follow it and show the period next to the month; the event calendar, the yearly contribution limit (a calendar year)
  and the change history's period do not. Values saved by a month's name (phases, month adjustments, money received,
  from and stop months) keep their names: the dates a name stands for change, and a confirmation shows this month
  before and after — also when the pay day or its rule, the basis card's first day of use, or the basis card itself
  changes it. The pay, transfer and billing dates of a month are the occurrence of each day in its period, moved by
  their rule afterwards, so a moved date can lie a day or two outside the period.
- **Transfers to the paying accounts** (월급 분배 › 월별 시뮬레이션 › 대금 계좌 이체): for each account a card or the
  subscriptions are paid from, the subscription transfer, the card spending the month counts, the buffer refills and
  their sum. The left over, 지출's 이번 달 반영 and the account's balance projection read the same list. A card round paid
  with an earlier pay says so on the spending lists ("11월 분배에서 냄").
- **How a subscription is paid** (the subscription editor: 결제 수단 — none, a card or an account; apart from the payment
  path): the balance projection takes each charge out of the account on the charge date, or out of the card's paying
  account on the card's bill date for it, at the plan in force on the charge date and at the exchange rate without the
  buffer. The projection counts the charges from one billing cycle before the saved next payment date; an earlier one
  is not taken out, also when the card has not billed it yet. Deleting the card or the account sets the subscription
  back to none.
- MCP: `period` on monthly answers and `projectionMonths` on `list_accounts`; `shift` on every date of `get_overview` and
  `get_schedule`; `usageFrom` on a card; `payouts` on `get_allocation` and `get_overview`; `countsIn` on spending rounds;
  `nextCharge`, `cardId` / `card` and `accountId` / `account` on `list_subscriptions`; `date` on a yearly income of
  `get_income`. `propose_changes` takes the new keys of the settings, cards, own dates and subscriptions. The seven
  skills, the plugin copies and the Gemini context file follow.
- The subscriptions CSV has three more columns at its end (the next charge's plan, amount and currency), filled when
  that charge is not what the row shows; the first nine columns are as before.

### Changed
- **The month a card bill counts in**: the month of the pay before the bill (a bill dated on a pay date: the pay before
  that), replacing "card → the month of its billing date" of 0.1.5. With a pay month basis that is the month the bill's
  date lies in.
- **Subscription charges** on the home, the calendar, the notices, the lists and MCP use the plan in force on the
  charge's date. The subscription list's next payment is the next charge that will really be made — before a
  cancellation's date, and after a cancelled plan comes back — with that charge's own plan and amount under the date
  when the row shows another; MCP `list_subscriptions.nextPayment` is the same.
- **A yearly income** counts in the month whose period holds its calendar date, and the income screen shows that date
  (the calendar basis is as before).
- The change history and a proposal's preview name a card or an account by its name where they showed its id.
- 월급 분배 stays on the tab you were on when a save there changes what a month is.

### New limits (on the new fields only)
- A card's first day of use: a whole number from 1 to 31, or empty.
- A subscription's way of paying: a card and an account together in one body are refused; an id that is not one of
  your cards or accounts is refused. Naming one alone replaces the other.
- The month basis: one of three values; the basis card is one of your cards or empty; the naming one of three values.
- The three rules and an own date's rule: one of the three values the old rule had.
- Not refused: deleting a card or an account a subscription is paid with, deleting the month basis card (the basis goes
  back to the calendar month), a subscription paid with a card that has no paying account.

## 0.1.9 — 2026-11-26

AI connection, notices on every device, passwords for external sign-ins and the in-app connection guide: the same code
as 0.1.9-rc.3 below, with rc.1 and rc.2 before it. Released on the user's instruction ("배포해"); the screen checks of
rc.1 to rc.3 and the real-app checks (V-9) were not reported before it. Migrations 0039–0043 run at start.

## 0.1.9-rc.3 — 2026-11-26

How to connect each AI app, inside the app. Released as a prerelease after the merge (PR #70, merged by the user:
"머지 완료"); the image is `ghcr.io/bluenyang/allot:0.1.9-rc.3` and `latest` does not move. Spec 017 (`.agents/intent/017_rc3-app-connect-guide/spec.md`). No migration.

### Added
- **Connect an app** (Settings › AI & integrations): nine apps — Claude Code (plugin with OAuth, plugin with an API key),
  claude.ai with the desktop and phone apps, ChatGPT, Codex, Gemini CLI, Antigravity CLI, an API key directly, and other
  agents by hand. Each opens a dialog with the steps, this server's MCP address in the commands, copy buttons and the
  official help links. When external app connections (OAuth) are not possible on the server, the apps that need them
  are dimmed with the reason. The key command that card showed before is in the API key dialog.
- **Skills download**: each of the seven skills as a ZIP for claude.ai (`GET /api/skills`, `GET /api/skills/<name>.zip`,
  signed in). The image carries `skills/`; `scripts/skills-zip.mjs` makes the same bytes.
- **MCP server description**: `initialize` gives `title` "Allot", a one-line `description` and `websiteUrl`; `name` and
  `version` are unchanged.

## 0.1.9-rc.2 — 2026-11-26

The bell's marks follow the account, and accounts that sign in externally can add a password. Released as a prerelease
after the merge (PR #68, merged by the user: "머지 함"); the image is `ghcr.io/bluenyang/allot:0.1.9-rc.2` and `latest`
does not move. Spec 016
(`.agents/intent/016_rc2-account-and-notices/spec.md`). Migrations 0042 and 0043 add `notice_mark` with forced row-level
security.

### Added
- **Notices on every device**: read marks and the maturity cards answered 계속 보내기 are kept on the account
  (`GET`/`POST /api/notices/marks`), so every browser and phone shows the same; a browser's earlier marks move to the
  account once at the first sign-in. MCP `list_notifications` gives `read` and leaves out kept maturities, as the app does.
- **Add a password** (Settings › Sign-in & security): an account that signs in with OIDC, GitHub or Google only can add
  a password (`POST /api/account/password`; signed in within a day, password sign-in on, the admin's minimum length).
  Remove it by unlinking the password sign-in while another method is left.

## 0.1.9-rc.1 — 2026-11-25

AI connections: Allot becomes the OAuth authorization server of its own MCP endpoint, and the repository is a plugin
marketplace with seven skills. Released as a prerelease after the merge (PR #66, merged by the user: "머지함"). The version
carries a hyphen, so the image is `ghcr.io/bluenyang/allot:0.1.9-rc.1` and `latest` does not move. Licensed under the GNU
AGPL v3.0 or later from this version (`LICENSE`). Spec 015 (`.agents/intent/015_ai-connection/spec.md`). Migrations 0039–0041 add the
OAuth tables (Better Auth's oauth-provider, jwt and cimd schemas), `oauth_app_use`, `mcp_proposal.source_kind`
(existing proposals: `api_key`), the `oauth` app setting and the change-history actor `oauth_app`. Nothing an API key,
a tool or `/api/mcp` accepted before is refused.

### Added
- **`/mcp`** at the root: API keys as before, and OAuth access tokens while external app connections are on. Its 401
  names the protected resource metadata (RFC 9728); `/api/mcp` is unchanged (keys only).
- **OAuth** (off by default; Admin › Login methods, or `ALLOT_OAUTH_ENABLED`): discovery at `/.well-known/…`, dynamic
  client registration and Client ID Metadata Documents, PKCE S256, audience-bound JWT access tokens (1 h), refresh
  tokens that rotate (30 days, no reuse). Needs `BETTER_AUTH_URL` on https (http on localhost for tests).
- **Consent screen** (`/oauth/consent`): the app, where it goes back (with a warning for localhost-only apps), and one of
  read / propose (confirm on the screen) / propose (confirm in the chat) — the same three as a key.
- **Connected apps** in Settings › AI: permission, connected, last used, disconnect (refused at once). Proposals and
  change sets made by an app show its name ("AI · app").
- **Plugins and skills**: `.claude-plugin/marketplace.json` with `allot` (OAuth) and `allot-key` (API key) for Claude
  Code; Codex and Antigravity install the same skills; a Gemini CLI extension; `scripts/skills-zip.mjs` for claude.ai.
  Skills: month start, payday, month end, subscriptions, receipts, spending plan, assets.

### Changed
- Better Auth 1.7.18 → 1.7.27 (with `@better-auth/mcp`, `oauth-provider`, `cimd`).
- The MCP server's instructions say what Allot is, what the connection may do and where to start, in the first 512
  characters.
- Settings › AI shows `/mcp` as the MCP address; the 준비 중 note about remote connectors is gone.

## 0.1.8 — 2026-11-25

Three-second screens and income: the same code as 0.1.8-rc.1 below. Released on the user's instruction ("stable 내어봐")
after the screen check of 0.1.8-rc.1 on the staging stack (V-8, user: "확인했음, stable"). Migrations 0037 and 0038 run at
start.

## 0.1.8-rc.1 — 2026-11-25

Three-second screens and income, released as a prerelease after the merge (PR #59; the user: "머지하고 rc까지").
The version carries a hyphen, so the image is `ghcr.io/bluenyang/allot:0.1.8-rc.1` and `latest` does not move. Spec 014 (`.agents/intent/014_three-second-income/spec.md`). Migrations 0037 and 0038
add three tables (regular incomes, money received, money that came in once) with forced row-level security; no stored
value moves: the salary stays the settings' take-home pay on the pay day.

### Added
- **Income** (`/income`, first in the 예산 menu): the salary and regular incomes (monthly, or yearly in a month), the
  money received for each in a month (several entries add up), and money that came in once. A month counts what was
  received, else the expected amount; the difference goes to that month's left over only.
- MCP: `get_income`; `get_overview` gains `income` and `leftOverKrw`; `propose_changes` takes `incomes`,
  `income-receipts` and `income-extras`, with preview lines.

### Changed
- **Home**: the month's left over (여유) first, as "what comes in − what goes out = left over", then the two sides and
  where the left over goes; the old tabs moved under 자세히. The four summary cards are gone (the subscription figure is
  in the 나갈 돈 list, the 31-day payments and the counts are in the tabs).
- The money left after allocation is called **여유** (en "Left over") on every screen; API and MCP field names stay.
- Allocation, Living, Savings, Investment and Spending start with what they send out each month; balances, totals so far
  and projections are on the row below. Allocation's pay is what comes in that month.

## 0.1.7-fix.1 — 2026-11-24

A fix release on 0.1.7, named by the user ("0.1.7-fix.1로 배포해"). The version carries a hyphen, so the release workflow
marks it a prerelease and does not move the `latest` image tag: use `ghcr.io/bluenyang/allot:0.1.7-fix.1` by name.

### Fixed
- The rounds table of the 할부 detail broke each round into two lines under the column headers: the rows took the global
  `.row` grid style (since 0.1.5). Each round is one table row again.

## 0.1.7 — 2026-11-23

The budget menus, account management and every feature that was "coming soon" except the AI ones, each with MCP tools.
The same code as 0.1.7-rc.3: 0.1.7-rc.1 (the budget core), 0.1.7-rc.2 (budget and screen features) and 0.1.7-rc.3
(settings and security) below together are this release. Spec 013 (`.agents/intent/013_budget-and-soon/spec.md`).
Released on the user's instruction ("정식 릴리스") after the screen checks on the staging stack (V-12, V-22, user:
"확인했음, 릴리스"). Migrations 0028 to 0036 run at start; reverting a change set saved before 0.1.7 for the old living
costs table is refused (A-2).

## 0.1.7-rc.3 — 2026-11-23

Settings and security features that were "coming soon". Spec 013 revision 1 (`.agents/intent/013_budget-and-soon/spec.md`, S-22 to S-26, A-35 to A-45). Migrations 0034, 0035 and 0036 (the time zone preference, a table for one's own monthly dates, a table of foreign currencies, the automatic refresh columns of the settings, a table of failed sign-ins; the currency of subscriptions, plan changes and spendings becomes a three-letter code — the stored `KRW` and `USD` values are unchanged).

### Added
- **Time zone** (Settings › General): any IANA time zone, shown with its UTC offset (default Asia/Seoul). "Today" and "this month" on every screen, and in the MCP tools and proposals, follow it.
- **Own monthly dates** (기준 일정 추가): a monthly date of one's own besides the pay, transfer and card billing days — name, day (1–31), account (optional), money in or out, memo; no amount, and not part of the distribution or the transfer. Listed with this month's date after the weekend/holiday shift, and shown on the 일정 calendar and agenda. MCP: `get_schedule` lists them (`ownDates`); `propose_changes` takes `schedules`.
- **Currency list** (Settings › General › 통화): currencies besides KRW and USD (ISO 4217 code, rate in KRW per unit, buffer %), added, edited and deleted there. USD keeps its rate and buffer in the settings, as before. Subscriptions, plan changes and spendings take any listed code; the pickers keep KRW and USD. A currency that a subscription, plan change or spending uses cannot be deleted or renamed; KRW and USD cannot be added to the list. MCP: `get_overview` lists the currencies; `propose_changes` takes `currencies`.
- **Automatic exchange rates**: per currency (USD too), "자동" lets the server update the rate once a day from the public ECB rates (Frankfurter), and "지금 갱신" does it at once (`POST /api/currencies/refresh`). Off by default. A changed rate is one change set by "자동 갱신" in the change history and can be reverted. A code the service does not have, or a failed request, keeps the rate and shows the last failure. `ALLOT_FX_URL` names another rate service and `ALLOT_FX_REFRESH=off` switches the refresh off for the server.
- **Base currency**: stays KRW; the settings say so ("원화 고정") instead of "coming soon".
- **Password policy** (Admin › 로그인 방식 › 비밀번호): a minimum length (8–128; default 8, as before) for every new password — change password, the admin's set password and, once a policy is saved, the admin's create account — and an optional lockout (off by default; after 3–20 failed sign-ins to one email, that email is refused for 1–1440 minutes, the same answer for an email with no account). The admin sees the locked emails and unlocks them. An existing shorter password still signs in. `GET /api/password-policy` gives the minimum to the screens.
- **Password generator**: "만들기" on the account's new password and the admin's account and password fields fills 20 random characters made in the browser, with a copy button; nothing is sent before saving.
- **API key management** (Settings › AI·연동): rename a key, change its scope (read ↔ write, with the confirmation method), extend its expiry by 30, 90 or 365 days from now (no expiry when the policy allows it), and see its last use and request count (`PATCH /api/keys/:id`). An expired key or someone else's key is not found (404).
- **API docs**: the new routes (own dates, currencies, rate refresh, key changes, password policy, sign-in locks).

### Changed
- Reverting a change set is refused when it would leave a subscription, plan change or spending with a currency that is not in the list.
- Exchange rates of listed currencies and of spendings keep up to six decimals (migration 0036), so a small unit such as VND is not rounded to two; a spending's rate takes up to six decimals (was two). USD's settings rate is unchanged.
- The server keeps each answer of the rate service for a few minutes (a failure for one), shared by "지금 갱신" and the daily refresh.

- The change history names the currency and own-date tables and their fields, shows field names for every table, and names the automatic refresh as its actor.
- A pending AI proposal stays valid after a rate refresh that changes no rate.

### Fixed
- Change sets saved before this release for the settings or the display settings can be reverted again (the new columns made them read as changed later).

### Not in 0.1.7
Connected apps (OAuth) come with 0.1.12 (MCP over OAuth); statements, the AI assistant and model connections stay "coming soon".

## 0.1.7-rc.2 — 2026-11-23

Budget and screen features that were "coming soon". Spec 013 revision 1 (`.agents/intent/013_budget-and-soon/spec.md`, S-14 to S-21). Migrations 0032 and 0033 (a table for one month's adjustments, a column for where a savings product's money goes at maturity, the subscription category "other").

### Added
- **This month only** (이번 달만 조정): on the Salary allocation simulation, a fixed, Savings total or Investment total row can be adjusted for one month (quick ±5만 / ±10만, an optional reason), or to the end of its phase as before; "조정 되돌리기" removes it. A ratio-split total's adjustment is that month's total, split by the ratios; an amount-split one is spread over that month's items in proportion. The Savings and Investment "총액 수정" offers the same "이번 달만". One adjustment per month and target.
- **Savings maturities** (만기 일정): products whose term reads "N개월" / "N months" / "YYYY-MM까지" / "until YYYY-MM" (with a start month) show their maturity month, the expected amount (the projected balance before maturity, or what the plan sends) and where the money goes then ("만기 후"). A maturity this month or past asks on Pending changes whether to stop sending (stop is saved; keep sending is remembered in this browser).
- **By month** (월별 기록) on Living and Investment: the planned amount of the last six months and this one (actual amounts come with statements in 0.1.9).
- **Overview**: "결제 추가" opens the spending add dialog; the remainder's "관리" opens the simulation tab; "내보내기" downloads this month's summary as CSV.
- **CSV** of the Spending General and Installments tabs (one row per round) and of the Subscriptions list (as filtered), made in the browser (UTF-8 with BOM for Excel).
- **Events across a year**: a schedule event may run into a later year (stored as `YYYY-MM~YYYY-MM`; the old forms are unchanged) and shows in every month of its range.
- **Subscription category "기타"** (other).
- **Change history period**: this month, the last 3 months, all, or chosen dates (`GET /api/changes?since=&until=`).
- **Search** (the header box, ⌘K / Ctrl+K): subscriptions, spendings, living items, accounts, cards, targets, events and check items by name and memo; a result opens its page.
- **Notifications** (the bell): pending changes (AI proposals, goal and maturity cards), payments and rounds in the next 3 days, a short remainder this month, a yearly limit at 90% or more, a short buffer; read marks are kept in this browser.
- **API docs** (`/api/docs`, signed in): the REST routes with their request bodies and the MCP tools.
- **MCP**: new read tools `search` and `list_notifications`; `get_overview` and `get_budget` show the month's adjustments and `get_budget` the savings maturities; `list_changes` takes `since` / `until`; `get_schedule` shows events across years; `propose_changes` takes month adjustments and `afterMaturity`.

### Changed
- Reverting a change set is refused when it would leave a buffer use's card without a paying account (newly), or a month adjustment on a target that cannot have one.
- The change history and the proposal cards name month adjustments.

### Still coming (0.1.7-rc.3)
Time zone, extra base schedules, a list of currencies and automatic exchange rates, password policy and generation, API key rename / scope / expiry / usage. Connected apps move to 0.1.12 (MCP over OAuth); the base currency stays KRW.

## 0.1.7-rc.1 — 2026-11-23

The budget core: Living, Savings and Investment menus, accounts with balances, goals and limits, cards, and paying a card purchase from an account's buffer, with MCP tools. Intent 013 (`.agents/intent/013_budget-and-soon/`). The database gains five tables and new columns (migrations 0028 to 0031); the old living row becomes living items.

### Added
- **Living** (`/living`): a list of living-cost items (category, usual payment method, monthly amount, from month, an amount per phase, memo). Their sum is the value of the Living total target. The Salary allocation page shows them read-only with a link to Living.
- **Savings** (`/saving`) and **Investment** (`/invest`): items are accounts of that menu; the menu splits by amount (each item's monthly amount, with amounts per phase) or by ratio (the phase's total × the item's ratio, rounded to the nearest 1,000 won). New target kinds Savings total and Investment total (one each) take the items' sum; a ratio sum under 100% leaves the rest in the remainder. "총액 수정" changes the current phase's total. Existing fixed targets are not changed or moved.
- **Accounts**: bank, last 4 digits, kind, rate and term (free text), buffer, goal, yearly limit and memo; targets can be linked to an account. An account's sheet holds its **balance records** (date, amount, and optionally the money put in at once that day) and a **12-month forecast** from the last record (what the salary split sends to it on the transfer day, buffer refills in, card bills paid through its cards out; no interest; an account that takes the remainder gets the remainder after the month's spendings, so only its buffer uses are counted on top, and an item of Savings or Investment gets nothing while its menu has no target). The accounts table shows this month's transfer and warns about targets without an account.
- **Goals**: when the forecast reaches an account's goal, Pending changes shows a card asking to stop sending to it. Stop sets the account's stop month (the next transfer month): its item amount and the fixed targets linked to it are 0 from then on, and the change can be reverted in the change history. Keep sending is not asked again for that goal. The sidebar badge counts these cards.
- **Yearly limit**: this year's planned payments plus the money a balance record names as put in at once (its optional "이번에 넣은 돈", such as a maturity payout; a balance alone is not counted as paid in); near (90%) and over are warnings only.
- **Cards**: name, last 4 digits, paying account and billing day (empty = the settings' card billing day). A card spending can name its card and is then billed on that card's day; a spending without a card is billed as before. The paying account of a card that a buffer use goes through cannot be cleared (it can be moved to another account), and such a card or account cannot be deleted.
- **Buffer use** (버퍼 사용, the fourth way to pay): a card purchase paid from the buffer kept in the card's paying account, refilled over 1 to 60 months on pay days by raising that account's transfer (each refill is the amount ÷ months rounded down to 10 won, the last takes the rest). Only the refills come off each month's remainder. A buffer use needs a card with a paying account; a short buffer is a warning only.
- **MCP**: read tools `get_budget` (living items, the savings and investment split with each item's amount, the targets' values) and `list_accounts` (accounts with balance records, forecast, goal month, yearly contribution and limit, buffer gauge, linked targets, cards); `get_allocation` shows the new target kinds and linked accounts. A write key can propose living items, accounts, balance records, cards and buffer-use spendings through `propose_changes`.

### Changed
- The change history names the new tables and fields, and the spending tables of 0.1.5 too.
- The three living values (food, transit, allowance) of 0.1.6 are three living items of the same amounts; every month's transfer, distribution and remainder is what it was. `PUT /api/living` and the MCP resource `living` still take the three values and set those items. A change of the old living row in the change history can no longer be reverted (its table is gone; the history still shows it).
- On the accounts table a row opens the account's sheet; the editor opens from its edit button.

### Not in this release candidate
- The one-month adjustment of the simulation, the second tabs of Living, Savings and Investment (monthly record, maturity schedule) and the rest of the "coming soon" features come in later 0.1.7 release candidates.

## 0.1.6 — 2026-11-23

Released without a release candidate, on the user's instruction ("rc.1 없이 stable"). The stable image `ghcr.io/bluenyang/allot:0.1.6` was checked on the test server after the release (spec 012 V-8): the server's answers for eight addresses (the app pages, the API, `/healthz`, `/api/mcp` and the session check) were recorded, and `tests/e2e/router.spec.ts` passed 42 of 42.

Addresses without `#`. Intent 012 (`.agents/intent/012_router/`). No database or API change.

### Changed
- **Addresses**: the app uses history addresses with the names the hash addresses had: `/` (overview), `/pay`, `/spend/general`, `/spend/inst`, `/spend/subs`, `/events`, `/pending`, `/history`, `/settings/general`, `/settings/theme`, `/settings/ai`, `/settings/security`, `/admin` and `/dev`. `/home` opens `/`; `/spend` and `/settings` without a tab, or with an unknown one, open the first tab; an unknown address opens `/`. Addresses are case-sensitive (`/PAY` opens `/`, `/spend/SUBS` opens the first tab). Routing uses vue-router 4.6.5.
- **Old addresses keep working**: every hash address of 0.1.5 (`#home`, `#pay`, `#spend/<tab>`, `#subs`, `#settings/<tab>`, `#account`, `#events`, `#pending`, `#history`, `#admin`, `#dev`) is replaced by its new address when it is opened or typed, without a second history entry; an unknown hash opens the overview. Two rare old forms are not carried over: a bare `#` typed on a page, and an encoded old hash on a path that a route record redirects (`/home`, `/spend`, `/settings` and unknown paths). `#subs?add` and `#spend/<tab>?add` open the add dialog as before; the new form is `/spend/<tab>?add`.
- **External-login linking** now returns to `/settings/security`; a link started before the update comes back to `/#account`, which still opens that tab, with its error message if there was one.
- The mobile app sign-in address (`/#app-login?return=…`) is unchanged.
- The server already served the app for every address outside `/api` and `/healthz`; this is now covered by a unit test.

## 0.1.5 — 2026-11-22

Same code as 0.1.5-rc.1, checked on the test server (spec 011 V-10). 0.1.5 brings one-off spending and the Spending menu; see the 0.1.5-rc.1 entry.

## 0.1.5-rc.1 — 2026-11-22

One-off spending, and the Subscriptions menu becomes Spending. Intent 011 (`.agents/intent/011_one-off-spending/`). The database gains two tables and one column (migrations 0025 to 0027).

### Added
- **Spending menu** (지출, in the Budget group): the former Subscriptions menu, with three tabs, General (일반), Installments (할부) and Subscriptions (구독), on `#spend/general`, `#spend/inst` and `#spend/subs`. The Subscriptions tab is the old page, unchanged (list, views, plan changes, transfer calculation, add, edit, delete). The old `#subs` and `#subs?add` addresses still work: `#subs` shows the Subscriptions tab and `#subs?add` opens the add dialog.
- **One-off spending**: a purchase paid at once (lump sum), by card installment (3, 6, 12 or 2 to 60 months, interest-free or with a fee total), or by split payment (2, 3, 4 or 2 to 60 payments that you make yourself: the same day every month, every 2 weeks, or custom dates). The amount is in KRW or USD; a USD amount is converted when you save, with the exchange rate and the buffer of the Settings, and the rate and buffer used are stored with the spending. Added in a three-step dialog (what was bought, how it is paid, rounds), with a category, a memo and delete (it can be reverted in the change history).
- **Rounds**: each spending is saved with its rounds. Each round is the total (principal plus fee) divided by the number of rounds, rounded down to 10 won; the last round takes the rest. A card bills its first round on the card billing day of the month after the purchase and then every month on that day (shifted off weekends and holidays as the other dates are). After saving, each round's date and amount can be edited (an edited round is marked "고침" and is not recalculated), and a round can be marked paid ("냄"). Changing the amount, method, count, fee or dates recalculates the rounds; it asks first when the spending has paid, edited or merged rounds (the confirm names how many), and otherwise saves directly; step 3 lists the new rounds with their states. Early payoff merges the remaining rounds into one new round on a chosen date and amount. A spending can be cancelled and resumed. A lump sum is cancelled in its editor (step 3, state: left / paid / cancelled): cancelling means it was refunded or never paid, so its round becomes left and is no longer counted (shown as "반영 안 함"), and the spending stays in the list; choosing left or paid resumes it. An installment or split is cancelled on the Installments tab, after a confirmation: it keeps its paid rounds and drops the rest; resuming it there saves at once.
- **How a round counts in its month**: a round counts in the calendar month of its date. Paid from the subscription account, it is added to that month's subscription transfer before rounding up; paid from the salary account or by card, it is subtracted from that month's remainder (a card round counts in the month of its billing day). Nothing is moved automatically: when the remainder goes negative it is shown as short, with a link to adjust the salary distribution. With no one-off spending, every amount is what it was before.
- **Reflection card** ("이번 달 지출 반영", on every tab): what comes off the remainder (split into general and installment), what is added to the subscription transfer (before and after), and the remainder after the distribution. The Salary allocation screen shows a "one-off spending" line under the remainder and the subscription transfer calculation shows a line for spending paid from the subscription account.
- **General tab**: a table of lump-sum spendings (content, category, date, amount, KRW, payment method, month it counts in, status: planned, billing soon, paid, cancelled), filters, summary figures and a card list on a phone. **Installments tab**: a list with a detail view, the round table (paid, next, left, merged by early payoff), progress, early payoff, cancel and resume, and summary figures.
- **Home and calendar**: "Record › One-off spending" opens the add dialog of the Spending page. Rounds due in the next 31 days appear in the upcoming payments on the home screen with the subscription charges ("n/N회"), and the calendar shows them as their own kind ("지출").
- **MCP**: a new read tool `list_spendings` (every spending with its rounds, state and progress; filters `status` and `month`); `get_overview` and `get_schedule` carry the rounds of each month as `spendingRounds`, apart from the subscription `payments`. A write key can propose creating, updating and deleting spendings through `propose_changes` (the rounds are sent with the spending); the preview shows the transfer and distribution before and after, and a change set of a spending can be reverted by the AI like the other resources.
- Korean and English text for every new string.

### Coming soon
- Paying from the buffer ("버퍼 사용", a fourth way to pay) is shown but cannot be chosen; it is planned for 0.1.6. The CSV export button on the Spending page is shown as "준비 중" and does nothing.

### Notes
- Round amounts are whole won. A spending is saved with all its rounds at once, and reverting its change set in the change history restores the rounds too.
- A spending is sent as a whole when it is saved, including from the MCP; the server does not work the rounds out for a proposal.

## 0.1.4 — 2026-11-21

Same code as 0.1.4-rc.3, checked on the test server. 0.1.4 brings MCP write through proposals (rc.1) and the redesign of every screen with the design system and UI components on Reka UI (rc.2, rc.3); see those entries.

## 0.1.4-rc.3 — 2026-11-20

Fixes from checking 0.1.4-rc.2 on the test server (spec 010 W-12). No server or schema change.

### Changed
- Segmented controls take the width of their content; none fills the row (the subscription editor's status and billing cycle included).
- Date and month fields use the app's own pickers (Reka DatePicker / MonthPicker, styled with the tokens) instead of the browser's: typing, picking from a calendar or a year card, and clearing. The stored values stay `YYYY-MM-DD` and `YYYY-MM`; a half-typed month in a field that may be empty gives an empty value, as the browser's field did.
- Deleting in an editor asks in a confirmation dialog ("… 삭제할까요?", cancel first) instead of a second press.
- Settings that save as soon as you choose them say so in a toast; the cards no longer change height.

## 0.1.4-rc.2 — 2026-11-20

Redesign of every screen and a design system. Intent 010 (`.agents/intent/010_canvas-redesign/`). Server changes: the remainder target is no longer fixed, and the MCP views use the same payment schedule as the screens (both below); the database schema is unchanged.

### Added
- Design system: `DESIGN.md` (tokens, dark palette rules, components, wording and "coming soon" rules) and `docs/design/foundations.html` / `foundations-dark.html` (static, no scripts). The dark palette is derived from the same tokens, including from a user-chosen colour, with a contrast check.
- "Coming soon" entries: items for features that do not exist yet are shown but disabled (`aria-disabled`, a "준비 중" / "Coming soon" pill) and do nothing when pressed. They are the sidebar items Living, Savings and Investing, Statement analysis and AI assistant; search and notifications in the header; the API docs link in the footer; export on the dashboard and CSV export of subscriptions; the AI model, key rename, scope change, extension, usage log and connected apps in Settings › AI & integrations; password policy and password generation in Settings › Security; automatic exchange rate, base currency, adding a foreign currency, time zone and adding a schedule in Settings; the history period filter. Those screens have no routes yet.
- Rounding unit for the subscription transfer: choose 10,000 / 50,000 / 100,000 or "off" (saved as 1 won). A different value that is already saved (for example 20,000) stays in the list, selected.
- Phase numbers are automatic ("Phase N", in order of start month). The phase code is no longer typed on screen; a saved code is kept as it is, and the server still accepts one.
- "Money left after the transfer" box on the dashboard (this transfer day to the day before the next, payments subtracted from the subscription transfer; negative when it falls short), and "after the 31st" (payments within a year, up to three lines).
- Subscriptions: search by name, a 12-month transfer chart and per-subscription share table (select a bar to switch month), two-step add/edit dialog, delete and cancel confirmations, two-step plan change.
- UI components on Reka UI (`reka-ui` 2.11.0, headless, MIT), styled with the app's tokens: a new Select replaces every native select (the open list is styled too, on desktop and phone); switches, segmented controls, tabs, help bubbles and dialogs are rebuilt on it. Keyboard and screen-reader behaviour follows Reka's WAI-ARIA implementation; the choices and saved values are the same as before.

### Changed
- Every screen follows the new design, in light and dark, on desktop and phone: dashboard (with a Pending tab for AI proposals), Pending changes, Subscriptions, Salary allocation, Schedule, Change history, Settings and Admin, and the sign-in screen.
- Sidebar in groups: Overview / Budget (Salary allocation, Subscriptions) / Schedule, Pending changes, Change history / Settings and Admin. The sidebar can be folded to icons. The header has the breadcrumb and month navigation.
- Theme (light/dark) is chosen in Settings only; the header buttons are gone.
- The Developer menu entry is gone; the page is still reachable at `#dev`.
- Phone: a top bar, a bottom bar with four items (plus AI proposals when one is waiting) and a "More" sheet (account, Pending changes, Change history, Settings, Admin, sign out; Statement analysis and AI assistant as coming soon). The calendar moves between months with the header arrows.
- Forms have one field per line; dialogs are 520px (a card on a phone), confirmations 440px. Amount fields show a ₩ prefix and accept what the number fields accepted (decimals, with or without thousands commas, 0).
- Settings › General has five sections; display formats are saved as soon as you choose them.
- The change-history item filter lists every table of the app, and the remainder split is named "remainder target" there.
- Reverting an applied proposal on the Pending changes screen reverts its change set; a rejected proposal cannot be reverted.
- Every page but the dashboard loads when it is first opened (a smaller first download). If its code cannot be downloaded (offline, or an old tab after a new version), the page says so and offers a reload.
- While a dialog is open the page behind it is hidden from assistive technology and cannot be clicked; Escape closes the topmost layer first (an open list or help bubble before the dialog).

### Removed
- The rule that the remainder target must exist and keep its kind. It can now be deleted, or changed to another kind (living, subscription-transfer and remainder targets are still at most one each; fixed targets may be many). Without it, what is left of the net pay after the targets is shown as staying in the salary account ("short" when negative), and the MCP overview carries `unallocatedKrw`. The remainder split rows stay when the target is deleted. A change set that removed the target can be reverted even though the remainder target is missing.

### Fixed
- Recurring payment dates are anchored to the billing day: after a short month the next date returns to the 31st (28/29 February included).
- Switching between monthly and yearly plans no longer skips a payment, and the payment schedule no longer depends on how far ahead it is asked for.
- The subscription list, the calendar and the MCP `list_subscriptions` next payment now come from the same schedule.
- Switching accounts (sign out, another account) no longer lets a response started under the previous account reach the next one: state loads, proposals, toasts and saves are dropped when the session changed.
- The change history counts only the changes loaded so far ("of the loaded changes"), and when a filter shows nothing but older changes exist it says so instead of "none".
- Event timing accepts typed values again ("direct entry"), checked only by the server's pattern (`YYYY-MM` or `YYYY-MM~MM`); a stored value the month picker cannot hold opens in the text field unchanged.
- Editing the remainder split without touching a ratio saves the stored ratio unchanged.
- Unit tests that start git in a temporary repository no longer inherit the git hook's repository variables; run by the pre-commit gates inside a linked worktree they could mark the real repository bare.

## 0.1.4-rc.1 — 2026-11-18

MCP write through proposals. Intent 009 (`.agents/intent/009_mcp-write/`).

### Added
- Write scope for API keys, chosen when the key is created (`write`, with `confirm`): it cannot be changed afterwards, make a new key instead. A key without it sees no write tools. A write key never changes keys, logins or admin settings.
- Four MCP tools for a write key: `propose_changes` (1 to 20 changes, all applied together or not at all), `propose_revert`, `get_proposal` and `apply_proposal`. The AI can create, update and delete subscriptions, plan changes, phases (with their fixed amounts per allocation target), allocation targets, the remainder split, plan events and check items, and update the settings (net pay, pay days, exchange rate) and the living costs. Accounts, debts, holiday sets and display settings cannot be changed.
- Nothing changes when the AI proposes. The server applies the changes inside a transaction and rolls it back to build the preview: the rows before and after, and the subscription transfer and salary distribution of this month and the next, before and after. A change that breaks a rule makes no proposal and returns the reason.
- Confirmation per key, chosen at creation: on the Allot screen (default), or in the chat, where the AI calls `apply_proposal` after you agree. A screen-confirmed proposal cannot be applied by the AI.
- "Pending changes" screen with a badge in the sidebar: each proposal's changes, rows before and after and the transfer and distribution before and after, with confirm and reject.
- Applying checks everything again: a proposal is refused when the data changed since it was proposed (stale), when it expired (24 hours for screen confirmation, 15 minutes for chat), or when its key was revoked, has expired or lost the write scope, or the account is not active. At most 20 pending proposals per account.
- An applied proposal is one change set labelled "AI · <key name>" in the change history. It can be reverted there like any other, or by an AI `propose_revert`, which is limited to the same resources the AI may change.
- One per-user data lock now orders every write to a user's data (screen, API, proposals, account moves, seeding), so a proposal that is applied while the screen saves cannot interleave.

### Known limitations
- A new allocation target and the phase amounts that use it need two proposals: the server assigns the id of the new target. The tool description tells the AI to propose in two steps.

## 0.1.3 — 2026-11-17

Same code as 0.1.3-rc.1, checked on the test server.

## 0.1.3-rc.1 — 2026-11-16

Read-only MCP endpoint, API keys, and a Korean/English interface. Intent 008 (`.agents/intent/008_mcp-read-language/`).

### Added
- MCP read endpoint at `POST /api/mcp` (Streamable HTTP, stateless) with six read-only tools: `get_overview`, `list_subscriptions`, `list_plan_changes`, `get_allocation`, `get_schedule`, `list_changes`. Each runs as the key's owner, under the same row-level security as the app. No tool changes data. See the README for how to connect a client.
- API keys, in Settings › AI & integrations: stored hashed, shown once when created, scoped to `mcp:read`, with an expiry (1 to 365 days), revocation and a last-used time; at most 10 live keys per account. A key works only at `/api/mcp`, never as a session for the other API.
- Admin switch (Admin › API key tab) for keys without an expiry, off by default, or `ALLOT_API_KEY_NO_EXPIRY=true|false` (env wins and locks the switch). While it is off, every key without an expiry gets one year from the moment it is switched off or the server starts.
- Abuse limits on the endpoint: 20 failed authentications per client address in 10 minutes (then 429 with `Retry-After`; every failure is the same 401 whatever the reason), and 120 requests a minute per key. The Host and Origin of a request are checked against `TRUSTED_ORIGINS` / `BETTER_AUTH_URL`.
- Interface language: Korean and English, chosen in Settings › General (or follow the browser). Menus, pages, amount units, calendar text, holiday names and the messages the server returns follow it; the sign-in screen uses the language last chosen in this browser, then the browser's language. `Accept-Language` picks the language of API error messages.

### Security
- Lifted the `esbuild` that `@esbuild-kit/core-utils` pulls in past GHSA-67mh-4wv8-2f99 with a package override (6937d61).

### Changed
- The commit and push gates now include the unit tests, and the Playwright E2E is an optional gate (69c53b9).

## 0.1.2 — 2026-11-16

Stable. Same application code as 0.1.2-rc.3. Login and admin (intent 006) and the redesign with display settings, holiday rule sets and the calendar (intent 007); the upgrade notes are under 0.1.2-rc.1.

## 0.1.2-rc.3 — 2026-11-16

### Changed
- The sidebar edge has a visible handle (a small bar on the border line) that highlights on hover, focus and while dragging.

### Fixed
- Dragging the sidebar edge turned the page background teal until the drag ended.

## 0.1.2-rc.2 — 2026-11-16

Layout changes asked for after rc.1 (spec 007 S-20, S-21).

### Changed
- Sidebar: opens wider (272px); drag its edge, or focus the edge and use ←/→ (Shift for bigger steps), Home/End, to set 200–360px; a double-click goes back to the default. A button folds it to icons only. Width and folding are remembered in this browser.
- On a wide screen the content column sits in the middle of the space next to the sidebar; the header bar and footer line up with it. The header keeps one line on narrow windows: the search box drops its hint, then becomes its icon.

## 0.1.2-rc.1 — 2026-11-16

Login and admin. Intent 006 (`.agents/intent/006_login-admin/`). Redesign and display settings, intent 007 (`.agents/intent/007_redesign/`).

### Upgrading from 0.1.1
- **`ALLOT_MASTER_KEY` is required**: 32 random bytes in base64 (`openssl rand -base64 32`). Without it the app does not start and says why. Keep it apart from database backups.
- The existing login account stays, with its data, and becomes the admin. Nothing else changes until you turn on another login method.

### Added
- Login with generic OIDC (one provider, standards only: discovery, PKCE, ID token checked against JWKS; Dex, Authentik, Keycloak by settings), GitHub and Google, next to the password. Each method is switched on and off in the admin screen or by env (`AUTH_<P>_*`; env wins and locks the field); a change applies without a restart.
- Sign-up policy per provider: admin-created accounts only, approval, or rules (email list, OIDC group, GitHub organization, Google domain). Accounts admitted by a rule are checked again at every login. External accounts link by provider identity (OIDC: issuer + subject), never by a matching email alone.
- Admin screen: accounts (create, approve, roles, ban, password reset, end sessions, full delete with the email typed again) and login methods. The admin sees account details only, never anyone's financial data; impersonation is off; the last admin cannot be demoted, banned or deleted. Password login cannot be switched off while no admin has another login.
- First admin from env: `ADMIN_EMAIL`, or `ADMIN_OIDC_SUBJECT` for an OIDC-only start.
- Account screen: linked logins (link, unlink), password change.
- Envelope encryption (AES-256-GCM, a data key per user wrapped by `ALLOT_MASTER_KEY`) for external login tokens and client secrets entered in the admin screen; `pnpm keys:rotate` re-wraps the data keys after a master-key change.
- For a future mobile app: `Authorization: Bearer` sessions, and a return to the app after an external login through a one-time token, only to URLs listed in `ALLOT_APP_RETURN_URLS` (off by default).
- `pnpm db:admin`: the admin account without any data file (a fresh clone starts here). New accounts start from default settings and empty lists.
- Development: Dex in `docker/compose.dev.yaml` as the test OIDC provider (behind the Vite proxy at `/dex`).
- Redesign: a new look across the app — neutral grounds, green for actions, orange for signals, small corners, tables; IBM Plex Sans KR and Mono bundled with the app (no font CDN); grouped sidebar with the user, page headers, a footer; editors open as a modal.
- 설정 (per account): 일반 — light/dark/system, date format, amount unit (원·천원·만원), negatives, exchange rate and buffer, pay/transfer/billing days and what to do when one falls on a weekend or holiday; 테마 — primary and accent colours (presets or your own, kept readable at 4.5:1), corners, density. Changes are in the change history and can be reverted.
- Holidays as rule sets (iCalendar RRULE, Korean lunar dates as `RSCALE=DANGI`, RDATE/EXDATE, substitute holidays). The public holidays of Korea are built in; add your own sets (company days, election days).
- 일정: a month calendar with the monthly dates, subscription payments, plan changes and holidays (loaded only when opened).
- 현황: KPI strip; the 이번 달 tab shows the distribution, the next six months of subscription costs, upcoming payments, plan changes, upcoming events and the checklist (예정 and 확인할 것 show their own cards). 구독: table with status, category and payment-path filters, a two-line list on phones.
- Saturdays in blue and Sundays in red on the calendar (also the days of the months around it and the phone list) and on the dashboard payment dates.
- A light/dark switch in the header; light is the default, dark uses neutral greys.

### Changed
- Several accounts are normal now: the seed no longer refuses other accounts, and `--replace-admin` takes the old account's email.
- `/api/state` answers default settings for an account that has saved none yet (was 409).
- Development `BETTER_AUTH_URL` should be the computer's LAN address, so the api container reaches Dex.
- Menu names: 분배 → 월급 분배, 내역 → 변경 내역; 계정 is now 설정 › 로그인·보안 (`/#account` still opens it). The pay days and exchange rate moved from 월급 분배 to 설정 › 일반.
- Migrations 0018–0020 add the `preference` and `holiday_set` tables (row-level security forced) and `settings.day_shift` (default: no shift, so every month computes as before); 0020 makes light the default theme.

### Fixed
- The session check (`/api/auth/get-session`) allowed 100 requests a minute per address and the app read a 429 as signed out, so a busy tab could land on the login screen. The limit is 600 a minute, and a 429 now shows a wait note and retries after the time the server gives.

## 0.1.1 — 2026-11-12

Stable. Same application code as 0.1.1-rc.1; adds the env-file guard (`scripts/guard-env.mjs`, PR #7).

## 0.1.1-rc.1 — 2026-11-11

Security foundation. Intent 005 (`.agents/intent/005_security-foundation/`). The screens and the distribution stay the same.

### Added
- Every row has an owner (`user_id`); existing data goes to the existing account on upgrade (migration 0006 refuses when that is ambiguous). References between tables only reach rows of the same user.
- PostgreSQL row-level security on every owned table, forced for the table owner; each request runs as its user. The server warns at start when its database role bypasses it or a table lacks it.
- Change history: every save is a change set; the new 내역 tab lists them and reverts one like a commit (refused when the rows changed since). `CHANGE_LOG_RETENTION_DAYS` prunes old sets (off by default).
- `TRUSTED_ORIGINS` for production; the production example routes through Traefik (HTTPS) and runs read-only without Linux capabilities.

### Changed
- `docker/compose.yaml` is now the production example (was `compose.prod.yaml`, removed); local development and tests use `docker/compose.dev.yaml` with `docker/.env.dev`.
- `pnpm db:seed` writes the account first; `--replace-admin` moves the data to the new account instead of losing it.
- Locks are per user (advisory locks) instead of table locks.

## 0.1.0 — 2026-11-11

First stable release. Intent 004 (`.agents/intent/004_release-image/`).

### Added
- Production image `ghcr.io/bluenyang/allot` (linux/amd64): one Node process serves the built front end and the API, applies migrations on start; `docker/compose.prod.yaml` example with an external PostgreSQL 16.
- Manual release workflow (GitHub Actions, `workflow_dispatch`): version → tag → gates → image → draft Release.

### Changed
- The server sets the client IP for the login rate limit itself: the socket address, or `TRUSTED_PROXY_IP_HEADER` behind a trusted reverse proxy. Client-sent headers are never trusted otherwise.
- `docker/.env.example`: database user and name `allot`; production settings.

## 0.1.0-rc.3 — 2026-11-10

Intent 003 (`.agents/intent/003_public-cleanup/`). Prepares the repository for a public origin.

### Changed
- Allocation is data, not code: **allocation targets** (name + kind: living total / subscription transfer / fixed per phase / remainder), per-phase amounts per fixed target, and a **remainder split** (was the hard-wired split of the rest). Setting "subscription transfer rounding" (`subRound`).
- Migrations 0002–0004 move existing data; the distribution for the same data is unchanged (checked over 36 months).
- Screen copy no longer carries personal notes or account names; names come from the user's data. The dev tab shows only the current data.

### Added
- Allocation target editor; phase editor asks an amount per fixed target.
- API: `/api/targets` (one living / subscriptions / remainder each; the remainder cannot be removed), `/api/remainder-split`.

## 0.1.0-rc.2 — 2026-11-10

Intent 002 (`.agents/intent/002_rename-allot/`).

### Changed
- The product is now **Allot**: logo letter A, sidebar, mobile header, login, page title, package name, compose projects `allot` / `allot-dev`, client-IP header `x-allot-client-ip`.
- New palette: deep green accent with an amber secondary, green-tinted neutrals and sidebar, light and dark.

### Fixed
- Subscription avatar letters were hard to read in dark mode (white on bright colors); they now use a per-mode ink.

### Added
- `tests/contrast.mjs`: WCAG contrast check of the palette (text 4.5:1 or 7:1, chart marks 3:1).

## 0.1.0-rc.1 — 2026-11-10

Intent 001 (`.agents/intent/001_persistence-login-docker/`). Audit: `.agents/audit/0.1.0.md`.

### Added
- PostgreSQL storage for every item through a Hono API and Drizzle ORM; migrations in `drizzle/`, applied on api start.
- Login with Better Auth: email + password, sign-up closed, one account (created by `pnpm db:seed`), sign-in limited to 5 per minute.
- Editors for every item: settings, living costs, phases, events, checklist, accounts, debts, ISA split, subscriptions (with memo) and plan changes.
- Subscription editor shows base vs. applied values when a plan change in effect overrides a field.
- Docker development stack (`docker/compose.yaml`): web on port 15173 (LAN), api and PostgreSQL 16 on the internal network only. `docker/compose.dev.yaml` for tests.
- Seed runner `pnpm db:seed [file]` (idempotent; `--replace-admin` to change the account).
- Playwright E2E (`pnpm e2e`) and an API check (`tests/api/crud.mjs`).

### Changed
- npm → pnpm 12; Vue 3.5, Vite 8, TypeScript 6.0, Node 26 in Docker.
- The app reads data only from the API; `src/data/seed.ts` and the single-file build are gone.
- JSON export includes accounts, debts and the ISA split.

### Removed
- "처음 값으로 초기화" in the 개발 tab (use `pnpm db:seed`).

### Security
- The LAN-facing dev server mounts only front-end files, and Vite denies private paths (found in review: the whole repo, including local data and session files, had been readable).
