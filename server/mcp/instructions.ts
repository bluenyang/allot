// The MCP server's instructions (spec 015 S-15). Pure: no database, so the unit tests read it.
import type { KeyInfo } from '../proposals'

/**
 * The server's instructions (spec 015 S-15): what Allot is and how to use it, the essentials first (ChatGPT reads the
 * first 512 characters): what this connection may do, that a proposal changes nothing until the user confirms it, the
 * units and time zone, what a month is (spec 018 S-3), and which tools to start with. English, for the model; the same for a key and an OAuth app
 * with the same permission.
 */
export function instructionsFor(key: KeyInfo | null): string {
  const access = !key
    ? 'This connection is read-only: it cannot propose changes.'
    : key.confirm === 'ui'
      ? 'You can read it and propose changes; the user confirms a proposal in the Allot app, under Pending changes.'
      : 'You can read it and propose changes; show the user the proposal, and call apply_proposal only after they agree in this conversation.'
  return [
    `Allot is one person's self-hosted money planner. ${access}`,
    'A proposal never changes anything until the user confirms it. Amounts are whole KRW; dates are ISO, and "today" and "this month" are in the user\'s time zone.',
    // spec 018 S-3: inside the first 512 characters
    'A month is the period of the user\'s chosen basis (calendar month, a card\'s usage period or pay date to pay date): see period in the answers.',
    'Start with get_overview (a month at a glance), get_income (what came in), get_budget and list_accounts (budgets, accounts, balances); search finds a row by name; list_notifications lists what needs the user now.',
    'The data: monthly salary distribution, the incomes and what was received, the living, savings and investment budgets, bank accounts with their balances and cards, subscriptions, one-off spendings, scheduled plan changes and the change history. Dates are YYYY-MM-DD, months YYYY-MM; every default month and D-n is in the user\'s time zone (a display setting, default Asia/Seoul).',
    'The remainder (what comes in leaves after every allocation target and the month\'s spendings; the fields keep the name remainder) is called 여유 in the Korean app and Left over in the English one: use that word with the user. Answer in the user\'s language.',
    'The month basis is settings.monthBasis (calendar, card with monthBasisCardId, or pay) and monthNaming (start, end or auto: which calendar month a period is named after). Every default month, every monthly sum and list follows it; values saved by month name (phases, month adjustments, receipts, from and stop months) keep their names. The yearly limit of an account always counts a calendar year.',
    'Each monthly date has its own weekend and holiday rule (before, none or after): the settings\' payShift, transferShift and billingShift for the pay day, the transfer day and the card billing day, and shift on each of the user\'s own monthly dates. The one rule of earlier versions, settings.dayShift, is in no answer any more.',
    'What counts when: a card bill (a card round of a one-off spending) counts in the month of the pay before it; every other round and money that came in once count in the month whose period holds their date (countsIn on a round; list_spendings has the rule). A subscription charge uses the plan in force on its own date, while the monthly cost and the transfer use the plan of the month (list_subscriptions gives nextCharge when the two differ). A card may have a usage period (usageFrom) that decides which bill a purchase falls on, and a subscription may say how it is paid (cardId or accountId): list_accounts\' projected balances then take its charges out.',
  ].join(' ')
}
