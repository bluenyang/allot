// spec 010 V-6 (what the screens kept accepting) and V-10 (the new flows) for 구독: amounts `12.5`, `1,000`
// and `0` saved and read back, a plan change with VAT / 상태 / "그대로", a plan change on a cancelled
// subscription, the two steps, and the same flow once in English. Every subscription made here carries
// the test mark and is deleted at the end (a subscription takes its plan changes with it).
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK as RUN, go, saveSheet, sheet } from './helpers'

const MARK = `${RUN}-sub`
type Sub = { id: string; name: string; amount: number; currency: string; vat: number; status: string; cycle: string; plan: string }
type Change = { id: string; subId: string; effective: string | null; to: Record<string, unknown>; note: string }

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
const state = async (request: APIRequestContext) => (await api(request, 'GET', '/api/state')).json as { subscriptions: Sub[]; planChanges: Change[]; preferences: Record<string, unknown> }
const mine = async (request: APIRequestContext) => (await state(request)).subscriptions.filter((s) => s.name.startsWith(MARK))
const body = (name: string, over: Record<string, unknown> = {}) => ({
  name, category: 'tool', plan: 'p', amount: 1000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false, ...over,
})

test.afterEach(async ({ request }) => {
  for (const s of await mine(request)) await api(request, 'DELETE', `/api/subscriptions/${s.id}`)
})

/** 구독 추가 through the two steps. */
async function addSub(page: Page, name: string, o: { currency?: 'KRW' | 'USD'; amount: string; vat?: string }) {
  await page.getByRole('button', { name: '구독 추가' }).click()
  const s = sheet(page, '구독 추가')
  await s.getByLabel('서비스 이름').fill(name)
  await s.getByRole('button', { name: '다음' }).click()
  if (o.currency === 'USD') await s.getByRole('button', { name: 'USD', exact: true }).click()
  await s.getByLabel('금액', { exact: true }).fill(o.amount)
  if (o.vat) await s.getByLabel('VAT (%)').fill(o.vat)
  await s.getByLabel('다음 결제일').fill('2031-01-15')
  await saveSheet(page, '구독 추가')
}

test('(V-6) amounts 12.5 (foreign), 1,000 and 0 are saved and read back; the VAT field takes a decimal', async ({ page, request }) => {
  await go(page, 'subs', '목록')
  await addSub(page, `${MARK}-usd`, { currency: 'USD', amount: '12.5', vat: '10.5' })
  await addSub(page, `${MARK}-sep`, { amount: '1,000' })
  await addSub(page, `${MARK}-zero`, { amount: '0' })
  const got = Object.fromEntries((await mine(request)).map((s) => [s.name.replace(`${MARK}-`, ''), s]))
  expect(got.usd).toMatchObject({ amount: 12.5, currency: 'USD', vat: 10.5 })
  expect(got.sep).toMatchObject({ amount: 1000, currency: 'KRW', vat: 0 })
  expect(got.zero).toMatchObject({ amount: 0, currency: 'KRW' })
  // open again: the field shows what was saved
  await page.reload()
  await go(page, 'subs', '목록')
  for (const [key, want] of [['usd', '12.5'], ['sep', '1,000'], ['zero', '0']] as const) {
    await page.getByRole('button', { name: `${MARK}-${key} 수정` }).click()
    const s = sheet(page, '구독 수정')
    await s.getByRole('button', { name: '다음' }).click()
    await expect(s.getByLabel('금액', { exact: true }), key).toHaveValue(want)
    if (key === 'usd') await expect(s.getByLabel('VAT (%)')).toHaveValue('10.5')
    await s.getByRole('button', { name: '취소', exact: true }).click()
    await expect(s).toBeHidden()
  }
})

test('(V-6) a plan change keeps VAT, 상태 and "그대로": saved as given, nothing else written, same on reopening', async ({ page, request }) => {
  const sub = (await api(request, 'POST', '/api/subscriptions', body(`${MARK}-usd`, { currency: 'USD', amount: 20, vat: 10 }))).json as Sub
  await go(page, 'subs', '변경 일정')
  await page.getByRole('button', { name: '+ 전환 예약' }).click()
  const s = sheet(page, '플랜 전환 예약')
  await expect(s.getByRole('listitem').filter({ hasText: '대상 · 적용일' })).toHaveAttribute('aria-current', 'step')
  await s.getByLabel('대상 구독').selectOption({ label: sub.name })
  await expect(s.getByText('지금 플랜: ')).toContainText('USD 20.00 +10%')
  await s.getByRole('button', { name: '다음' }).click()
  await expect(s.getByRole('listitem').filter({ hasText: '새 플랜 · 금액' })).toHaveAttribute('aria-current', 'step')
  // every choice starts at "그대로"; only VAT and 상태 are set
  await expect(s.getByRole('group', { name: '통화' }).getByRole('button', { name: '그대로' })).toHaveAttribute('aria-pressed', 'true')
  await s.getByLabel('VAT (%)').fill('8')
  await s.getByRole('group', { name: '상태' }).getByRole('button', { name: '해지' }).click()
  await saveSheet(page, '플랜 전환 예약')
  const made = (await state(request)).planChanges.filter((c) => c.subId === sub.id)
  expect(made).toHaveLength(1)
  expect(made[0]!.to).toEqual({ vat: 8, status: 'cancelled' })
  expect(made[0]!.effective).toMatch(/^\d{4}-\d{2}-01$/)
  // reopen: the same values, the rest still "그대로"
  await page.reload()
  await go(page, 'subs', '변경 일정')
  await page.getByRole('button', { name: `${sub.name} 전환 수정` }).click()
  const e = sheet(page, '플랜 전환 수정')
  await e.getByRole('button', { name: '다음' }).click()
  await expect(e.getByLabel('VAT (%)')).toHaveValue('8')
  await expect(e.getByRole('group', { name: '상태' }).getByRole('button', { name: '해지' })).toHaveAttribute('aria-pressed', 'true')
  await expect(e.getByRole('group', { name: '결제 주기' }).getByRole('button', { name: '그대로' })).toHaveAttribute('aria-pressed', 'true')
  await expect(e.getByLabel('새 금액')).toHaveValue('')
  await e.getByRole('button', { name: '취소', exact: true }).click()
  await expect(e).toBeHidden()
})

test('(V-6) a cancelled subscription is still a target; an undated change and the amounts 12.5, 1,000, 0 are saved', async ({ page, request }) => {
  const sub = (await api(request, 'POST', '/api/subscriptions', body(`${MARK}-off`, { status: 'cancelled' }))).json as Sub
  await go(page, 'subs', '변경 일정')
  await page.getByRole('button', { name: '+ 전환 예약' }).click()
  const s = sheet(page, '플랜 전환 예약')
  await expect(s.getByLabel('대상 구독').locator('option', { hasText: sub.name })).toHaveCount(1)
  await s.getByLabel('대상 구독').selectOption({ label: sub.name })
  await expect(s.getByText('지금 플랜: ')).toContainText('해지')
  await s.getByLabel('날짜 미정').check()
  await expect(s.getByLabel('적용일')).toBeDisabled()
  await expect(s.getByText('날짜를 정하기 전까지는')).toBeVisible()
  await s.getByRole('button', { name: '다음' }).click()
  await s.getByRole('group', { name: '상태' }).getByRole('button', { name: '구독 중' }).click()
  await s.getByLabel('새 금액').fill('12.5')
  await saveSheet(page, '플랜 전환 예약')
  const find = async () => (await state(request)).planChanges.find((c) => c.subId === sub.id)!
  expect((await find()).effective).toBeNull()
  expect((await find()).to).toEqual({ status: 'active', amount: 12.5 })
  await expect(page.getByRole('listitem').filter({ hasText: sub.name }).getByText('미반영')).toBeVisible()
  // the other two forms of the amount, through the editor of that change
  for (const [typed, want] of [['1,000', 1000], ['0', 0]] as const) {
    await page.getByRole('button', { name: `${sub.name} 전환 수정` }).click()
    const e = sheet(page, '플랜 전환 수정')
    await e.getByRole('button', { name: '다음' }).click()
    await e.getByLabel('새 금액').fill(typed)
    await saveSheet(page, '플랜 전환 수정')
    expect((await find()).to.amount).toBe(want)
  }
  await page.reload()
  await go(page, 'subs', '변경 일정')
  await page.getByRole('button', { name: `${sub.name} 전환 수정` }).click()
  const r = sheet(page, '플랜 전환 수정')
  await r.getByRole('button', { name: '다음' }).click()
  await expect(r.getByLabel('새 금액')).toHaveValue('0')
  await r.getByRole('button', { name: '취소', exact: true }).click()
})

test('(V-10) 해지로 바꾸기 sets the status on step 2 and saves with 저장; the list filters by status', async ({ page, request }) => {
  const sub = (await api(request, 'POST', '/api/subscriptions', body(`${MARK}-cancel`))).json as Sub
  await go(page, 'subs', '목록')
  await page.getByRole('button', { name: `${sub.name} 수정` }).click()
  const s = sheet(page, '구독 수정')
  await s.getByRole('button', { name: '다음' }).click()
  await s.getByRole('button', { name: '해지', exact: true }).click()
  await saveSheet(page, '구독 수정')
  expect((await mine(request)).find((x) => x.id === sub.id)?.status).toBe('cancelled')
  await expect(page.getByRole('button', { name: `${sub.name} 수정` })).toHaveCount(0) // the list starts on 활성
  await page.getByRole('group', { name: '상태로 거르기' }).getByRole('button', { name: /^해지/ }).click()
  await expect(page.getByRole('row', { name: new RegExp(sub.name) })).toContainText('해지')
})

test('(V-10) in English: the same two-step add, a plan change, delete asks first', async ({ page, request }) => {
  const prefs = (await state(request)).preferences
  await api(request, 'PUT', '/api/preferences', { ...prefs, language: 'en' })
  try {
    await page.goto('/#subs')
    await page.getByRole('tablist').first().waitFor()
    await page.getByRole('button', { name: 'Add subscription' }).click()
    const add = sheet(page, 'Add subscription')
    await expect(add.getByRole('listitem').filter({ hasText: 'Basics' })).toHaveAttribute('aria-current', 'step')
    await add.getByLabel('Service name').fill(`${MARK}-en`)
    await add.getByRole('button', { name: 'Next' }).click()
    await expect(add.getByRole('listitem').filter({ hasText: 'Payment' })).toHaveAttribute('aria-current', 'step')
    await add.getByLabel('Amount', { exact: true }).fill('4,500')
    await add.getByLabel('Next payment date').fill('2031-01-15')
    await add.getByRole('button', { name: 'Save' }).click()
    await expect(add).toBeHidden()
    expect((await mine(request)).map((x) => x.amount)).toEqual([4500])

    await page.getByRole('tab', { name: /Scheduled changes/ }).click()
    await page.getByRole('button', { name: '+ Schedule change' }).click()
    const c = sheet(page, 'Schedule plan change')
    await c.getByLabel('Subscription').selectOption({ label: `${MARK}-en` })
    await c.getByRole('button', { name: 'Next' }).click()
    await c.getByLabel('New amount').fill('5,000')
    await c.getByRole('button', { name: 'Save' }).click()
    await expect(c).toBeHidden()

    await page.getByRole('tab', { name: /^List/ }).click()
    await page.getByRole('button', { name: `Edit ${MARK}-en` }).click()
    const e = sheet(page, 'Edit subscription')
    await e.getByRole('button', { name: 'Next' }).click()
    await e.getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('scheduled plan changes')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
    await expect(e).toBeHidden()
    expect(await mine(request)).toHaveLength(0)
  } finally {
    await api(request, 'PUT', '/api/preferences', prefs)
  }
})
