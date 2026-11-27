# Allot (context for the Gemini CLI extension)

This file is loaded by the Allot extension for Gemini CLI (`gemini-extension.json`). It is not about developing
this repository; contributors read AGENTS.md.

Allot is a self-hosted money planner. Its MCP server (added with
`gemini mcp add --transport http allot https://<your-host>/mcp`) gives read tools (get_overview, get_income,
get_budget, list_accounts, list_subscriptions, list_spendings, get_allocation, get_schedule, list_plan_changes,
list_changes, search, list_notifications) and, with a write permission, proposal tools (propose_changes,
propose_revert, get_proposal, apply_proposal).

- A proposal changes nothing until the user confirms it, in Allot under Pending changes or, when the connection
  confirms in the chat, after the user agrees in this conversation (then call apply_proposal).
- Amounts are whole KRW; "today" and "this month" are in the user's time zone.
- A month is the period of the user's month basis (the calendar month, a card's usage period, or one pay date to
  the day before the next): the answers carry `period`. Each monthly date has its own weekend and holiday rule.
- A card bill counts in the month of the pay before it (`countsIn`); a subscription charge uses the plan in force
  on its own date (`nextCharge`), and a subscription may say which card or account pays it.
- The left over after the distribution is 여유 in the Korean app and Left over in the English one.
- Answer in the user's language. The skills in `skills/` describe the common tasks.
