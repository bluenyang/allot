// spec 011 W-4 (V-6 shell and preservation part, V-7 phone width): the 지출 menu, its three tabs and addresses,
// the month's reflection card, and what the subscription editor of 0.1.4 accepted, saved and read back on
// the 구독 tab. Every spending or subscription made here carries the test mark and is removed by id in `finally`,
// then checked to be gone.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK as RUN, choose, fillDate, go, readDate, saveSheet, sheet } from './helpers'

const MARK = `${RUN}-sp`

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
type Sub = { id: string; name: string; amount: number; currency: string; vat: number; status: string; cycle: string; plan: string; note?: string }
type Change = { id: string; subId: string; effective: string | null; to: Record<string, unknown>; note: string }
type Spend = { id: string; name: string }
type State = { subscriptions: Sub[]; planChanges: Change[]; spendings: Spend[]; preferences: Record<string, unknown> }
const state = async (request: APIRequestContext) => (await api(request, 'GET', '/api/state')).json as State

/** This month in Korea (the page's own "today"). */
const thisYm = () => new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' }).slice(0, 7)

/** A one-off spending in this month: lump sum, one round, `left`. */
const lump = (name: string, amount: number, payBy: 'salary' | 'card' | 'subs') => ({
  name, note: '', category: '생활', bought: `${thisYm()}-05`, amount, currency: 'KRW', fxRate: null,
  how: 'lump', payBy, count: 1, fee: 0, interval: null, cancelled: false,
  rounds: [{ no: 1, date: `${thisYm()}-28`, amount, state: 'left', edited: false }],
})
/** Make spendings, run the check, always remove them by id and verify they are gone. */
async function withSpendings(request: APIRequestContext, bodies: ReturnType<typeof lump>[], run: (ids: string[]) => Promise<void>) {
  const ids: string[] = []
  try {
    for (const b of bodies) {
      const r = await api(request, 'POST', '/api/spendings', b)
      expect(r.status, `POST spending ${b.name}`).toBe(201)
      ids.push((r.json as Spend).id)
    }
    await run(ids)
  } finally {
    for (const id of ids) await api(request, 'DELETE', `/api/spendings/${id}`)
    const left = (await state(request)).spendings.filter((s) => ids.includes(s.id))
    expect(left, 'the test spendings are removed').toHaveLength(0)
  }
}
const digits = (s: string) => {
  const n = Number(s.replace(/[^\d]/g, ''))
  return /[−-]/.test(s.split('₩')[0] ?? '') ? -n : n
}
const card = (page: Page) => page.getByRole('region', { name: /지출 반영/ })
const col = (page: Page, i: number) => card(page).locator('.ms-g > div').nth(i)
const big = async (page: Page, i: number) => digits(await col(page, i).locator('b.num').first().innerText())

test('(S-1) the menu is 지출 with the receipt icon; three tabs with their own addresses; the title and breadcrumb follow the tab', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#home')
  const side = page.locator('aside.side')
  const link = side.getByRole('link', { name: '지출' })
  await expect(link).toBeVisible()
  await expect(side.getByRole('link', { name: '구독' })).toHaveCount(0)
  await expect(link.locator('svg path').first()).toHaveAttribute('d', /^M4 2v20l2-1 2 1/) // the canvas receipt
  await link.click()
  await expect(page).toHaveURL(/#spend$/) // the menu entry is #spend, which is 일반
  await expect(page.locator('header.ph h1')).toHaveText('지출')
  await expect(page.locator('nav.crumbs')).toContainText('예산/지출/일반')
  await expect(link).toHaveAttribute('aria-current', 'true')
  const tabs = page.getByRole('tablist', { name: '지출 종류' })
  await expect(tabs.getByRole('tab')).toHaveText([/^일반\s*\d+$/, /^할부\s*\d+$/, /^구독\s*\d+$/])
  await expect(tabs.getByRole('tab', { name: /^일반/ })).toHaveAttribute('aria-selected', 'true')
  // the add button follows the tab; 일반 and 할부 are drawn and inert until their editor comes (W-7)
  await expect(page.getByRole('button', { name: '지출 추가 (준비 중)' })).toHaveAttribute('aria-disabled', 'true')
  await tabs.getByRole('tab', { name: /^할부/ }).click()
  await expect(page).toHaveURL(/#spend\/inst$/)
  await expect(page.locator('nav.crumbs')).toContainText('예산/지출/할부')
  await expect(page.getByRole('button', { name: '할부 추가 (준비 중)' })).toHaveAttribute('aria-disabled', 'true')
  await tabs.getByRole('tab', { name: /^구독/ }).click()
  await expect(page).toHaveURL(/#spend\/subs$/)
  await expect(page.locator('nav.crumbs')).toContainText('예산/지출/구독')
  await expect(page.getByRole('button', { name: '구독 추가', exact: true })).toBeEnabled()
  // an unknown tab falls back to 일반; #spend alone is 일반
  await page.goto('/#spend')
  await expect(tabs.getByRole('tab', { name: /^일반/ })).toHaveAttribute('aria-selected', 'true')
  await page.goto('/#spend/nope')
  await expect(tabs.getByRole('tab', { name: /^일반/ })).toHaveAttribute('aria-selected', 'true')
})

test('(S-1) #subs is the 지출 page on the 구독 tab and stays #subs; #subs?add and #spend/subs?add open the add editor', async ({ page }) => {
  await page.goto('/#subs')
  const tabs = page.getByRole('tablist', { name: '지출 종류' })
  await expect(tabs.getByRole('tab', { name: /^구독/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/#subs$/)
  await expect(page.locator('header.ph h1')).toHaveText('지출')
  for (const [from, to] of [['#subs?add', /#subs$/], ['#spend/subs?add', /#spend\/subs$/]] as const) {
    await page.goto('/#home')
    await page.getByRole('tab', { name: '이번 달' }).waitFor()
    await page.evaluate((h) => { location.hash = h }, from)
    await expect(sheet(page, '구독 추가')).toBeVisible()
    await expect(page).toHaveURL(to)
    await page.getByRole('button', { name: '취소', exact: true }).click()
    await expect(sheet(page, '구독 추가')).toBeHidden()
  }
})

test('(S-1, V-6) the 구독 tab keeps the four views and the summary of the old page', async ({ page }) => {
  await go(page, 'subs')
  for (const name of ['목록', '전환 미리보기', '변경 일정', '이체액 계산']) await expect(page.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeVisible()
  await expect(page.getByLabel('구독 요약')).toBeVisible()
  await expect(page.getByRole('button', { name: 'CSV 내보내기 (준비 중)' })).toHaveCount(1)
})

test('(S-5) the reflection card: a salary-account one-off comes off the remainder; a subscription-account one-off adds to the transfer', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#spend/general')
  await expect(card(page)).toBeVisible()
  await expect(card(page).locator('#ms-t')).toHaveText(/^\d{4}\. \d{2} 지출 반영$/)
  await expect(card(page).locator('.tip')).toHaveAttribute('aria-label', /급여 통장이나 카드로 내는 돈은 그 달 나머지에서 빼고/)
  const out0 = await big(page, 0), add0 = await big(page, 1)
  const gen0 = digits(await col(page, 0).locator('.klg b').first().innerText())
  await withSpendings(request, [lump(`${MARK}-sal`, 12_340, 'salary'), lump(`${MARK}-card`, 4_560, 'card'), lump(`${MARK}-subs`, 500_000, 'subs')], async () => {
    await page.reload()
    await expect(card(page)).toBeVisible()
    expect(await big(page, 0), 'remainder line: salary + card lumps').toBe(out0 + 12_340 + 4_560)
    expect(digits(await col(page, 0).locator('.klg b').first().innerText()), 'the 일반 share').toBe(gen0 + 12_340 + 4_560)
    expect(await big(page, 1), 'transfer line: the subscription-account lump').toBe(add0 + 500_000)
    const t = (await col(page, 1).locator('small.hint b.num').innerText()).split('→').map((x) => digits(x))
    expect(t).toHaveLength(2)
    expect(t[1]! - t[0]!, 'before → after moves by the amount, up to the rounding unit').toBeGreaterThanOrEqual(400_000)
    expect(t[1]! - t[0]!).toBeLessThanOrEqual(600_000)
    await expect(col(page, 1)).toContainText(`${MARK}-subs 1건`)
    // the same on the other tabs: the card is above all three
    for (const tab of ['inst', 'subs']) { await page.goto(`/#spend/${tab}`); await expect(card(page)).toBeVisible() }
  })
})

test('(S-5) a negative remainder says 모자라요, keeps other amounts, and links to the pay split', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await withSpendings(request, [lump(`${MARK}-over`, 900_000_000, 'salary')], async () => {
    await page.goto('/#spend/general')
    const rem = col(page, 2)
    await expect(rem.locator('b.num')).toContainText('−₩')
    await expect(rem.getByText('모자라요')).toBeVisible()
    await expect(rem).toContainText('다른 금액은 자동으로 바꾸지 않아요')
    const link = rem.getByRole('link', { name: '월급 분배에서 조정 →' })
    await expect(link).toHaveAttribute('href', '#pay')
    await link.click()
    await expect(page).toHaveURL(/#pay$/)
  })
  // gone again (after a reload: the page's data is the server's): no shortage on the card
  await page.goto('/#spend/general')
  await page.reload()
  await expect(col(page, 2).getByText('모자라요')).toHaveCount(0)
})

test('(V-7) no sideways scroll at 390px on the three tabs, with a spending and its long name', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await withSpendings(request, [lump(`${MARK}-long-${'가나다라마바사'.repeat(6)}`, 700_000, 'subs')], async () => {
    for (const tab of ['general', 'inst', 'subs']) {
      await page.goto(`/#spend/${tab}`)
      await expect(card(page)).toBeVisible()
      const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
      expect(w.s, `${tab}: scrollWidth ${w.s} > clientWidth ${w.c}`).toBeLessThanOrEqual(w.c)
    }
    // the phone's bottom bar: 더보기 has the 지출 tile, which opens the 구독 tab
    await page.goto('/#home')
    await page.getByRole('navigation', { name: '메뉴' }).last().getByRole('button', { name: '더보기' }).click()
    await page.getByRole('dialog', { name: '더보기' }).getByRole('link', { name: '지출' }).click()
    await expect(page).toHaveURL(/#spend\/subs$/)
    await expect(page.locator('header.ph h1')).toHaveText('지출')
  })
})

test('(S-10) the page in English: title, tabs, the card and the add button', async ({ page, request }) => {
  const prefs = (await state(request)).preferences
  expect((await api(request, 'PUT', '/api/preferences', { ...prefs, language: 'en' })).status).toBe(200)
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#spend/general')
    await expect(page.locator('header.ph h1')).toHaveText('Spending')
    await expect(page.locator('aside.side').getByRole('link', { name: 'Spending' })).toBeVisible()
    await expect(page.locator('nav.crumbs')).toContainText('Budget/Spending/One-off')
    const tabs = page.getByRole('tablist', { name: 'Kinds of spending' })
    await expect(tabs.getByRole('tab')).toHaveText([/^One-off\s*\d+$/, /^Installments\s*\d+$/, /^Subscriptions\s*\d+$/])
    await expect(page.getByRole('region', { name: /^Spending in \d{4}\. \d{2}$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Add spending/ })).toHaveAttribute('aria-disabled', 'true')
    await tabs.getByRole('tab', { name: /^Subscriptions/ }).click()
    await expect(page.getByRole('button', { name: 'Add subscription' })).toBeEnabled()
  } finally {
    await api(request, 'PUT', '/api/preferences', prefs)
  }
})

// What the 0.1.4 subscription editor accepted and stored, saved again through the 구독 tab and read back
// from the server and from the editor: USD with VAT, yearly, a memo; 회사 지원; 해지; a plan change with no date.
test.describe('(V-6 preservation) the 구독 tab saves what the 0.1.4 editor saved', () => {
  test.afterEach(async ({ request }) => {
    const s = await state(request)
    for (const c of s.planChanges.filter((x) => s.subscriptions.some((u) => u.id === x.subId && u.name.startsWith(MARK)))) await api(request, 'DELETE', `/api/plan-changes/${c.id}`)
    for (const u of s.subscriptions.filter((x) => x.name.startsWith(MARK))) await api(request, 'DELETE', `/api/subscriptions/${u.id}`)
    const after = await state(request)
    expect(after.subscriptions.filter((x) => x.name.startsWith(MARK)), 'the test subscriptions are removed').toHaveLength(0)
    expect(after.planChanges.filter((x) => !after.subscriptions.some((u) => u.id === x.subId)), 'no orphan plan change').toHaveLength(0)
  })

  async function addSub(page: Page, name: string, step2: (s: ReturnType<typeof sheet>) => Promise<void>, step1?: (s: ReturnType<typeof sheet>) => Promise<void>) {
    await page.getByRole('button', { name: '구독 추가' }).click()
    const s = sheet(page, '구독 추가')
    await s.getByLabel('서비스 이름').fill(name)
    await step1?.(s)
    await s.getByRole('button', { name: '다음' }).click()
    await step2(s)
    await fillDate(s.getByRole('group', { name: '다음 결제일' }), '2031-01-15')
    await saveSheet(page, '구독 추가')
  }
  const mine = async (request: APIRequestContext) => Object.fromEntries((await state(request)).subscriptions.filter((x) => x.name.startsWith(MARK)).map((x) => [x.name.replace(`${MARK}-`, ''), x]))

  test('USD + VAT, yearly, a memo; 회사 지원; 해지; read back from the server and from the editor', async ({ page, request }) => {
    await go(page, 'subs', '목록')
    await addSub(page, `${MARK}-usd`, async (s) => {
      await s.getByRole('button', { name: 'USD', exact: true }).click()
      await s.getByLabel('금액', { exact: true }).fill('12.5')
      await s.getByLabel('VAT (%)').fill('10.5')
      await s.getByRole('group', { name: '결제 주기' }).getByRole('button', { name: '연간' }).click()
      await s.getByRole('button', { name: '+ 메모 추가' }).click()
      await s.getByLabel('메모').fill('연간 메모')
    })
    await addSub(page, `${MARK}-co`, async (s) => { await s.getByLabel('금액', { exact: true }).fill('9,900') }, async (s) => { await s.getByRole('button', { name: '회사 지원', exact: true }).click() })
    await addSub(page, `${MARK}-off`, async (s) => { await s.getByLabel('금액', { exact: true }).fill('5000') }, async (s) => { await s.getByRole('button', { name: '해지', exact: true }).click() })
    const got = await mine(request)
    expect(got.usd).toMatchObject({ amount: 12.5, currency: 'USD', vat: 10.5, cycle: 'yearly', note: '연간 메모' })
    expect(got.co).toMatchObject({ amount: 9900, currency: 'KRW', status: 'company' })
    expect(got.off).toMatchObject({ amount: 5000, status: 'cancelled' })
    // the list on the 구독 tab shows all three, and the editor shows what was saved
    await page.reload()
    await go(page, 'subs', '목록')
    await page.getByRole('button', { name: `${MARK}-usd 수정` }).click()
    const e = sheet(page, '구독 수정')
    await e.getByRole('button', { name: '다음' }).click()
    await expect(e.getByLabel('금액', { exact: true })).toHaveValue('12.5')
    await expect(e.getByLabel('VAT (%)')).toHaveValue('10.5')
    await expect(e.getByRole('group', { name: '결제 주기' }).getByRole('button', { name: '연간' })).toHaveAttribute('aria-pressed', 'true')
    await expect(e.getByLabel('메모')).toHaveValue('연간 메모')
    expect(await readDate(e.getByRole('group', { name: '다음 결제일' }))).toBe('2031-01-15')
    await e.getByRole('button', { name: '취소', exact: true }).click()
    await expect(e).toBeHidden()
  })

  test('an undated plan change is saved and reads back as 날짜 미정', async ({ page, request }) => {
    const sub = (await api(request, 'POST', '/api/subscriptions', {
      name: `${MARK}-chg`, category: 'tool', plan: 'p', amount: 1000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false,
    })).json as Sub
    await go(page, 'subs', '변경 일정')
    await page.getByRole('button', { name: '+ 전환 예약' }).click()
    const s = sheet(page, '플랜 전환 예약')
    await choose(s.getByLabel('대상 구독'), { label: sub.name })
    await s.getByLabel('날짜 미정').check()
    await s.getByRole('button', { name: '다음' }).click()
    await s.getByLabel('새 금액').fill('2000')
    await saveSheet(page, '플랜 전환 예약')
    const made = (await state(request)).planChanges.filter((c) => c.subId === sub.id)
    expect(made).toHaveLength(1)
    expect(made[0]!.effective).toBeNull()
    expect(made[0]!.to).toEqual({ amount: 2000 })
    await page.reload()
    await go(page, 'subs', '변경 일정')
    await expect(page.getByRole('listitem').filter({ hasText: sub.name }).getByText('미반영')).toBeVisible()
  })
})
