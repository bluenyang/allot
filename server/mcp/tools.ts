// The MCP server of one request: built per request and bound to the user the key belongs to
// (stateless; spec 008 S-5, S-6). Twelve read-only tools for every key (get_budget and list_accounts: spec 013
// S-10; search and list_notifications: S-19, S-20; get_income: spec 014 S-10) and, for a key with the write scope, four more that propose changes and apply them after confirmation
// (spec 009 S-6); each runs
// as that user under row-level security, and what the read tools compute comes from server/mcp/views.ts.
// Descriptions and errors are in English (spec 008 S-10); the data is as the user entered it.
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { todayIn, ymOf } from '../../src/lib/calc'
import { ROUND_MAX } from '../../src/lib/spending-rules'
import { listSets } from '../changes'
import { asUser } from '../db/scope'
import { issueText } from '../messages'
import { AI_LISTS, AI_SINGLES, RESOURCES, singleSchema } from '../ops'
import { instructionsFor } from './instructions'
import { applyProposal, getProposal, MAX_OPS, pendingCount, propose, ProposalError, proposalText, type KeyInfo, type ProposalView } from '../proposals'
import { readState } from '../state'
import { SEARCH_KINDS } from '../../src/lib/search'
import { guarded, isTimestamp } from './safe'
import { accountList, allocation, budget, incomeView, notificationList, overview, planChangeList, schedule, searchView, spendingList, subscriptionList, type Data } from './views'

const SERVER_VERSION = '0.1'
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM')
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
/** A time GET /api/changes takes for its period (the same check: Date.parse reads it). */
const isTime = (s: string) => !Number.isNaN(Date.parse(s))

/** Structured data and the same JSON as text (clients that only show text still get the data). */
const json = (data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
})

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const
const APPLY = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const

/** What can be proposed: one shape per resource, with the same rules (zod) as the screen's request body. */
const change = z.discriminatedUnion('resource', ([
  ...AI_LISTS.map((resource) => z.object({
    resource: z.literal(resource),
    action: z.enum(['create', 'update', 'delete']),
    id: z.string().min(1).max(100).optional().describe('the row to update or delete; leave out for create (the server assigns it)'),
    data: RESOURCES[resource].schema.optional().describe('the whole new row for create or update (an update replaces the row); leave out for delete'),
  }).strict()),
  ...AI_SINGLES.map((resource) => z.object({
    resource: z.literal(resource),
    action: z.literal('update'),
    data: singleSchema(resource).describe(resource === 'living' ? 'the three old living amounts (food, transit, allowance): they set the amounts of the three living items moved from them; other living items are resource living-items' : 'the whole new record; it replaces the saved one'),
  }).strict()),
]) as unknown as [z.ZodObject<{ resource: z.ZodLiteral<string> }>, ...z.ZodObject<{ resource: z.ZodLiteral<string> }>[]])

/** The same schema, with our rule messages in English (the SDK sends them to the client as they are). */
function englishIssues<S extends z.ZodType>(schema: S) {
  const std = schema['~standard']
  type Res = Awaited<ReturnType<typeof std.validate>>
  const fix = (r: Res): Res => ('issues' in r && r.issues ? { issues: r.issues.map((i) => ({ ...i, message: issueText('en', i.message) })) } : r)
  return {
    '~standard': {
      ...std,
      validate: (v: unknown) => { const r = std.validate(v); return r instanceof Promise ? r.then(fix) : fix(r) },
    },
  } as unknown as S
}

/** A failure the AI can act on: a code and a sentence (never SQL or internals — guarded() hides those). */
const fail = (code: string, message: string): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: code, message }) }],
})

function proposalOut(p: ProposalView): Record<string, unknown> {
  const next = p.status !== 'pending' ? undefined
    : p.confirm === 'ui' ? 'The user confirms or rejects this in Allot, under Pending changes. You cannot apply it. Check its state with get_proposal.'
      : 'Show the user this preview (what changes, and the transfer and distribution of this month and the next). Only after the user agrees in this conversation, call apply_proposal.'
  return {
    proposalId: p.id, status: p.status, confirm: p.confirm, expiresAt: p.expiresAt,
    ...(p.revertOf ? { revertOf: p.revertOf } : {}), ...(p.note ? { note: p.note } : {}),
    ...(p.changeSetId ? { changeSetId: p.changeSetId } : {}), preview: p.preview, ...(next ? { next } : {}),
  }
}

/** Run a proposal tool: what the proposals refuse comes back as a readable failure, anything else is the generic one. */
function proposalTool<A>(tool: string, fn: (args: A) => Promise<CallToolResult>) {
  return guarded<A>(tool, async (args) => {
    try {
      return await fn(args)
    } catch (e) {
      if (e instanceof ProposalError) return fail(e.code, proposalText(e, 'en'))
      throw e
    }
  })
}

/** The proposal tools of a write key. */
function registerWrite(server: McpServer, uid: string, key: KeyInfo) {
  server.registerTool('propose_changes', {
    title: 'Propose changes',
    description: `Propose changes to the user's data. Nothing changes yet: the proposal is stored with a preview (the rows before and after, and the subscription transfer and salary distribution of this month and the next, before and after) and waits for the user's confirmation. Up to ${MAX_OPS} changes per proposal, all applied together or not at all. You can change subscriptions, plan changes, phases (with their fixed amounts per allocation target), allocation targets, the remainder split, plan events, check items, the settings (net pay, pay days, exchange rate, savingSplit and investSplit: amount or ratio), the living items, the bank accounts, their balance records, the cards, one-off spendings, one month's amounts of targets (month adjustments), the user's own monthly dates, the foreign currencies, the regular incomes, the money received for them and money that came in once; deleting is allowed. "This month" and "today" are in the user's time zone (a display setting, default Asia/Seoul). Read the current data with the other tools first (get_budget, list_accounts, get_allocation, list_spendings show the shapes); update and delete need the row's id, and an update sends the whole row. `
      + `Living items (resource 'living-items'): name, kind and payMethod (free text up to 40 characters, may be empty), amount (whole KRW a month), from (YYYY-MM, or null = from the start), code (only the three items moved from the old living costs: food, transit or allowance; else null), note, amounts (phaseId to the amount in that phase; leave empty for the monthly amount). Their sum is the Living total target. The old resource 'living' (food, transit, allowance) still sets the three coded items. `
      + `Bank accounts (resource 'accounts'): name, role, inflow and outflow (free text, as before), and, optional (left out = the stored value): bank, kind, rate and term (free text up to 40), last4 (exactly 4 digits, or empty), buffer (KRW kept in the account), goal and annualLimit (KRW, or null), group (saving or invest = an item of the Savings or Investment menu; null = none), from and stopFrom (YYYY-MM or null: an item sends from its from month until the month before stopFrom), goalAck, afterMaturity (free text up to 200 characters: where the money goes when the term matures, e.g. to the living account; get_budget shows it in the maturity schedule), note; only an account with a group may have amount (whole KRW a month, for the amount split), ratio (0 to 1 with at most 4 decimals, for the ratio split: the share of the phase amount of the menu's target) and amounts (phaseId to amount). Deleting an account deletes its balance records and phase amounts and unlinks its cards and targets; it is refused while a buffer use is paid from it. `
      + `Balance records (resource 'balances'): accountId, date (YYYY-MM-DD), amount (the balance on that date, whole KRW), deposit (money put in at once that day, such as a maturity payout, whole KRW, or null; the yearly contribution counts it, a balance alone is not counted as paid in), note; money put in at once is written as a new balance with its deposit. `
      + `Cards (resource 'cards'): name, last4 (4 digits or empty), accountId (the account its bill is paid from, or null), billingDay (1 to 31, or null = the settings' billing day), note; deleting a card is refused while a buffer use uses it. `
      + `Month adjustments (resource 'month-adjusts'): one month's amount of a fixed, saving or invest target, in place of its phase amount for that month only: ym (the month, YYYY-MM), targetId, amount (whole KRW, 0 or more), reason (optional). For a fixed target the target gets that amount that month; for an amount-split Savings or Investment target it is spread over that month's items in proportion to their amounts (each gets its share rounded down, the last item the rest; when no item sends that month the target gets it itself); for a ratio split it is that month's total the items share by their ratios. One per month and target: update the existing one (get_overview and get_budget list them as monthAdjusts) or delete it to go back to the phase amount. To change the amount for the rest of a phase instead, update the phase. `
      + `Own monthly dates (resource 'schedules'): a day that comes back every month besides the pay, transfer and billing days: name, day (1 to 31; a month without that day uses its last day), accountId (an account, or null), direction ('in' = money comes in, 'out' = money goes out), note (optional). No amount: they show on the calendar and in get_schedule, moved off weekends and holidays like the pay days, and are not part of the distribution or transfer. `
      + `Foreign currencies (resource 'currencies'): the currencies other than KRW and USD that subscriptions, plan changes and spendings may use: code (three capital letters, not KRW or USD), rate (KRW per unit, more than 0), buffer (percent added to the rate, 0 to 100), auto (optional boolean: refresh the rate once a day from the public ECB rates; left out keeps the saved value). Deleting a currency, or changing its code, is refused while a subscription, plan change or spending uses the code. The USD rate is not a row here: it is the settings' fxRate, fxBuffer and fxAuto (resource 'settings'). `
      + `Incomes (resource 'incomes'): a regular income besides the salary (the salary is the settings' netPay on payDay and has no row): name, cycle ('monthly', or 'yearly' = once a year in month), month (1 to 12 for a yearly income; null or left out for a monthly one), day (1 to 31; a month without that day uses its last day), amount (the expected amount, whole KRW), accountId (the account it is paid into, or null; optional), note. Deleting an income deletes what was received for it. `
      + `Money received (resource 'income-receipts'): what really came in for an income in a month, in place of its expected amount: itemId (an income's id, or null = the salary), ym (the month, YYYY-MM), amount (whole KRW), date (YYYY-MM-DD or null; optional), note. Several receipts for one income in one month add up; the month counts their sum instead of the expected amount (get_income shows each income's receipts, expected and received). `
      + `Money that came in once (resource 'income-extras'): date (YYYY-MM-DD; it counts in that month), name, amount (whole KRW), note. Received money and money that came in once add to that month's left over (get_income and get_overview show leftOverKrw); the preview names each income row and shows the left over of its month before and after. `
      + `Allocation targets (resource 'targets'): name, kind (living, subscriptions, fixed, remainder, saving or invest; at most one of each kind except fixed), note, accountId (the account it sends to, or null). `
      + `A spending (resource 'spendings') is sent whole with its rounds: name, category, bought (YYYY-MM-DD), amount, currency (KRW, USD or a code in the user's currency list), fxRate and fxBuffer (a foreign currency only, else null; fxRate at most 6 decimals, fxBuffer at most 2), how (lump, installment, split or buffer), payBy (card, salary or subs), count (1 for lump, 1 to 60 for buffer, else 2 to 60), fee (KRW; only a card installment has one, else 0), interval (monthly, biweekly or custom for split only, else null), cancelled, cardId (a card, only when payBy is card; or null), refillFrom (buffer only, else null), and rounds (no from 1, date, amount in whole KRW, state left, paid or merged, edited). A buffer use (how 'buffer') is a card purchase paid at once from the buffer of the card's paying account and put back over count months: payBy card, a cardId whose card has a paying account, fee 0, interval null, refillFrom (YYYY-MM-DD: the first refill, normally the first pay day on or after the card's billing date), and its rounds are the refills: round 1 on refillFrom, then the pay day of each next month, each floor(principal / count / 10) * 10 KRW with the rest on the last. The server does not work the rounds out: plan them so they add up to the amount plus the fee (round amounts are whole KRW), and keep what is paid or still to pay to at most ${ROUND_MAX.toLocaleString('en-US')} KRW in total. An update replaces the rounds too, so send all of them. `
      + `Examples: to record the balance of a CMA account after a maturity payout went into it, create a 'balances' row with that account's id, the date and the new balance. To plan a mini PC bought by card from a buffer, create a 'spendings' row with how 'buffer', payBy 'card', the cardId of a card that has a paying account (list_accounts lists the cards), count 6, refillFrom and the six refill rounds. `
      + `If a rule is broken (for example phases overlapping) no proposal is made and the reason is returned. The server assigns the ids of created rows, so a row and another row that refers to it cannot be in the same proposal (a new allocation target and a phase amount for it, a new account and its balance or card, a new card and a spending with it): propose the first, then the others once it exists (read its id with get_allocation or list_accounts).`,
    inputSchema: englishIssues(z.object({
      changes: z.array(change).min(1).max(MAX_OPS).describe('the changes, in the order they are applied'),
      note: z.string().max(500).optional().describe('why, in a sentence; the user sees it next to the proposal'),
    }).strict()),
    annotations: WRITE,
  }, proposalTool('propose_changes', async ({ changes, note }) => json(proposalOut(await propose(uid, key, { changes, note })))))

  server.registerTool('propose_revert', {
    title: 'Propose reverting a change',
    description: 'Propose undoing one saved change (a change set from list_changes), like git revert: the opposite change is applied as a new change. Nothing changes yet; it waits for confirmation like propose_changes. It is refused if the rows changed since, or a rule would break.',
    inputSchema: z.object({
      changeSetId: z.string().min(1).max(100).describe('the id of a change set from list_changes'),
      note: z.string().max(500).optional().describe('why, in a sentence'),
    }).strict(),
    annotations: WRITE,
  }, proposalTool('propose_revert', async ({ changeSetId, note }) => json(proposalOut(await propose(uid, key, { revertOf: changeSetId, note })))))

  server.registerTool('get_proposal', {
    title: 'State of a proposal',
    description: 'The state of a proposal this key made: pending, applied, rejected, expired (not confirmed in time) or stale (the data changed after it was proposed), with its preview. Use it to see whether the user confirmed a proposal in Allot.',
    inputSchema: z.object({ proposalId: z.string().min(1).max(100) }).strict(),
    annotations: READ_ONLY,
  }, proposalTool('get_proposal', async ({ proposalId }) => json(proposalOut(await getProposal(uid, proposalId, { id: key.id, source: key.source ?? 'api_key' })))))

  server.registerTool('apply_proposal', {
    title: 'Apply a confirmed proposal',
    description: 'Apply a proposal after the user agreed to it in this conversation. Works only for a key whose proposals are confirmed in the conversation, and only for its own pending proposals; a proposal that is confirmed in Allot cannot be applied here. Everything is checked again: it is refused if it has expired, if the data changed since it was proposed (propose again), or if a rule would break. Applying makes one change set the user can revert in the change history.',
    inputSchema: z.object({ proposalId: z.string().min(1).max(100) }).strict(),
    annotations: APPLY,
  }, proposalTool('apply_proposal', async ({ proposalId }) => {
    const done = await applyProposal(uid, proposalId, { kind: 'key', keyId: key.id, source: key.source ?? 'api_key', confirm: key.confirm })
    return json({ proposalId, status: 'applied', changeSetId: done.changeSetId })
  }))
}

export function buildMcpServer(uid: string, key: KeyInfo | null = null): McpServer {
  const server = new McpServer({ name: 'allot', version: SERVER_VERSION }, { instructions: instructionsFor(key) })
  const data = () => asUser(uid, (q) => readState(q, uid)) as Promise<Data>
  /** "Today" in the user's time zone (spec 013 S-22). */
  const dayOf = (d: Data) => todayIn(d.preferences?.timezone)

  server.registerTool('get_overview', {
    title: 'Overview of a month',
    description: 'The month at a glance (default: this month): pay, transfer and card-billing dates (shifted off weekends and holidays when the user set that), the subscription transfer calculation, how the salary is distributed over the allocation targets (without a remainder target, what is left stays in the pay account as unallocatedKrw; a month adjustment replaces a target\'s phase amount that month), the remainder split, the month adjustments (monthAdjusts: target, amount and the planned amount it replaces), the subscription charges, the one-off spending rounds (spendingRounds, kept apart from the charges) and scheduled plan changes of that month, the settings (net pay, pay days, exchange rate), what comes in that month (income: expectedKrw, totalKrw = what counts, diffKrw; the lines are in get_income) and the month\'s left over (leftOverKrw, the remainder after the distribution; negative = short).',
    inputSchema: z.object({ month: month.optional().describe('YYYY-MM; default this month') }),
    annotations: READ_ONLY,
  }, guarded('get_overview', async ({ month: ym }) => {
    const d = await data()
    const today = () => dayOf(d)
    return json(overview(d, ym ?? ymOf(today())))
  }))

  server.registerTool('get_income', {
    title: 'Income of a month',
    description: 'What comes in in a month (default: this month), worked out as the Income page does: incomes = the salary (salary true, incomeId null, name "salary": the settings\' net pay on the pay day) and every regular income of that month (monthly ones always, yearly ones in their month, or in another month when something was received for them there, with nothing expected), each with cycle, day, accountId, expectedKrw, receivedKrw (the receipts of that month added up; null = nothing written down yet), countedKrw (received, else expected), diffKrw (counted minus expected) and its receipts (id, amountKrw, date); extras = money that came in once that month (id, date, name, amountKrw) and extrasKrw; expectedKrw, totalKrw (what the month counts: counted amounts plus extras; the distribution splits this as the pay) and diffKrw; allReceived; leftOverKrw = the month\'s left over after the distribution (as get_overview\'s distribution.remainderKrw; negative = short); later = the yearly incomes of other months with the month each comes next. Change them with propose_changes (resources incomes, income-receipts, income-extras).',
    inputSchema: z.object({ month: month.optional().describe('YYYY-MM; default this month') }),
    annotations: READ_ONLY,
  }, guarded('get_income', async ({ month: ym }) => {
    const d = await data()
    const today = () => dayOf(d)
    return json(incomeView(d, ym ?? ymOf(today())))
  }))

  server.registerTool('list_subscriptions', {
    title: 'Subscriptions',
    description: 'Every subscription with the plan in force this month (scheduled plan changes applied), its monthly cost in KRW (yearly plans divided by 12, a foreign currency (USD or one of the user\'s currency list) converted with its exchange rate, buffer and VAT) and its next payment date.',
    inputSchema: z.object({ status: z.enum(['active', 'cancelled', 'company']).optional().describe('only subscriptions with this status this month') }),
    annotations: READ_ONLY,
  }, guarded('list_subscriptions', async ({ status }) => {
    const d = await data()
    const today = () => dayOf(d)
    return json(subscriptionList(d, today(), status))
  }))

  server.registerTool('list_spendings', {
    title: 'One-off spendings',
    description: 'Every one-off spending (a purchase paid at once, in card installments or in rounds the user splits) with its rounds. Per spending: the amount and currency, the KRW principal (a foreign currency converted with the rate and buffer saved with it), the fee, how and payBy (card, salary or subs account), `state` (planned, billing = bought but the card is not billed yet, paid, cancelled), `progress` (rounds paid, left and merged by an early payoff, and the next round to pay) and every round with its date, KRW amount and state. Rounds paid from salary or card come off that month\'s remainder; those paid from the subscription account add to its transfer (get_overview shows both). Optional filters: `status` (active = not cancelled and not fully paid, done = fully paid, cancelled; default all) and `month` (YYYY-MM: only spendings with a round to pay that month, plus that month\'s totals).',
    inputSchema: z.object({
      status: z.enum(['active', 'done', 'cancelled', 'all']).optional().describe('default all'),
      month: month.optional().describe('YYYY-MM: only spendings with a round in this month'),
    }),
    annotations: READ_ONLY,
  }, guarded('list_spendings', async ({ status, month: ym }) => {
    const d = await data()
    const today = () => dayOf(d)
    return json(spendingList(d, today(), { status, month: ym }))
  }))

  server.registerTool('list_plan_changes', {
    title: 'Scheduled plan changes',
    description: 'Plan changes scheduled for subscriptions, soonest first (those without a date last), with the plan fields they change and how much they move the monthly subscription total.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, guarded('list_plan_changes', async () => json(planChangeList(await data()))))

  server.registerTool('get_allocation', {
    title: 'Salary allocation definition',
    description: 'How the salary is split: living costs (the three old amounts; every living item is in get_budget), allocation targets (kind living, subscriptions, fixed, remainder, saving or invest, and accountId: the account each sends to, or null), the phases with their fixed amounts per target (for a saving or invest target split by ratio: the total of that menu), how the remainder is split, the bank accounts (with their group: saving, invest or null; the details are in list_accounts) and the debts.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, guarded('get_allocation', async () => json(allocation(await data()))))

  server.registerTool('get_budget', {
    title: 'Living, savings and investment budget of a month',
    description: 'The budget menus of a month (default: this month), worked out as the Living, Savings and Investment pages do. living: every living item (name, kind, payMethod, its monthly amount, from, code, phase amounts) with what it costs that month (0 before its from month; a phase amount replaces the monthly amount in that phase) and their sum, which the Living total target gets. saving and invest: how the menu splits (mode amount: each item sends its monthly amount, or its share of that month\'s adjustment; mode ratio: the phase amount of the menu target is split by the item ratios, rounded to 1,000 KRW), the target (id, name, accountId), the total, every item (an account in that group: accountId, name, kind, bank, last4, amount, phase amounts, ratio, what it sends that month, from, stopFrom, goal, annualLimit; nothing before from or from stopFrom on), the sum of the items, what the target gets (targetKrw) and the ratio sum (1 = 100%; what a ratio sum under 100% leaves stays in the remainder), and the month adjustment of the target (adjustment: an amount split spreads it over the items in proportion to their amounts; a ratio split\'s items share it as that month\'s total). targets: what every allocation target gets that month; the remainder; monthAdjusts: that month\'s adjustments with the planned amount each replaces; and maturity: the savings maturity schedule (Savings items that have a from month and whose term reads N months, also in Korean, or YYYY-MM followed by the Korean word for until: maturityMonth, months paid in, expectedKrw, before tax and without interest = with basis projection (the account has a balance record) the projected balance at the end of the month before the maturity month, else with basis amount what the pay split sends the item from its from month up to the month before maturity (its monthly or phase amounts, month adjustments, stop month and the ratio split followed; 0 when the pay split has no Savings target), afterMaturity, state past, due or upcoming relative to the month).',
    inputSchema: z.object({ month: month.optional().describe('YYYY-MM; default this month') }),
    annotations: READ_ONLY,
  }, guarded('get_budget', async ({ month: ym }) => {
    const d = await data()
    const today = () => dayOf(d)
    return json(budget(d, ym ?? ymOf(today())))
  }))

  server.registerTool('list_accounts', {
    title: 'Bank accounts, balances and cards',
    description: 'Every bank account with its fields (name, role, inflow, outflow, bank, last4, kind, rate, term, maturityMonth (the month the term matures: N months after from for a term of N months, also in Korean, or the YYYY-MM of a term that reads YYYY-MM followed by the Korean word for until; else null), afterMaturity, group, amount, ratio, from, stopFrom, buffer, goal, annualLimit, note), its balance records (date, amount and deposit = money put in at once that day, oldest first) and the last one, the projected balance month by month from this month for `months` months (no interest: from the last record, the transfers into it on the transfer day, buffer refills in on pay days, card bills paid from it out on billing days; null without a balance record), the month the projection first reaches its goal (null when it does not within 50 years, or without a goal or a record), this calendar year\'s contribution against its yearly limit (left, and state near = 90% or more, over = above it), the buffer gauge (its buffer, what buffer uses through its cards took and have not refilled yet, what is left), the allocation targets that send to it and the cards paid from it. Plus every card with its paying account and its billing day (null = the settings\' billing day; effectiveBillingDay is the day used).',
    inputSchema: z.object({ months: z.number().int().optional().describe('how many months of projection; default 12 (fewer than 1 counts as 1, more than 120 as 120)') }),
    annotations: READ_ONLY,
  }, guarded('list_accounts', async ({ months }) => {
    const d = await data()
    const today = () => dayOf(d)
    return json(accountList(d, today(), Math.min(120, Math.max(1, months ?? 12))))
  }))

  server.registerTool('get_schedule', {
    title: 'Schedule over several months',
    description: 'For each month from `from` (default: this month in the user\'s time zone): the pay, transfer and billing dates, the user\'s own monthly dates (ownDates: id, name, day, date after the same weekend and holiday shift, nominal, shifted, accountId or null, direction in or out, note; they have no amount and are not part of the distribution), the subscription charges, the one-off spending rounds (spendingRounds), the plan changes and the plan events (an event with a range, also one into a later year such as 2026-11~2027-02, is listed in every month of it, with its from and to months); plus the check items and the holidays in the period (only the holiday sets the user has on).',
    inputSchema: z.object({
      from: month.optional().describe('first month, YYYY-MM; default this month'),
      months: z.number().int().min(1).max(12).optional().describe('how many months, 1 to 12; default 3'),
    }),
    annotations: READ_ONLY,
  }, guarded('get_schedule', async ({ from, months }) => {
    const d = await data()
    const today = () => dayOf(d)
    return json(schedule(d, from ?? ymOf(today()), months ?? 3))
  }))

  server.registerTool('list_changes', {
    title: 'Change history',
    description: 'The history of changes to the data, newest first: who changed what and when (one entry per saved change, with the rows before and after). Optionally only a period: `since` (that time or later) and `until` (before that time), ISO times or dates (a date is midnight UTC); the same as the change history\'s period filter. For the next page pass `before` and `beforeId` from `next` of the previous answer (and the same period).',
    inputSchema: z.object({
      before: z.string().max(64).refine(isTimestamp, 'use the `before` value of the previous page').optional().describe('time of the last entry of the previous page'),
      beforeId: z.string().min(1).max(100).optional().describe('id of the last entry of the previous page'),
      limit: z.number().int().min(1).max(50).optional().describe('1 to 50; default 20'),
      since: z.string().refine(isTime, 'use an ISO time or date').optional().describe('only changes at this time or later (ISO time or YYYY-MM-DD)'),
      until: z.string().refine(isTime, 'use an ISO time or date').optional().describe('only changes before this time (ISO time or YYYY-MM-DD)'),
    }).refine((x) => (x.before === undefined) === (x.beforeId === undefined), { message: '`before` and `beforeId` go together' }),
    annotations: READ_ONLY,
  }, guarded('list_changes', async ({ before, beforeId, limit, since, until }) => {
    const n = limit ?? 20
    const sets = await asUser(uid, (q) => listSets(q, uid, before && beforeId ? { at: before, id: beforeId } : undefined, n, { since, until }))
    const lastSet = sets[sets.length - 1]
    return json({ sets, next: sets.length === n && lastSet ? { before: lastSet.at, beforeId: lastSet.id } : null })
  }))

  server.registerTool('search', {
    title: 'Search by name and memo',
    description: 'Find the user\'s subscriptions, one-off spendings, living items, bank accounts, cards, allocation targets, plan events and check items whose name (an event\'s title, a check item\'s text) or memo holds `query` (any part, case-insensitive, Korean as typed), as the header search of the app does. Results are grouped by kind in that order; in a kind name matches come before memo matches. Each result has its kind, id, name, note, matched (name or note) and page (the app page that shows it). Read the row itself with the other tools (list_subscriptions, list_spendings, get_budget, list_accounts, get_allocation, get_schedule).',
    inputSchema: z.object({
      query: z.string().describe('the text to find; an empty one finds nothing'),
      kinds: z.array(z.string()).optional().describe(`only these kinds (${SEARCH_KINDS.join(', ')}); default all; an unknown kind matches nothing`),
    }),
    annotations: READ_ONLY,
  }, guarded('search', async ({ query, kinds }) => json(searchView(await data(), query, kinds?.filter((k): k is (typeof SEARCH_KINDS)[number] => (SEARCH_KINDS as readonly string[]).includes(k))))))

  server.registerTool('list_notifications', {
    title: 'Notifications',
    description: 'What the bell of the app lists now, worked out from the data (nothing is pushed or mailed): proposals waiting for the user\'s confirmation, goal cards and maturity cards (group pending; maturities: Savings items whose maturity month is this month or past and that still send, with accounts listing each one; the user\'s "keep sending" choice on a maturity card is kept in their browser only, so this list cannot see it and shows such a maturity until it is stopped), subscription charges and one-off spending rounds from today to three days on (group pay, with date and dday), and this month\'s remainder short, a yearly limit used 90% or more, or a buffer short (group budget). Each has an id, its kind, its numbers, the app page and a sentence (message). Whether the user has read one is kept in their browser only and is not here.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, guarded('list_notifications', async () => {
    const [st, proposals] = await asUser(uid, async (q) => [await readState(q, uid), await pendingCount(q, uid)] as const)
    return json(notificationList(st as Data, dayOf(st as Data), proposals))
  }))

  if (key) registerWrite(server, uid, key)
  return server
}
