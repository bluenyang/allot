// spec 009 V-10: 대기 중인 변경 — a proposal an AI key made (through MCP) is listed with its preview and the
// sidebar badge, confirming applies it and shows in 변경 내역 as "AI · key name" (and reverts), rejecting
// changes nothing; the same flow in English; making a write key in English. Runs on the dev stack; the
// markers it adds are removed and every proposal it made is rejected afterwards.
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK, sheet } from './helpers'

const KEY_NAME = `${MARK}-ai`
const SUB = `${MARK}-sub`
const CHECK = `${MARK}-check`

interface Proposal { id: string; keyName: string; status: string }

async function makeKey(request: APIRequestContext, confirm: 'ui' | 'chat', name = KEY_NAME) {
  const r = await request.post('/api/keys', { data: { name, expiresInDays: 30, write: true, confirm } })
  expect(r.status()).toBe(201)
  return ((await r.json()) as { key: string }).key
}

/** A tool call with a key and no session. */
async function tool(baseURL: string, key: string, name: string, args: Record<string, unknown>) {
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

const propose = (baseURL: string, key: string) => tool(baseURL, key, 'propose_changes', {
  note: `${MARK} note`,
  changes: [
    { resource: 'subscriptions', action: 'create', data: { name: SUB, category: 'tool', plan: 'p', amount: 9900, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false } },
    { resource: 'checks', action: 'create', data: { text: CHECK, done: false } },
  ],
})

const state = async (request: APIRequestContext) => (await (await request.get('/api/state')).json()) as {
  subscriptions: { id: string; name: string }[]; checks: { id: string; text: string }[]
}

test.afterEach(async ({ page, request }) => {
  // whatever happened, the shared account follows the browser's language again
  await page.goto('/#settings/general')
  await page.locator('#g-lang').waitFor()
  if ((await page.locator('#g-lang').inputValue()) !== 'browser') await pickLanguage(page, 'browser')
  const props = (await (await request.get('/api/proposals?status=pending')).json()) as Proposal[]
  for (const p of props.filter((x) => x.keyName.startsWith(MARK))) await request.post(`/api/proposals/${p.id}/reject`)
  const keys = (await (await request.get('/api/keys')).json()) as { keys: { id: string; name: string }[] }
  for (const k of keys.keys.filter((x) => x.name.startsWith(MARK))) await request.delete(`/api/keys/${k.id}`)
  const s = await state(request)
  for (const x of s.subscriptions.filter((x) => x.name.startsWith(MARK))) await request.delete(`/api/subscriptions/${x.id}`)
  for (const x of s.checks.filter((x) => x.text.startsWith(MARK))) await request.delete(`/api/checks/${x.id}`)
})

test('pending: the list, the badge and the preview; confirming applies it and the history says which key', async ({ page, request, baseURL }) => {
  const key = await makeKey(request, 'ui')
  const made = await propose(baseURL!, key)
  expect(made.confirm).toBe('ui')

  await page.goto('/#pending')
  await expect(page.getByRole('heading', { name: '대기 중인 변경', exact: true })).toBeVisible()
  const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
  await expect(card).toBeVisible()
  await expect(card).toContainText(`${KEY_NAME} 키의 제안`)
  await expect(card).toContainText(`${MARK} note`)
  // the preview: rows before and after, and the month's transfer and distribution before and after
  await expect(card).toContainText(`구독 추가 · ${SUB}`)
  await expect(card).toContainText(`체크리스트 추가 · ${CHECK}`)
  await expect(card).toContainText('구독 이체액')
  // the fields have names, not property names
  await expect(card).toContainText('다음 결제일')
  await expect(card).not.toContainText('nextDate')
  await expect(card.getByText('이체·분배').first()).toBeVisible()
  await expect(card.getByText('→').first()).toBeVisible()
  // the sidebar badge counts the waiting proposals
  await expect(page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: /대기 중인 변경/ }).locator('.badge')).toHaveText(/^[1-9]/)
  // nothing is applied yet
  expect((await state(request)).subscriptions.some((s) => s.name === SUB)).toBe(false)

  await card.getByRole('button', { name: '확인하고 적용' }).click()
  await expect(page.getByRole('status').filter({ hasText: '적용했어요' })).toBeVisible()
  await expect(card).toHaveCount(0)
  expect((await state(request)).subscriptions.some((s) => s.name === SUB)).toBe(true)
  await expect(page.getByRole('list', { name: '처리한 제안' }).getByRole('listitem').first()).toContainText('적용됨')

  // the history names the key; reverting it from there works on an AI change
  await page.goto('/#history')
  const list = page.getByRole('list', { name: '변경 목록' })
  const first = list.getByRole('listitem').first()
  await expect(first).toContainText(`AI · ${KEY_NAME}`)
  await expect(first).toContainText(`구독 추가 · ${SUB}`)
  page.once('dialog', (d) => d.accept())
  await first.getByRole('button', { name: '되돌리기' }).click()
  await expect(page.getByRole('status')).toHaveText('되돌렸어요.')
  expect((await state(request)).subscriptions.some((s) => s.name === SUB)).toBe(false)
})

test('pending: rejecting changes nothing and moves it to the handled list', async ({ page, request, baseURL }) => {
  const key = await makeKey(request, 'chat')
  const made = await propose(baseURL!, key)
  await page.goto('/#pending')
  const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
  await expect(card).toContainText('대화에서도 확인할 수 있어요')
  await card.getByRole('button', { name: '거절', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '거절했어요' })).toBeVisible()
  await expect(card).toHaveCount(0)
  await expect(page.getByRole('list', { name: '처리한 제안' }).getByRole('listitem').first()).toContainText('거절함')
  const s = await state(request)
  expect(s.subscriptions.some((x) => x.name === SUB) || s.checks.some((x) => x.text === CHECK)).toBe(false)
  // it cannot be applied any more
  expect((await request.post(`/api/proposals/${made.proposalId as string}/apply`)).status()).toBe(409)
})

test('pending: a proposal whose key was revoked cannot be confirmed, only rejected', async ({ page, request, baseURL }) => {
  const key = await makeKey(request, 'ui', `${KEY_NAME}-gone`)
  const made = await propose(baseURL!, key)
  const keys = (await (await request.get('/api/keys')).json()) as { keys: { id: string; name: string }[] }
  await request.delete(`/api/keys/${keys.keys.find((k) => k.name === `${KEY_NAME}-gone`)!.id}`)
  await page.goto('/#pending')
  const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
  await expect(card).toContainText('더 쓸 수 없어서')
  await expect(card.getByRole('button', { name: '확인하고 적용' })).toBeDisabled()
  await card.getByRole('button', { name: '거절', exact: true }).click()
  await expect(card).toHaveCount(0)
})

async function pickLanguage(page: Page, value: 'browser' | 'en') {
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PUT' && r.ok())
  await page.locator('#g-lang').selectOption(value)
  await saved
}

test('pending in English: make a write key, the same flow, the history', async ({ page, request, baseURL }) => {
  await page.goto('/#settings/general')
  await pickLanguage(page, 'en')

  // a write key chooses its confirmation method
  await page.goto('/#settings/ai')
  await page.getByRole('button', { name: '+ Create key' }).click()
  const s = sheet(page, 'New API key')
  await s.getByLabel('Name', { exact: false }).first().fill(`${KEY_NAME}-en`)
  await expect(s.getByRole('radio')).toHaveCount(0)
  await s.getByLabel('Allow writing').check()
  await expect(s.getByRole('radio', { name: 'Confirm in Allot' })).toBeChecked()
  await s.getByRole('radio', { name: 'Confirm in the chat' }).check()
  await s.getByRole('button', { name: 'Save' }).click()
  await expect(s).toBeHidden()
  await expect(page.getByRole('row', { name: new RegExp(`${KEY_NAME}-en`) })).toContainText('Read and write · confirm in chat')

  const key = await makeKey(request, 'ui')
  const made = await propose(baseURL!, key)
  await page.goto('/#pending')
  await expect(page.getByRole('heading', { name: 'Pending changes', exact: true })).toBeVisible()
  const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
  await expect(card).toContainText(`Proposed by key ${KEY_NAME}`)
  await expect(card).toContainText(`${SUB}`)
  await expect(card).toContainText('Subscription transfer')
  await expect(card).toContainText('Next payment')
  await expect(card).not.toContainText('nextDate')
  await card.getByRole('button', { name: 'Confirm and apply' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Applied.' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Handled proposals' }).getByRole('listitem').first()).toContainText('Applied')
  await page.goto('/#history')
  await expect(page.getByRole('list', { name: 'Changes' }).getByRole('listitem').first()).toContainText(`AI · ${KEY_NAME}`)
})
