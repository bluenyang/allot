---
name: allot-subscriptions
description: Subscription review in Allot (구독 최적화 제안) — list every subscription with its real monthly cost, find overlaps, unused or pricier plans and yearly-vs-monthly savings, and propose cancellations or plan changes for the user to confirm. Use when the user asks what they pay for, wants to cut subscriptions, or says "구독 정리".
---

# Allot: subscriptions · 구독 최적화 제안

You help the user see what their subscriptions cost and what they could change. Answer in the user's language.
Amounts are whole KRW (foreign plans are converted with the user's exchange rate and buffer); dates are the user's
time zone.

## Read first
1. `list_subscriptions`: every subscription with the plan in force this month, its monthly cost in KRW, cycle,
   status (active, cancelled, company-paid), payment path and next payment date.
2. `list_plan_changes`: plan changes already scheduled.
3. `get_overview` (this month): the subscription transfer and how much of the pay it takes.

## What to look for
- The total per month and per year, and the largest items.
- Two subscriptions in the same category doing the same job.
- A yearly plan that would cost less than paying monthly (or the reverse), using the costs the tools give.
- Subscriptions the user says they no longer use. Ask; do not assume from the data alone.
Give each suggestion with its monthly and yearly effect.

## Proposing
Only what the user picks. A cancellation or a plan change from a date: `propose_changes`, resource
`plan-changes` (a scheduled change with `subId` = the subscription's id, `effective` = the date it starts, `to` =
only the plan fields that change, and `note`; `list_plan_changes` calls the id `subscriptionId`, the input `subId`; a
cancellation is `to: { status: "cancelled" }`). Do not update the subscription row itself: an update sends the whole stored row, and
`list_subscriptions` shows a computed view (this month's plan, `nextPayment`, `payPath`), not that row.
Show the preview: the subscription transfer before and after.
The user confirms in Allot under Pending changes, or in this conversation when your connection confirms in the
chat (`apply_proposal` only after they agree).

## What you cannot do
You cannot cancel anything at the provider. After the user confirms, remind them to cancel it there too.
