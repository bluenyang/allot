// spec 010 V-6 (what the screens kept accepting) and V-10 (the new flows) for 구독: amounts `12.5`, `1,000`
// and `0` saved and read back, a plan change with VAT / 상태 / "그대로", a plan change on a cancelled
// subscription, the two steps, and the same flow once in English. Every subscription made here carries
// the test mark and is deleted at the end (a subscription takes its plan changes with it).
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK as RUN, choose, optionTexts, go, saveSheet, sheet } from './helpers'

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
  await choose(s.getByLabel('대상 구독'), { label: sub.name })
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
  expect((await optionTexts(s.getByLabel('대상 구독'))).filter((x) => x.includes(sub.name))).toHaveLength(1)
  await choose(s.getByLabel('대상 구독'), { label: sub.name })
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
    await choose(c.getByLabel('Subscription'), { label: `${MARK}-en` })
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

// ---- spec 010 A-9: the three kept features, help bubbles, the editor's steps ----

test('(A-9) the name search narrows the list; the 12-month chart and the share table are on 이체액 계산', async ({ page, request }) => {
  await api(request, 'POST', '/api/subscriptions', body(`${MARK}-find`, { amount: 3000 }))
  await api(request, 'POST', '/api/subscriptions', body(`${MARK}-other`, { amount: 5000 }))
  await go(page, 'subs', '목록')
  const search = page.getByRole('searchbox', { name: '구독 검색' })
  await search.fill(`${MARK}-FIND`) // not case-sensitive
  await expect(page.getByRole('row', { name: new RegExp(`${MARK}-find`) })).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(`${MARK}-other`) })).toHaveCount(0)
  await search.fill('')
  await expect(page.getByRole('row', { name: new RegExp(`${MARK}-other`) })).toBeVisible()

  await page.getByRole('tab', { name: '이체액 계산' }).click()
  const chart = page.getByRole('img', { name: '월별 구독 필요 이체액' })
  await expect(chart).toBeVisible()
  await expect(chart.locator('g[style*="cursor"]')).toHaveCount(12)
  const share = page.locator('.share')
  await expect(share.getByRole('row', { name: new RegExp(`${MARK}-find`) })).toContainText('₩3,000')
  await expect(share.getByRole('row', { name: new RegExp(`${MARK}-find`) })).toContainText('%')
  const cap = share.locator('caption')
  const before = await cap.textContent()
  await chart.locator('g[style*="cursor"]').nth(5).click()
  await expect(cap).not.toHaveText(before!)
  await expect(share.getByRole('row', { name: new RegExp(`${MARK}-find`) })).toBeVisible()
})

test('(A-9) a help bubble stays inside the screen on a phone, and Escape closes it, not the editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, 'subs', '목록')
  await page.getByRole('button', { name: '구독 추가' }).click()
  const s = sheet(page, '구독 추가')
  await s.getByLabel('서비스 이름').fill(`${MARK}-tip`)
  await s.getByRole('button', { name: '다음' }).click()
  await s.getByRole('button', { name: 'USD', exact: true }).click()
  const tips = s.getByRole('img', { name: /^도움말/ })
  await expect(tips).toHaveCount(3)
  for (let i = 0; i < 3; i++) {
    await tips.nth(i).focus()
    const bub = tips.nth(i).getByRole('tooltip', { includeHidden: true })
    await expect(bub).toBeVisible()
    const box = (await bub.boundingBox())!
    expect(box.x, `tip ${i} left`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `tip ${i} right`).toBeLessThanOrEqual(390)
    expect(box.y, `tip ${i} top`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `tip ${i} bottom`).toBeLessThanOrEqual(844)
    await page.keyboard.press('Escape')
    await expect(bub).toBeHidden()
    await expect(s).toBeVisible()
  }
  await page.keyboard.press('Escape') // the focus is still in the dialog: now it cancels
  await expect(s).toBeHidden()
})

test('(A-9) the plan change always has the VAT field: for a KRW plan too, and when an earlier change made it USD', async ({ page, request }) => {
  const sub = (await api(request, 'POST', '/api/subscriptions', body(`${MARK}-usdlater`))).json as Sub
  await api(request, 'POST', '/api/plan-changes', { subId: sub.id, effective: '2020-01-01', to: { currency: 'USD', amount: 10 }, note: '' })
  const krw = (await api(request, 'POST', '/api/subscriptions', body(`${MARK}-krwvat`))).json as Sub
  await go(page, 'subs', '변경 일정')
  await page.getByRole('button', { name: '+ 전환 예약' }).click()
  const s = sheet(page, '플랜 전환 예약')
  await choose(s.getByLabel('대상 구독'), { label: sub.name })
  await s.getByRole('button', { name: '다음' }).click()
  await expect(s.getByLabel('VAT (%)')).toBeVisible()
  await expect(s.getByText('VAT는 USD 결제에만')).toHaveCount(0)
  await s.getByRole('button', { name: '이전' }).click()
  await choose(s.getByLabel('대상 구독'), { label: krw.name })
  await s.getByRole('button', { name: '다음' }).click()
  await expect(s.getByLabel('VAT (%)')).toBeVisible() // a KRW plan, currency "그대로"
  await s.getByLabel('VAT (%)').fill('9')
  await s.getByRole('button', { name: '취소', exact: true }).click()
})

test('(A-9) the editor: Enter on step 1 goes on, Back keeps both steps, a server error stays on step 2', async ({ page }) => {
  await go(page, 'subs', '목록')
  await page.getByRole('button', { name: '구독 추가' }).click()
  const s = sheet(page, '구독 추가')
  await s.getByLabel('서비스 이름').fill(`${MARK}-steps`)
  await s.getByLabel('플랜').fill('플랜값')
  await s.getByLabel('서비스 이름').press('Enter')
  await expect(s.getByRole('listitem').filter({ hasText: '결제' })).toHaveAttribute('aria-current', 'step')
  await s.getByLabel('금액', { exact: true }).fill('99999999999') // past what the server takes
  await s.getByLabel('다음 결제일').fill('2031-01-15')
  await s.getByRole('button', { name: '저장' }).click()
  await expect(s.getByRole('alert')).toContainText('금액이 너무 커요.')
  await expect(s.getByRole('listitem').filter({ hasText: '결제' })).toHaveAttribute('aria-current', 'step')
  await s.getByRole('button', { name: '이전' }).click()
  await expect(s.getByLabel('서비스 이름')).toHaveValue(`${MARK}-steps`)
  await expect(s.getByLabel('플랜')).toHaveValue('플랜값')
  await s.getByRole('button', { name: '다음' }).click()
  await expect(s.getByLabel('금액', { exact: true })).toHaveValue('99,999,999,999')
  await expect(s.getByLabel('다음 결제일')).toHaveValue('2031-01-15')
  await s.getByRole('button', { name: '취소', exact: true }).click()
  await expect(s).toBeHidden()
})

test('(A-9) browser Back after #subs?add leaves the page and the editor with it; Forward does not reopen it', async ({ page }) => {
  await page.goto('/#home')
  await page.getByRole('tab', { name: '이번 달' }).waitFor()
  await page.evaluate(() => { location.hash = '#subs?add' })
  await expect(sheet(page, '구독 추가')).toBeVisible()
  await expect(page).toHaveURL(/#subs$/)
  await page.goBack()
  await expect(page).toHaveURL(/#home$/)
  await expect(sheet(page, '구독 추가')).toHaveCount(0)
  await page.goForward()
  await expect(page).toHaveURL(/#subs$/)
  await page.getByRole('tablist').first().waitFor()
  await expect(sheet(page, '구독 추가')).toHaveCount(0)
})

test('(A-11) Escape closes every open help bubble (hover with focus elsewhere, two at once) and keeps the editor and the focus', async ({ page }) => {
  await go(page, 'subs', '목록')
  await page.getByRole('button', { name: '구독 추가' }).click()
  const s = sheet(page, '구독 추가')
  await s.getByLabel('서비스 이름').fill(`${MARK}-esc`)
  await s.getByRole('button', { name: '다음' }).click()
  await s.getByRole('button', { name: 'USD', exact: true }).click()
  const tips = s.getByRole('img', { name: /^도움말/ })
  const bub = (i: number) => tips.nth(i).getByRole('tooltip', { includeHidden: true })
  const amount = s.getByLabel('금액', { exact: true })
  // opened by the mouse while the focus is in another field
  await amount.focus()
  await tips.nth(1).hover()
  await expect(bub(1)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(bub(1)).toBeHidden()
  await expect(s).toBeVisible()
  await expect(amount).toBeFocused()
  // two at once: focus on one, mouse on another
  await tips.nth(0).focus()
  await tips.nth(2).hover()
  await expect(bub(0)).toBeVisible()
  await expect(bub(2)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(bub(0)).toBeHidden()
  await expect(bub(2)).toBeHidden()
  await expect(s).toBeVisible()
  await expect(tips.nth(0)).toBeFocused()
  // none open: Escape cancels the editor as before
  await page.mouse.move(0, 0)
  await page.keyboard.press('Escape')
  await expect(s).toBeHidden()
})

test('(A-11) the list shows the next payment by the schedule the calendar uses: a monthly charge repeats back from its date', async ({ page, request }) => {
  const now = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  const anchor = new Date(now.getFullYear(), now.getMonth() + 1, 15) // one cycle ahead: the 15th of this month is charged too while it is not past
  const sub = (await api(request, 'POST', '/api/subscriptions', body(`${MARK}-cyc`, { nextDate: `${anchor.getFullYear()}-${p2(anchor.getMonth() + 1)}-15` }))).json as Sub
  const next = new Date(now.getFullYear(), now.getMonth() + (now.getDate() <= 15 ? 0 : 1), 15)
  await go(page, 'subs', '목록')
  await expect(page.getByRole('row', { name: new RegExp(sub.name) }).locator('td').nth(5)).toHaveText(`${next.getFullYear()}-${p2(next.getMonth() + 1)}-15`)
})

test('(A-13) a help bubble left open behind the delete confirmation does not take its Escape', async ({ page, request }) => {
  const sub = (await api(request, 'POST', '/api/subscriptions', body(`${MARK}-nest`))).json as Sub
  await go(page, 'subs', '목록')
  await page.getByRole('button', { name: `${sub.name} 수정` }).click()
  const s = sheet(page, '구독 수정')
  await s.getByRole('button', { name: '다음' }).click()
  const tip = s.getByRole('img', { name: /^도움말/ }).first()
  await tip.hover()
  await expect(tip.getByRole('tooltip', { includeHidden: true })).toBeVisible()
  // the mouse stays on the tip; the keyboard opens the confirmation
  await s.getByRole('button', { name: '삭제' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toHaveCount(0) // the first Escape cancels the confirmation
  await expect(s).toBeVisible()
  expect((await mine(request)).some((x) => x.id === sub.id)).toBe(true)
})

// W-10 review (A-36): the "그대로" option has the id '' and must stay selectable after an explicit value.
for (const [group, explicit, key, value] of [['통화', 'USD', 'currency', 'USD'], ['결제 주기', '연간', 'cycle', 'yearly'], ['상태', '해지', 'status', 'cancelled']] as const) {
  test(`(A-36) plan change ${group}: an explicit value, back to "그대로", saved: the field is not written; an existing explicit value goes back to "그대로" too`, async ({ page, request }) => {
    const sub = (await api(request, 'POST', '/api/subscriptions', body(`${MARK}-keep-${key}`))).json as Sub
    const find = async () => (await state(request)).planChanges.find((c) => c.subId === sub.id)
    await go(page, 'subs', '변경 일정')
    await page.getByRole('button', { name: '+ 전환 예약' }).click()
    const s = sheet(page, '플랜 전환 예약')
    await choose(s.getByLabel('대상 구독'), { label: sub.name })
    await s.getByRole('button', { name: '다음' }).click()
    const seg = s.getByRole('group', { name: group })
    await seg.getByRole('button', { name: explicit, exact: true }).click()
    await expect(seg.getByRole('button', { name: explicit, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await seg.getByRole('button', { name: '그대로' }).click()
    await expect(seg.getByRole('button', { name: '그대로' })).toHaveAttribute('aria-pressed', 'true')
    await expect(seg.getByRole('button', { name: explicit, exact: true })).toHaveAttribute('aria-pressed', 'false')
    await s.getByLabel('VAT (%)').fill('8')
    await saveSheet(page, '플랜 전환 예약')
    expect((await find())!.to).toEqual({ vat: 8 })
    // an existing change with the explicit value: set it back to "그대로"
    await page.getByRole('button', { name: `${sub.name} 전환 수정` }).click()
    const e = sheet(page, '플랜 전환 수정')
    await e.getByRole('button', { name: '다음' }).click()
    const eseg = e.getByRole('group', { name: group })
    await eseg.getByRole('button', { name: explicit, exact: true }).click()
    await saveSheet(page, '플랜 전환 수정')
    expect((await find())!.to).toEqual({ vat: 8, [key]: value })
    await page.getByRole('button', { name: `${sub.name} 전환 수정` }).click()
    const e2 = sheet(page, '플랜 전환 수정')
    await e2.getByRole('button', { name: '다음' }).click()
    await expect(e2.getByRole('group', { name: group }).getByRole('button', { name: explicit, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await e2.getByRole('group', { name: group }).getByRole('button', { name: '그대로' }).click()
    await saveSheet(page, '플랜 전환 수정')
    expect((await find())!.to).toEqual({ vat: 8 })
  })
}
