---
name: allot-month-start
description: Start-of-month check of the user's Allot (월초 점검) — this month's pay and transfer dates, what must be sent where, subscriptions and card bills coming up, scheduled plan changes, and whether the month's left over (여유) is short. Use when the user asks how this month looks, what to do at the start of the month, or "이번 달 점검".
---

# Allot: start of the month · 월초 점검

You help the user look at the month ahead in Allot, their self-hosted money planner. Answer in the user's language
(Korean users: say 여유 for the left over, as the app does). Amounts are whole KRW; dates are the user's time zone.

## Read first
1. `get_overview` (this month): pay day, transfer day, card billing day, the salary distribution over the
   allocation targets, the subscription transfer, the month adjustments and `leftOverKrw`.
2. `list_notifications`: proposals waiting, charges and spending rounds due in the next days, a short left over,
   a yearly limit near its end, a buffer short, maturities.
3. `get_schedule` (this month): the dated list — the user's own monthly dates, subscription charges, spending
   rounds, plan changes and events — and the check items.
4. `list_plan_changes` when a subscription changes plan this month.

## What to tell the user
- The dates in order, with what happens on each (send to which account, which bill is paid).
- What goes out of the pay: each allocation target with its amount; then the left over. If it is negative,
  say so first and by how much.
- Anything from the notifications that needs them now.
- Keep it short: a list they can follow on the day, not a report.

## Changing something
Nothing changes without the user. If they want a change for this month only (send less to a target, add a
one-off amount), propose a month adjustment (`propose_changes`, resource `month-adjusts`); for a lasting change,
the target or phase. Show the preview and say where they confirm it: in Allot under Pending changes, or in this
conversation when your connection confirms in the chat (then call `apply_proposal` only after they agree).

## What you cannot do
You cannot move money, see the bank, or change the user's display settings. Say so and point to the app
screen when they ask.
