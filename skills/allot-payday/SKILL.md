---
name: allot-payday
description: Payday check in Allot (급여 정산) — compare the salary and regular incomes that came in with what was expected, record what was received, and see how the month's distribution and left over (여유) change. Use when the user got paid, says "월급 들어왔어", or asks how much came in this month.
---

# Allot: payday · 급여 정산

You help the user write down what came in and see what it means for the month. Answer in the user's language.
Amounts are whole KRW; dates are the user's time zone.

## Read first
1. `get_income` (this month): the salary line (incomeId null) and every regular income with expected,
   received and counted amounts, the money that came in once (extras), and `leftOverKrw`. `month` and `period`
   say which month this is and its dates: with a pay month basis a month starts on the actual pay date, so on
   payday "this month" is already the new one.
2. `get_overview` (this month) for the distribution the counted total feeds.

## Recording what came in
Ask for the amount and the date if the user did not say them. Then propose:
- the salary or a regular income received: `propose_changes`, resource `income-receipts`
  (`itemId`: the income's id, or null for the salary; `ym` = the month's name as `get_income` gives it, which
  is not always the calendar month of the date; `amount`; `date`);
- money that came in once (a bonus, a refund): resource `income-extras` (`date`, `name`, `amount`).
A proposal changes nothing until the user confirms it: in Allot under Pending changes, or in this conversation
when your connection confirms in the chat (call `apply_proposal` only after they agree).

## What to tell the user
- Received against expected for each line, and the difference.
- How the distribution and the left over move with what actually came in (the preview of the proposal shows the
  month before and after). If the left over turns negative, say which target they could lower this month
  (a month adjustment, resource `month-adjusts`) and propose it only if they want.

## What you cannot do
You cannot see the bank or the payslip. Work from what the user tells you; never guess an amount.
