---
name: allot-receipt
description: Receipt to Allot (영수증 분석) — read a receipt or payment screenshot the user shares, and propose it as a one-off spending, or mark a subscription's receipt as checked, for the user to confirm. Use when the user shares a receipt, an order confirmation or a card notification and wants it in Allot.
---

# Allot: receipts · 영수증 분석

You turn a receipt the user shows you into a proposal in Allot. You read the image or text yourself; Allot only
receives the proposal. Answer in the user's language. Amounts are whole KRW for KRW receipts; dates are the
user's time zone.

## Read the receipt
Take the shop or service, the date, the total paid, the currency, and whether it was paid at once or in card
installments (and how many). Say what you read and ask about anything unclear (a blurred total, two dates).
Never guess an amount.

## Is it a subscription?
Check `list_subscriptions` (or `search` with the shop name). If the receipt is a charge of a subscription
already in Allot:
- the amount matches: propose marking it checked (resource `subscriptions`, update with `verified: true`;
  send the whole row as `list_subscriptions` shows it);
- the amount differs: say by how much and ask whether the plan changed before proposing anything.

## Otherwise: a one-off spending
Check `list_spendings` for the same purchase first (no duplicates). Then propose it: `propose_changes`, resource
`spendings`, with the name, category (ask, or use one the user already uses), the purchase date, amount and
currency, and how it is paid (at once, installments, or rounds), in the shape `list_spendings` shows.
For a card, use the card's id from `list_accounts`.

## Confirmation
A proposal changes nothing until the user confirms it: in Allot under Pending changes, or in this conversation
when your connection confirms in the chat (`apply_proposal` only after they agree). Show the preview before.

## What you cannot do
Allot does not store the receipt image. Do not send it anywhere else.
