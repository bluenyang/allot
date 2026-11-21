// Shared by the proposal specs: a write key, a tool call with it, and a proposal of two changes.
import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test'
import { MARK } from './helpers'

export const KEY_NAME = `${MARK}-ai`
export const SUB = `${MARK}-sub`
export const CHECK = `${MARK}-check`

export interface Proposal { id: string; keyName: string; status: string }

export async function makeKey(request: APIRequestContext, confirm: 'ui' | 'chat', name = KEY_NAME) {
  const r = await request.post('/api/keys', { data: { name, expiresInDays: 30, write: true, confirm } })
  expect(r.status()).toBe(201)
  return ((await r.json()) as { key: string }).key
}

/** A tool call with a key and no session. */
export async function tool(baseURL: string, key: string, name: string, args: Record<string, unknown>) {
  const ctx = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const r = await ctx.post('/api/mcp', {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    })
    const body = (await r.json()) as { result?: { isError?: boolean; structuredContent?: Record<string, unknown> } }
    expect(body.result?.isError).not.toBe(true)
    return body.result!.structuredContent!
  } finally {
    await ctx.dispose()
  }
}

export const propose = (baseURL: string, key: string) => tool(baseURL, key, 'propose_changes', {
  note: `${MARK} note`,
  changes: [
    { resource: 'subscriptions', action: 'create', data: { name: SUB, category: 'tool', plan: 'p', amount: 9900, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false } },
    { resource: 'checks', action: 'create', data: { text: CHECK, done: false } },
  ],
})


export const SPEND = `${MARK}-spend-ai`
export const SPEND_AMOUNT = 123_000

/** A salary-account lump sum in this month (Korea's today), as the screen would write it (spec 011 S-2). */
export function spendingBody(name = SPEND, amount = SPEND_AMOUNT) {
  const ym = new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' }).slice(0, 7)
  return {
    name, note: '', category: '생활', bought: `${ym}-05`, amount, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'lump', payBy: 'salary', count: 1, fee: 0, interval: null, cancelled: false,
    rounds: [{ no: 1, date: `${ym}-28`, amount, state: 'left', edited: false }],
  }
}

export const proposeSpending = (baseURL: string, key: string) => tool(baseURL, key, 'propose_changes', {
  note: `${MARK} spending note`,
  changes: [{ resource: 'spendings', action: 'create', data: spendingBody() }],
})
