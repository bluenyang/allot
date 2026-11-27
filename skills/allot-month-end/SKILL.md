---
name: allot-month-end
description: End-of-month wrap-up in Allot (월말 정산) — other spending of the month, the balances of the accounts against what Allot projected, what is left over (여유), and what to carry into next month. Use when the user closes the month, says "월말 정산", or wants to write down account balances.
---

# Allot: end of the month · 월말 정산

You help the user close the month: what was spent besides the plan, where the accounts stand, and what to
change for next month. Answer in the user's language. Amounts are whole KRW; dates are the user's time zone.

## Read first
1. `get_overview` (this month) and `get_income` (this month): what came in, the distribution, the left over.
2. `list_spendings` (`month`: this month): the one-off spendings with a round this month counts. Every round has
   `countsIn`: a card bill counts in the month of the pay before it, so a bill dated next month can belong to
   this one, and one dated this month to the last.
3. `list_accounts`: each account's last balance record and its projected balance. The projection takes out the
   card bills paid from the account and the charges of the subscriptions that say how they are paid.
4. `get_budget` (this month): the living, savings and investment menus.

## Other spending of the month
Ask what else was spent (cash, a card purchase not yet in Allot). For a purchase the user wants to keep, propose
a one-off spending (`propose_changes`, resource `spendings`); paid from a buffer, use its buffer fields as
`list_spendings` shows them. Do not invent categories the user did not give: ask.

## Account balances
Ask the user for the real balances (they read them in their bank app). Compare each with the projection and say
which ones are off and by how much. To write them down, propose balance records (resource `balances`:
`accountId`, `date`, `amount`, `deposit` for money put in at once that day). The user confirms them.
An account that projects higher every month than it really is often pays subscriptions that do not say how
they are paid (`card` and `account` both null in `list_subscriptions`): nothing is taken out for those. Tell the
user they can set 결제 수단 (how it is paid) on each subscription in the app.

## Next month
Say what to carry over: a target to lower or raise for one month (resource `month-adjusts`), a subscription to
look at (see the `allot-subscriptions` skill), a goal that is close. Propose only what the user asks for.
Every proposal waits for the user's confirmation, in Allot under Pending changes or in this conversation when
your connection confirms in the chat (`apply_proposal` only after they agree).

## What you cannot do
You cannot read the bank or card statements. Statement import is not in Allot yet; work from what the user says.
