// spec 009 V-10: 대기 중인 변경 — a proposal an AI key made (through MCP) is listed with its preview and the
// sidebar badge, confirming applies it and shows in 변경 내역 as "AI · key name" (and reverts), rejecting
// changes nothing; the same flow in English; making a write key in English. Runs on the dev stack; the
// markers it adds are removed and every proposal it made is rejected afterwards.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK, choose, sheet } from './helpers'
import { CHECK, KEY_NAME, SPEND, SPEND_AMOUNT, SUB, makeKey, propose, proposeSpending, type Proposal } from './proposal-helpers'

const state = async (request: APIRequestContext) => (await (await request.get('/api/state')).json()) as {
  subscriptions: { id: string; name: string }[]; checks: { id: string; text: string }[]; spendings: { id: string; name: string }[]
}

test.afterEach(async ({ page, request }) => {
  // whatever happened, the shared account follows the browser's language again
  await page.goto('/#settings/general')
  await page.locator('#g-lang').waitFor()
  if ((await page.locator('#g-lang').getAttribute('data-value')) !== 'browser') await pickLanguage(page, 'browser')
  const props = (await (await request.get('/api/proposals?status=pending')).json()) as Proposal[]
  for (const p of props.filter((x) => x.keyName.startsWith(MARK))) expect((await request.post(`/api/proposals/${p.id}/reject`)).ok()).toBe(true)
  const keys = (await (await request.get('/api/keys')).json()) as { keys: { id: string; name: string }[] }
  for (const k of keys.keys.filter((x) => x.name.startsWith(MARK))) expect((await request.delete(`/api/keys/${k.id}`)).ok()).toBe(true)
  const s = await state(request)
  for (const x of s.subscriptions.filter((x) => x.name.startsWith(MARK))) await request.delete(`/api/subscriptions/${x.id}`)
  for (const x of s.checks.filter((x) => x.text.startsWith(MARK))) await request.delete(`/api/checks/${x.id}`)
  for (const x of s.spendings.filter((x) => x.name.startsWith(MARK))) await request.delete(`/api/spendings/${x.id}`)
})

test('pending: the list, the badge and the preview; confirming applies it and the history says which key', async ({ page, request, baseURL }) => {
  const key = await makeKey(request, 'ui')
  const made = await propose(baseURL!, key)
  expect(made.confirm).toBe('ui')

  await page.goto('/#pending')
  await expect(page.getByRole('heading', { name: '대기 중인 변경', exact: true })).toBeVisible()
  const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
  await expect(card).toBeVisible()
  await expect(card).toContainText(`${KEY_NAME} 키`)
  // the title is the AI's own note; the status pill says it waits
  await expect(card.locator('.tt b')).toHaveText(`${MARK} note`)
  await expect(card.locator('.pill', { hasText: '확인 대기' })).toBeVisible()
  // the preview: rows before and after, and the month's transfer and distribution before and after
  await expect(card).toContainText(`구독 추가 · ${SUB}`)
  await expect(card).toContainText(`체크리스트 · ${CHECK}`)
  await expect(card).toContainText('구독 이체액')
  // the fields have names, not property names
  await expect(card).toContainText('다음 결제일')
  await expect(card).not.toContainText('nextDate')
  await expect(card.getByText('그래서 달라지는 이체·분배')).toBeVisible()
  // values are worded: the cycle, the VAT, the receipt state
  await expect(card).toContainText('월간')
  await expect(card).toContainText('0%')
  await expect(card).toContainText('미확인')
  await expect(card.getByText('→').first()).toBeVisible()
  // the sidebar badge counts the waiting proposals
  await expect(page.getByRole('navigation', { name: '메뉴' }).getByRole('link', { name: /대기 중인 변경/ }).locator('.badge')).toHaveText(/^[1-9]/)
  // nothing is applied yet
  expect((await state(request)).subscriptions.some((s) => s.name === SUB)).toBe(false)

  await card.getByRole('button', { name: '확인하고 적용' }).click()
  await expect(page.getByRole('status').filter({ hasText: '제안을 적용했어요' })).toBeVisible()
  // the card stays, as applied, with its undo (spec 010 S-6)
  await expect(card).toBeVisible()
  await expect(card.locator('.pill', { hasText: '적용됨' })).toBeVisible()
  expect((await state(request)).subscriptions.some((s) => s.name === SUB)).toBe(true)
  // undo = revert of the change set: the data goes back and the pill says 되돌림
  await card.getByRole('button', { name: '되돌리기', exact: true }).click()
  await expect(card.locator('.pill', { hasText: '되돌림' })).toBeVisible()
  await expect(card.getByRole('button', { name: '되돌리기', exact: true })).toHaveCount(0)
  expect((await state(request)).subscriptions.some((s) => s.name === SUB)).toBe(false)
  // after a reload it is in the handled filter, with the way to the history
  await page.reload()
  await page.getByRole('button', { name: '처리함', exact: true }).click()
  await expect(page.locator(`[data-proposal="${made.proposalId as string}"]`)).toContainText('변경 내역에서')

  // the history names the key; reverting it from there works on an AI change
  await page.goto('/#history')
  const list = page.getByRole('list', { name: '변경 목록' })
  const first = list.getByRole('listitem').filter({ hasText: `AI · ${KEY_NAME}` }).first()
  await expect(first).toContainText(`AI · ${KEY_NAME}`)
  await expect(first).toContainText(`구독 추가 · ${SUB}`)
})

test('pending: an applied AI change set is reverted from 변경 내역 (the history keeps that revert)', async ({ page, request, baseURL }) => {
  const key = await makeKey(request, 'ui')
  const made = await propose(baseURL!, key)
  expect((await request.post(`/api/proposals/${made.proposalId as string}/apply`)).status()).toBe(200)
  expect((await state(request)).subscriptions.some((s) => s.name === SUB)).toBe(true)
  await page.goto('/#history')
  const list = page.getByRole('list', { name: '변경 목록' })
  const first = list.getByRole('listitem').filter({ hasText: `AI · ${KEY_NAME}` }).first()
  await expect(first).toContainText(`구독 추가 · ${SUB}`)
  await first.getByRole('button', { name: '되돌리기', exact: true }).click()
  await page.getByRole('form', { name: '이 변경을 되돌릴까요?' }).getByRole('button', { name: '되돌리기', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /되돌렸어요/ })).toBeVisible()
  expect((await state(request)).subscriptions.some((s) => s.name === SUB)).toBe(false)
})

// spec 011 V-9: an AI's one-off spending proposal is confirmed on the screen and reverted in the history.
test('pending: an AI spending proposal shows the month numbers, confirming it adds the spending and moves the month card, 변경 내역 reverts it', async ({ page, request, baseURL }) => {
  const digits = (x: string) => Number(x.replace(/[^\d]/g, ''))
  const card0 = () => page.getByRole('region', { name: /지출 반영/ })
  const outflow = async () => digits(await card0().locator('.ms-g > div').nth(0).locator('b.num').first().innerText())
  const spendNames = async () => (await state(request)).spendings.filter((x) => x.name === SPEND)
  expect(await spendNames()).toHaveLength(0)
  await page.goto('/#spend/general')
  await expect(card0()).toBeVisible()
  const out0 = await outflow()

  const key = await makeKey(request, 'ui')
  const made = await proposeSpending(baseURL!, key)
  expect(made.confirm).toBe('ui')
  // the preview of the tool: this month's remainder falls by the amount, the transfer stays
  const months = (made.preview as { months: { month: string; transferKrw: { before: number; after: number }; remainderKrw: { before: number; after: number } }[] }).months
  const m0 = months[0]!
  expect(m0.remainderKrw.before - m0.remainderKrw.after).toBe(SPEND_AMOUNT)
  expect(m0.transferKrw.after).toBe(m0.transferKrw.before)
  expect(await spendNames(), 'proposing writes nothing').toHaveLength(0)

  await page.goto('/#pending')
  const pcard = page.locator(`[data-proposal="${made.proposalId as string}"]`)
  await expect(pcard).toBeVisible()
  await expect(pcard.locator('.tt b')).toHaveText(`${MARK} spending note`)
  await expect(pcard.locator('.pill', { hasText: '확인 대기' })).toBeVisible()
  // the rows: the spending and its round, with the name
  await expect(pcard).toContainText(SPEND)
  await expect(pcard.locator('.chg')).toHaveCount(2)
  // the month numbers: the first month box shows this month's remainder before and after
  const box = pcard.locator('.mbox').first()
  await expect(box).toBeVisible()
  const fmt = (n: number) => n.toLocaleString('ko-KR')
  await expect(box.locator('.mh .num').first()).toContainText(String(Number(m0.month.slice(5))))
  const moved = box.locator('.mr:not(.same)')
  await expect(moved.first(), 'a distribution row moves').toBeVisible()
  await expect(box.locator('.mh b.num'), 'the remainder target moves by the amount').toContainText(fmt(SPEND_AMOUNT))
  await expect(box.locator('.mr').first().locator('.num.old')).toContainText(fmt(m0.transferKrw.before))
  await expect(box.locator('.mr').first().locator('.num.new')).toContainText(fmt(m0.transferKrw.after))

  await pcard.getByRole('button', { name: '확인하고 적용' }).click()
  await expect(page.getByRole('status').filter({ hasText: '제안을 적용했어요' })).toBeVisible()
  await expect(pcard.locator('.pill', { hasText: '적용됨' })).toBeVisible()
  const got = await spendNames()
  expect(got).toHaveLength(1)

  // the spending is on 지출 › 일반 and the month card moved by the amount
  await page.goto('/#spend/general')
  await expect(card0()).toBeVisible()
  await expect(page.getByText(SPEND).first()).toBeVisible()
  expect(await outflow(), 'the month card: the remainder line grew by the spending').toBe(out0 + SPEND_AMOUNT)

  // 변경 내역: the AI change set names the key; revert it through the screen
  await page.goto('/#history')
  const list = page.getByRole('list', { name: '변경 목록' })
  const first = list.getByRole('listitem').filter({ hasText: `AI · ${KEY_NAME}` }).first()
  await expect(first).toContainText(SPEND)
  await first.getByRole('button', { name: '되돌리기', exact: true }).click()
  await page.getByRole('form', { name: '이 변경을 되돌릴까요?' }).getByRole('button', { name: '되돌리기', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /되돌렸어요/ })).toBeVisible()
  expect(await spendNames(), 'the spending is gone (API)').toHaveLength(0)
  await page.goto('/#spend/general')
  await expect(card0()).toBeVisible()
  await expect(page.getByText(SPEND)).toHaveCount(0)
  expect(await outflow(), 'the month card is back').toBe(out0)
})

test('pending: the toast Undo works before the proposal list has refreshed (the apply answer carries the change set)', async ({ page, request, baseURL }) => {
  const key = await makeKey(request, 'ui')
  const made = await propose(baseURL!, key)
  await page.goto('/#pending')
  const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
  await expect(card).toBeVisible()
  // hold the list refresh back after the decision
  await page.route('**/api/proposals?status=*', async (route) => {
    await new Promise((r) => setTimeout(r, 2500))
    await route.continue()
  })
  await card.getByRole('button', { name: '확인하고 적용' }).click()
  const toast = page.getByRole('status').filter({ hasText: '제안을 적용했어요' })
  await expect(toast).toBeVisible()
  await toast.getByRole('button', { name: '되돌리기', exact: true }).click()
  await expect.poll(async () => (await state(request)).subscriptions.some((s) => s.name === SUB), { timeout: 8000 }).toBe(false)
  await expect(card.locator('.pill', { hasText: '되돌림' })).toBeVisible({ timeout: 8000 })
  await page.unroute('**/api/proposals?status=*')
})

test('pending: rejecting changes nothing and moves it to the handled list', async ({ page, request, baseURL }) => {
  const key = await makeKey(request, 'chat')
  const made = await propose(baseURL!, key)
  await page.goto('/#pending')
  const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
  await expect(card).toContainText('대화에서도 확인할 수 있어요')
  await card.getByRole('button', { name: '거절', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '제안을 거절했어요' })).toBeVisible()
  // the card stays as rejected; a rejected proposal has no undo
  await expect(card.locator('.pill', { hasText: '거절됨' })).toBeVisible()
  await expect(card.getByRole('button', { name: '되돌리기', exact: true })).toHaveCount(0)
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
  await expect(card.locator('.pill', { hasText: '거절됨' })).toBeVisible()
})

async function pickLanguage(page: Page, value: 'browser' | 'en') {
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PUT' && r.ok())
  await choose(page.locator('#g-lang'), value)
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
  await expect(s.getByRole('radio', { name: 'Confirm in the chat' })).toHaveCount(0)
  await s.getByRole('radio', { name: /Allow write proposals/ }).click()
  await expect(s.getByRole('radio', { name: 'Confirm in Allot' })).toBeChecked()
  await s.getByRole('radio', { name: 'Confirm in the chat' }).check()
  await s.getByRole('button', { name: 'Create key', exact: true }).click()
  await expect(s).toBeHidden()
  await expect(page.getByRole('row', { name: new RegExp(`${KEY_NAME}-en`) })).toContainText('Read and write · confirm in chat')

  const key = await makeKey(request, 'ui')
  const made = await propose(baseURL!, key)
  await page.goto('/#pending')
  await expect(page.getByRole('heading', { name: 'Pending changes', exact: true })).toBeVisible()
  const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
  await expect(card).toContainText(`Key ${KEY_NAME}`)
  await expect(card).toContainText(`${SUB}`)
  await expect(card).toContainText('Subscription transfer')
  await expect(card).toContainText('Next payment')
  await expect(card).not.toContainText('nextDate')
  await card.getByRole('button', { name: 'Confirm and apply' }).click()
  await expect(page.getByRole('status').filter({ hasText: /Applied “/ })).toBeVisible()
  await expect(card.locator('.pill', { hasText: 'Applied' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Undo' })).toBeVisible()
  await page.goto('/#history')
  await expect(page.getByRole('list', { name: 'Changes' }).getByRole('listitem').first()).toContainText(`AI · ${KEY_NAME}`)
})
