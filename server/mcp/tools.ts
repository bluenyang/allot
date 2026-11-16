// The MCP server of one request: built per request and bound to the user the key belongs to
// (stateless; spec 008 S-5, S-6). Six tools, all read-only; each runs as that user under
// row-level security, and what it computes comes from server/mcp/views.ts. Descriptions and errors
// are in English (spec 008 S-10); the data is as the user entered it.
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { today, ymOf } from '../../src/lib/calc'
import { listSets } from '../changes'
import { asUser } from '../db/scope'
import { readState } from '../state'
import { allocation, overview, planChangeList, schedule, subscriptionList, type Data } from './views'

const SERVER_VERSION = '0.1'
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'use YYYY-MM')
/** A change set's time as the history returns it (PostgreSQL's text form, microseconds kept). */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

/** Structured data and the same JSON as text (clients that only show text still get the data). */
const json = (data: Record<string, unknown>): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
})

export function buildMcpServer(uid: string): McpServer {
  const server = new McpServer({ name: 'allot', version: SERVER_VERSION }, {
    instructions: 'Read-only access to one person\'s Allot data: monthly salary distribution, subscriptions, scheduled plan changes and the change history. Amounts are whole KRW; dates are ISO (YYYY-MM-DD, months YYYY-MM).',
  })
  const data = () => asUser(uid, (q) => readState(q, uid)) as Promise<Data>

  server.registerTool('get_overview', {
    title: 'Overview of a month',
    description: 'The month at a glance (default: this month): pay, transfer and card-billing dates (shifted off weekends and holidays when the user set that), the subscription transfer calculation, how the salary is distributed over the allocation targets, the remainder split, the charges and scheduled plan changes of that month, and the settings (net pay, pay days, exchange rate).',
    inputSchema: z.object({ month: month.optional().describe('YYYY-MM; default this month') }),
    annotations: READ_ONLY,
  }, async ({ month: ym }) => json(overview(await data(), ym ?? ymOf(today()))))

  server.registerTool('list_subscriptions', {
    title: 'Subscriptions',
    description: 'Every subscription with the plan in force this month (scheduled plan changes applied), its monthly cost in KRW (yearly plans divided by 12, USD converted with the exchange rate and VAT) and its next payment date.',
    inputSchema: z.object({ status: z.enum(['active', 'cancelled', 'company']).optional().describe('only subscriptions with this status this month') }),
    annotations: READ_ONLY,
  }, async ({ status }) => json(subscriptionList(await data(), today(), status)))

  server.registerTool('list_plan_changes', {
    title: 'Scheduled plan changes',
    description: 'Plan changes scheduled for subscriptions, soonest first (those without a date last), with the plan fields they change and how much they move the monthly subscription total.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, async () => json(planChangeList(await data())))

  server.registerTool('get_allocation', {
    title: 'Salary allocation definition',
    description: 'How the salary is split: living costs, allocation targets (living, subscriptions, fixed, remainder), the phases with their fixed amounts per target, how the remainder is split, the bank accounts and the debts.',
    inputSchema: z.object({}),
    annotations: READ_ONLY,
  }, async () => json(allocation(await data())))

  server.registerTool('get_schedule', {
    title: 'Schedule over several months',
    description: 'For each month from `from`: the pay, transfer and billing dates, the charges, the plan changes and the plan events; plus the check items and the holidays in the period (only the holiday sets the user has on).',
    inputSchema: z.object({
      from: month.optional().describe('first month, YYYY-MM; default this month'),
      months: z.number().int().min(1).max(12).optional().describe('how many months, 1 to 12; default 3'),
    }),
    annotations: READ_ONLY,
  }, async ({ from, months }) => json(schedule(await data(), from ?? ymOf(today()), months ?? 3)))

  server.registerTool('list_changes', {
    title: 'Change history',
    description: 'The history of changes to the data, newest first: who changed what and when (one entry per saved change, with the rows before and after). For the next page pass `before` and `beforeId` from `next` of the previous answer.',
    inputSchema: z.object({
      before: z.string().regex(TIMESTAMP, 'use the `before` value of the previous page').optional().describe('time of the last entry of the previous page'),
      beforeId: z.string().min(1).max(100).optional().describe('id of the last entry of the previous page'),
      limit: z.number().int().min(1).max(50).optional().describe('1 to 50; default 20'),
    }).refine((x) => (x.before === undefined) === (x.beforeId === undefined), { message: '`before` and `beforeId` go together' }),
    annotations: READ_ONLY,
  }, async ({ before, beforeId, limit }) => {
    const n = limit ?? 20
    const sets = await asUser(uid, (q) => listSets(q, uid, before && beforeId ? { at: before, id: beforeId } : undefined, n))
    const lastSet = sets[sets.length - 1]
    return json({ sets, next: sets.length === n && lastSet ? { before: lastSet.at, beforeId: lastSet.id } : null })
  })

  return server
}
