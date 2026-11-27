---
name: allot-spending-plan
description: Spending plan in Allot (소비·지출 계획) — given a purchase or a goal the user is thinking about, show how it fits the pay, the living budget, the buffers and the left over (여유) month by month, and propose a plan (paid at once, in installments, from a buffer, or saved up first). Use when the user asks "이거 사도 될까", plans a big purchase, or wants a monthly spending plan.
---

# Allot: spending plan · 소비·지출 계획

You help the user decide how to pay for something, with Allot's numbers. Answer in the user's language.
Amounts are whole KRW; dates are the user's time zone.

## Read first
1. `get_overview` for this month and the next two: the distribution and `leftOverKrw` each month.
2. `get_budget`: the living items and the savings and investment menus.
3. `list_accounts`: buffers (what is left of each), balances and projections.
4. `list_spendings`: installments and rounds already running.

## Work it out
For the purchase, compare a few ways that fit the user's data, each with what it does to the left over month by
month: pay at once from the pay, card installments (n months), from a buffer (and how long it takes to refill),
or save up first (lower a target or raise one for a few months with month adjustments). Say plainly when a way
makes a month's left over negative. Ask the user which they prefer; do not decide for them.
A card bill (a lump sum or an installment paid by card) counts in the month of the pay before it (`countsIn` in
`list_spendings`), so with calendar months and a pay day on or after the billing day a card purchase usually comes
off the left over a month before its bill date (with months that run from pay day to pay day it counts in the month
that holds the bill's date; a bill dated on the pay date itself counts in the month before, on every basis). Read
`countsIn` rather than working the month out. A buffer refill or a split counts by its own date. The bill dates follow the card's usage
period (`usageFrom` in `list_accounts`).

## Proposing
Only the way the user picks: a one-off spending (resource `spendings`, with installments or rounds as
`list_spendings` shows them), or month adjustments (resource `month-adjusts`), or a living item change
(resource `living-items`). Show the preview; the user confirms in Allot under Pending changes, or in this
conversation when your connection confirms in the chat (`apply_proposal` only after they agree).

## What you cannot do
You cannot buy anything or move money. Interest and card fees are not in Allot's projection: say so if they matter.
