# Allot design system

The rules the screens follow. Tokens live in `src/style.css`; the dark colours are derived in `src/lib/theme.ts` (`derive`, `lift`) and checked by `tests/unit/theme.test.ts` and `tests/contrast.mjs`. Static renderings of the token pages: [`docs/design/foundations.html`](docs/design/foundations.html) and [`docs/design/foundations-dark.html`](docs/design/foundations-dark.html).

Principles: neutral grounds, green only for action and selection, orange as a signal (due soon, difference, needs a look, AI) on a few spots per screen, small corners, tables and lines instead of cards inside cards. Numbers come first: tabular figures, amounts right-aligned.

## Tokens

Light is the base; dark overrides the same names. The two dark blocks in `style.css` (the media query and `[data-theme="dark"]`) stay identical.

### Neutrals

| token | light | dark | use |
|---|---|---|---|
| `--bg` | #F5F6F5 | #0F1011 | page ground |
| `--surface` | #FFFFFF | #17181A | cards, tables, sidebar |
| `--surface-2` | #F9FAF9 | #1D1F21 | raised: table header, hover |
| `--fill` | #EEF0EF | #232528 | nav hover, count pill, seg track |
| `--divider` | #EEF0EF | #232528 | row lines |
| `--input` | #FFFFFF | #111213 | input ground (one step darker than the surface in dark) |
| `--ava` | #E9ECEA | #2B2D31 | avatar ground |
| `--border` / `--border-strong` | #E2E5E3 / #CBD0CD | #2B2D31 / #3A3D42 | lines, control borders |
| `--text` / `--text-2` | #16201B / #2F3A35 | #ECEDEE / #C9CBCE | body, labels |
| `--muted` / `--subtle` | #47534D / #5F6B65 | #A0A3A8 / #8B8F95 | secondary text, captions |
| `--sel` | `var(--primary-soft)` | `var(--fill)` | selected nav, tab, bottom item, chip: green tint in light, grey in dark |
| `--scroll` / `--scroll-hover` | #CBD0CD / #A3ACA7 | #3A3D42 / #5A5E64 | scrollbar thumb |

### Primary and accent

Set in Settings; these are the defaults. The dark column is what `derive` gives for the defaults (see "Dark palette").

| token | light | dark | use |
|---|---|---|---|
| `--primary` | #14705A | #2FBC9A | main button, selected underline, key figure |
| `--primary-ink` | #FFFFFF | #0C0D0E | text on `--primary` |
| `--primary-text` | #14705A | #2FBC9A | links, selected text, focus ring |
| `--primary-soft` | #E8F1EF | #1B322E | ok badge, step marker |
| `--primary-mid` | #7EB0A4 | #247260 | secondary green |
| `--primary-hover` | #105B49 | #63CDB3 | link hover (4.5:1 on surface and bg) |
| `--primary-tint` | #F4F8F7 | `var(--surface-2)` | selected choice, result box |
| `--primary-line` | #D0E2DE | `var(--border)` | result box border |
| `--accent` | #E0670E | #ED7B26 | signal fill |
| `--accent-ink` | #16201B | #16201B | text on `--accent` (dark ink in both modes) |
| `--accent-soft` | #FBEDE2 | #39281C | signal badge ground |
| `--accent-line` | #F3C29F | #77451F | signal border |
| `--accent-text` | #9D480A | #ED7B26 | signal text |

The light `--primary-hover`, `--primary-tint` and `--primary-line` are derived from the primary colour (hover: the guarded fill mixed .19 toward black; tint and line: mixes with white) and sit within one or two steps per channel of the canvas values; the canvas values are hand-picked and no single formula reproduces them. `--primary-hover` is guarded to 4.5:1 on `--surface` and `--bg` in both modes, so a link stays readable for any user colour.

### Semantic

| token | light | dark | use |
|---|---|---|---|
| `--neg` / `--neg-soft` / `--neg-text` / `--neg-line` | #C0362C / #FBEAE8 / #A8322A / #E8BDB8 | #E5675C / #2A1C1B / #F08C82 / #6B2E2A | error, over budget, delete |
| `--info` / `--info-soft` / `--info-text` | #2E6B9E / #E8F0F7 / #245580 | #6FA8DC / #1B232D / #6FA8DC | information, investment |
| `--sat` | #1F5FA8 | #6FA8DC | Saturday |
| `--sun` | #C0362C | #F08C82 | Sunday |
| `--up` / `--up-soft` | #B4245D / #F8E7EE | #F07FA8 / #2B1E24 | an amount that went up (+₩) |
| `--c1` … `--c7` | series hues | lightened series hues | charts, avatars (`--av-ink` is the text on them) |

### Shape, shadow, type

| token | value | use |
|---|---|---|
| `--r-tag` / `--r-badge` / `--r-ctl` / `--r-card` | 2 / 3 / 4 / 6 px | tag, badge, control, card |
| `--r-pop` | 10px | modal, popover, toast, login card, top of a sheet |
| `--shadow-pop` | `0 16px 40px rgba(16,24,20,.18)`; dark `rgba(0,0,0,.40)` | modal, popover |
| `--shadow-login` | `0 16px 40px rgba(16,24,20,.08)`; dark `rgba(0,0,0,.18)` | login card only (canvas value, lighter than `--shadow-pop`) |
| `--shadow-1` | `0 1px 2px rgba(16,24,20,.12)`; dark `rgba(0,0,0,.26)` | small raise |
| `--backdrop` | `rgba(16,24,20,.45)`; dark `rgba(0,0,0,.61)` | behind a modal |
| fonts | IBM Plex Sans KR (UI), IBM Plex Mono (codes, dates), tabular figures for numbers | |
| sizes | KPI 26/700, H1 22/700, H2 15/600, body 14, table 13, small 12, label 12/600 | |
| spacing | 4-unit steps: 4, 8, 12, 16, 20, 24, 32 | |

Focus: `:focus-visible` draws a 2px `--primary-text` outline with a 2px offset. Inputs keep that ring and also take a `--primary-text` border on focus. Links turn `--primary-hover` on hover.

## Dark palette

Dark is neutral grey with no green cast: ground, surface and lines have almost no saturation. Height is shown by lightness (the higher a surface, the lighter), and shadow is for modals only. A selected menu or tab is a light grey face (`--sel`) with the green only in the icon, text and underline.

The primary and accent colours come from the user's light-mode choice through `lift(hex, L, S)` in `src/lib/theme.ts`, the canvas formula:

1. Convert the colour to HSL.
2. Raise the lightness to at least `L` and cap the saturation at `S`.
3. Convert back.

Primary uses `lift(P, 0.46, 0.60)`; accent uses `lift(A, 0.54, 0.85)`. With `S` = `--surface` (#17181A) and `g`, `a` the lifted colours:

| token | rule |
|---|---|
| `--primary`, `--primary-text` | `g` |
| `--primary-soft` | `mix(g, S, .84)` |
| `--primary-mid` | `mix(g, S, .45)` |
| `--primary-hover` | `mix(g, #FFFFFF, .25)` |
| `--accent`, `--accent-text` | `a` |
| `--accent-soft` | `mix(a, S, .84)` |
| `--accent-line` | `mix(a, S, .55)` |
| `--primary-ink` | #0C0D0E (white when the dark ink does not reach 4.5:1) |
| `--accent-ink` | #16201B (white when the dark ink does not reach 4.5:1) |

`mix(a, b, t)` is `t` of the way from `a` to `b`, per channel. The defaults give #2FBC9A and #ED7B26. A colour that would fall short is lightened until it passes (below). The default colours must derive exactly the tokens in `style.css`; a unit test holds that.

### Contrast rules

- Text pairs: 4.5:1 (body and muted text 7:1 on the ground; large text 3:1). Fills stand out from the ground at 3:1. Control borders against the surface: 1.3:1.
- Orange badge and count text is the dark ink in both modes. Light text on the dark orange (#ECEDEE on #ED7B26) is 2.4:1 and is not used; the dark ink is 5.9:1.
- `tests/contrast.mjs` checks the pairs of the real tokens in both modes; `tests/unit/theme.test.ts` checks 500 random user colours and the presets.

## Components

The shared components are in `src/components/`; their styles are in `src/style.css` and in the component files. Anything marked "not built" has no component yet.

**Basis: Reka UI.** The interactive components (Select, Switch, Seg, SubTabs, Tip) are built on Reka UI (`reka-ui`, MIT, headless: behaviour, keyboard and WAI-ARIA, no styles); their look is only these tokens. No Tailwind and no shadcn-vue. Keep each component's public props and events when its inside changes. A new interactive control starts from the matching Reka primitive and is styled here, not hand-rolled.

**No native select.** The browser's `select` element is not used anywhere in the app: its opened list cannot follow the tokens and differs per platform, and on a phone it would be a different control. Use `Select` for every choice from a list (a short list of two to five modes is a `Seg`).

### Select (`Select.vue`, `.in.sel-t` + `.sel-pop`)
A button that looks like `.in` (same height, border, radius and focus colour; a chevron at the right) opening a list on Reka's Select. The list is a card (`--surface`, `--border`, `--r-card`, `--shadow-pop`), one option per row (36px, 44px on a phone), the highlighted row on `--fill`, the selected one in `--primary-text` with a check on the right; it is as wide as the trigger at least and stays 8px inside the screen. API close to the native one: `v-model`, `options` (`{ value, label, disabled? }`, values string or number and given back as they were), `id` (a `<label for>` names it), `aria-label` / `aria-labelledby`, `placeholder`, `disabled`. A stored value that is not among the options is shown and stays selected (an extra option). Inside a dialog the list opens inside it, and Escape closes the list only. Keyboard: Enter, Space or the arrows open it, arrows move, Enter picks, Escape closes and the focus returns to the trigger.

**No native date or month input.** The browser's `date` and `month` inputs are not used anywhere: the calendar they open cannot follow the tokens and differs per platform. Use `DateInput` for a day and `MonthInput` for a month.

### DateInput (`DateInput.vue`, `.in.dpf` + `.dp-pop`)
A day field on Reka's DatePicker: three typed parts in the language's order (digits and arrows move through them; each part moves on by itself) and a calendar button inside the field that opens a calendar card (`--surface`, `--border`, `--r-card`, `--shadow-pop`; cells 34px, 40px on a phone; the selected day on `--primary`, today with a `--primary-text` ring, Saturday `--sat` and Sunday `--sun`, days outside `min`/`max` dimmed). The model is the stored string `YYYY-MM-DD`, or '' for none; a half-typed date is ''. `min` / `max` dim days and mark the field invalid; a typed day outside them is still taken. `clearable` adds a clear button, `aria-label` names the field. The card opens inside the dialog that holds the field and Escape closes it only.

### MonthInput (`MonthInput.vue`, `.in.dpf` + `.dp-pop.mp`)
A month field: a text field (`YYYY-MM`; `2027-3`, `2027.03` and `202703` are read too) with a calendar button that opens a year card of twelve months (Reka MonthPicker; the selected month on `--primary`, this month ringed). The model is the stored string `YYYY-MM`, or ''. A full month is taken as it is typed. In a `clearable` field any text that is not a full month (emptied, or half erased such as `2031-`) gives '' — as the browser's month input did — while the text stays visible to finish; the caller decides what '' means (no end, or its own required-field error). Only a field without `clearable` (the subscription filter months) puts back the last month when the text is not one. `min` / `max` dim months; a typed month outside them is still taken. Same card and Escape rule as `DateInput`.

### Buttons
Class `.btn` (`.pri`, `.bad`, `.sm`, `.icon`, `.ghost`). Height 36px, small 30px (inside a modal 40 and 32; login 44). Primary is `--primary` fill with `--primary-ink`; secondary is a bordered surface; the signal button is `--accent`; delete (`.bad`) is bordered in `--neg-text`. One primary button per view or modal.

### Form, one field per row
A form is a column of rows: label above, control below, optional help text under the control. Never two fields on one row. A mark `(선택)` / `(optional)` follows the label of a field that may be empty. The required star (`.star`, accent text) is presentation only: do not add `required` to a field the API accepts empty; the server decides what is valid. An error replaces the help text under the field, is tied to the input with `aria-describedby` and `aria-invalid`, and uses `--neg-text` on a `--neg` border.

### MoneyInput (`MoneyInput.vue`, `.money`)
A text input with a right-aligned number, an optional prefix or suffix, and thousands separators while typing. It accepts everything a number input accepts (decimals, with or without commas, zero); it never narrows what the server takes.

### EditSheet (`EditSheet.vue`, `.modal`)
The modal form. Its delete button asks in a `ConfirmDialog` ("{name}을(를) 삭제할까요?", `deleteName` names the item; the cancel button has the first focus); there is no press-twice delete. Width 520px by default (`width` also takes 440, 560 or 640; full width minus 32px on a phone), radius `--r-pop`, `--border-strong` border, `--shadow-pop`, over `--backdrop`. Header with the title and a close button; the body scrolls; the footer holds the actions right-aligned (cancel left of the primary). A stepped modal puts a centred step list (`ol.stp`, labelled for the steps, short connectors) in the header and the footer moves between steps.

### ConfirmDialog (`ConfirmDialog.vue`, `.cdlg`)
A 440px `alertdialog` with a short sentence and two buttons; the destructive one is named by its action, not "OK" (`danger` makes it `.bad`).

### Sheet (`Sheet.vue`, `.shd`)
On a phone a bottom sheet replaces a popover or the "more" menu: radius `--r-pop` on top, a grabber, rows at least 56px tall, closes on Escape, the backdrop or a drag down.

### Toast (`Toast.vue`, `.toast`)
A short message at the bottom, radius `--r-pop`, `--shadow-pop`. It tells what happened ("Saved"), never asks a question, and goes away by itself; an error (`role="alert"`) stays until dismissed. A setting that saves the moment it is changed says so here, never in a line inside its card (the card would change height).

### Seg (`Seg.vue`, `.seg`)
Two to five exclusive options (Reka ToggleGroup, single) on one track (`--fill` ground, 5px outer radius, 4px buttons); the selected button (`aria-pressed`) is raised on the surface. `bordered` gives the joined variant with a `--sel` selected face. Use it for a mode, not for navigation.

**Width rule.** A `Seg` is a switch, not a field: its width is its content (`width: fit-content`), whatever holds it (a form grid, a flex column, a modal, a phone). It never stretches to the row. Every segment in a modal is content width, the same in all modals. `block` (fills the row and shares it evenly) is only for a one-line substitute for tabs whose number of options is fixed; no screen uses it now. Full-width uses: none. Content-width uses: the status, cycle and currency choices of the subscription editor and the plan change, the method of the debt editor, the state of the event editor, the role and state of the user editor, the key expiry, the settings and theme choices, and the filters of History, Pending and Subscriptions.

### Switch (`Switch.vue`, `.switch`)
A button with `role="switch"` and `aria-checked` (Reka Switch); on is `--primary`. Name it with `label`.

### Tip (`Tip.vue`, `.tip`)
A 16px round "?" beside a field label (beside it, not inside it, so the field's name stays short). Hover, focus or a tap opens a bubble (Reka Popover) below it, above when there is no room (`--text` ground, 240px, 12px text); the name read aloud is "Help: …". For a sentence of help that does not fit under the control; it holds no action.

### Pill (`Pill.vue`, renders `.chip`)
A fully rounded choice or filter, `aria-pressed` when selected. Selected: `--sel` ground with a `--primary-text` border. The count (`.c`) uses `--fill`; a signal count uses the soft accent.

### SubTabs (`SubTabs.vue`, `.subtabs`)
Reka Tabs (selecting is by click or Enter, arrows only move the focus). Icon and label, 42px tall; the selected tab has a `--sel` face and a 2px underline in `--primary-text`; overflow arrows when the row scrolls. For switching views of the same data on one page only.

### Table
Header on `--surface-2` with `--subtle` text, row lines in `--divider`, amounts right-aligned with tabular figures, dates in the mono font. Plain markup (`.tbl`); not built as a component.

### Badges and callouts
Badge: 12px/600, `--r-badge`, soft ground with matching text. Status badges: ok = primary soft, needs a look = accent soft, ended = fill. A callout is a soft face with an icon and one sentence. Plain markup; not built as components.

### PageHeader, MonthPicker
`PageHeader.vue` (`.ph`) is the page title with an optional description and an actions slot. `MonthPicker.vue` (`.ymbar`) steps a month back and forward.

### "준비 중" / Soon (`Soon.vue`, `.is-soon`)
A control or menu item for a planned feature is shown but disabled: `aria-disabled="true"` (not the `disabled` attribute, so it stays focusable), muted text, no hover face, and a small "준비 중" / "Soon" pill (`.soon-pill`). Activating it does nothing. It never takes the selected state and never navigates.

## Spending screens

The menu is **지출** / Spending (Budget group; the old Subscriptions menu). One page, `Spending.vue`, with a page header, a reflection card and `SubTabs` for General, Installments and Subscriptions; the add button changes with the tab. The Subscriptions tab holds the whole former Subscriptions page unchanged. The CSV export button in the page header is a `Soon` item.

- **Reflection card** ("이번 달 지출 반영"): three columns, what comes off the remainder (a two-colour bar split into general and installment), what is added to the subscription transfer (before → after) and the month's remainder after the distribution (one column on a phone); a short remainder is shown as "모자라요" with a link to the salary allocation, and no other amount is changed.
- **General tab** (`SpendGeneral.vue`): three summary figures, a status filter (`Seg`), payment and category `Select` filters, and a `.tbl` table (content, category, date, amount, KRW, payment method, month it counts in, status badge); on a phone each row is a card. An empty filter shows an empty state.
- **Installments tab** (`SpendInstallments.vue`): three summary figures, a status `Seg`, a `Select` for the way of paying (card installment, split; buffer is disabled) and a list with a detail panel: totals, progress, the round table (paid, next, left, merged), and the actions edit, early payoff (`PayOffDialog`, 440px `EditSheet`), cancel (`ConfirmDialog`) and resume (a lump sum is cancelled and resumed in its editor instead). A round opens `RoundEditor` (date, amount, left or paid).
- **Add and edit** (`SpendEditor.vue`): a stepped `EditSheet` with three steps (what was bought, how it is paid, rounds). How it is paid is a `Seg` whose "버퍼 사용" option is disabled, with a hint that it is coming soon; the last step lists the rounds before saving. A lump sum's state control (left / paid / cancelled) is on the last step. Saving asks in a `ConfirmDialog` only when recalculating would drop edited, merged or paid rounds. Delete is on the last step when editing and asks in a `ConfirmDialog`.

## Copy rules

- Every visible string exists in Korean and English (`src/i18n/ko.ts`, `src/i18n/en.ts`); screen code holds no Korean text (`node scripts/check-i18n.mjs`).
- Buttons name the action ("저장", "삭제"), not the answer. A confirm repeats the object ("이 구독을 삭제할까요?").
- `(선택)` / `(optional)` marks an optional field; the red/green required star is a visual hint only (see Form).
- Numbers: won with thousands separators, the display format of Settings (unit, negative style, date style) applies everywhere through `src/lib/format.ts`.
- No real names, accounts, products or amounts in samples, docs or tests: use neutral examples.

## Changing this file

Token values change in `src/style.css` and, for derived colours, in `src/lib/theme.ts`, together with the unit test and `tests/contrast.mjs`. Update the tables here in the same commit.
