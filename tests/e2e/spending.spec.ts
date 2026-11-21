// spec 011 W-4 and W-5 (V-6 shell and preservation part, the 일반 tab, V-7 phone width): the 지출 menu, its three tabs and addresses,
// the month's reflection card, and what the subscription editor of 0.1.4 accepted, saved and read back on
// the 구독 tab. Every spending or subscription made here carries the test mark and is removed by id in `finally`,
// then checked to be gone.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK as RUN, choose, fillDate, go, optionTexts, readDate, saveSheet, sheet } from './helpers'

const MARK = `${RUN}-sp`

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
type Sub = { id: string; name: string; amount: number; currency: string; vat: number; status: string; cycle: string; plan: string; note?: string }
type Change = { id: string; subId: string; effective: string | null; to: Record<string, unknown>; note: string }
type Spend = { id: string; name: string }
type State = { subscriptions: Sub[]; planChanges: Change[]; spendings: Spend[]; preferences: Record<string, unknown>; settings: { billingDay: number } }
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

test('(S-5) a negative remainder says 모자라요, keeps other amounts, and links to the pay split; without the spending the month is as before', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#spend/general')
  await expect(card(page)).toBeVisible()
  const rem0 = await big(page, 2) // the month without our spending (it may already be short on a used test account)
  await withSpendings(request, [lump(`${MARK}-over`, 900_000_000, 'salary')], async () => {
    await page.reload()
    const rem = col(page, 2)
    await expect(rem.locator('b.num')).toContainText('−₩')
    expect(await big(page, 2)).toBe(rem0 - 900_000_000)
    await expect(rem.getByText('모자라요')).toBeVisible()
    await expect(rem).toContainText('다른 금액은 자동으로 바꾸지 않아요')
    const link = rem.getByRole('link', { name: '월급 분배에서 조정 →' })
    await expect(link).toHaveAttribute('href', '#pay')
    await link.click()
    await expect(page).toHaveURL(/#pay$/)
  })
  // gone again (after a reload: the page's data is the server's): the remainder is what it was
  await page.goto('/#spend/general')
  await page.reload()
  expect(await big(page, 2)).toBe(rem0)
})

test('(S-5) two subscription-account spendings with the same name count as two items', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await withSpendings(request, [lump(`${MARK}-dup`, 11_000, 'subs'), lump(`${MARK}-dup`, 22_000, 'subs')], async () => {
    await page.goto('/#spend/general')
    await page.reload()
    await expect(col(page, 1)).toContainText(`${MARK}-dup 외 1건`)
  })
})

// ---------- the 일반 tab (W-5, S-6, S-7) ----------
const kstDay = (plus = 0) => {
  const d = new Date(`${new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' }).slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + plus)
  return d.toISOString().slice(0, 10)
}
interface G { key: string; cat: string; bought: string; amount: number; currency?: 'KRW' | 'USD'; payBy: 'card' | 'salary' | 'subs'; date: string; krw: number; state?: 'left' | 'paid'; cancelled?: boolean; note?: string; suffix?: string }
const gBody = (name: string, g: G) => ({
  name, note: g.note ?? '', category: g.cat, bought: g.bought, amount: g.amount, currency: g.currency ?? 'KRW', fxRate: g.currency === 'USD' ? 1380 : null,
  how: 'lump', payBy: g.payBy, count: 1, fee: 0, interval: null, cancelled: g.cancelled ?? false,
  rounds: [{ no: 1, date: g.date, amount: g.krw, state: g.state ?? 'left', edited: false }],
})
const mdOf = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const monthOf = (d: string) => `${Number(d.slice(5, 7))}월`
const GCAT = `${MARK}-cat`
/** Five lump spendings: a card billed later (bought before today), a card bought after today, a paid salary one, a subscription-account USD one, a cancelled one. */
const gSet = (): Record<string, G> => ({
  bill: { key: 'bill', cat: GCAT, bought: kstDay(-3), amount: 159_000, payBy: 'card', date: kstDay(20), krw: 159_000, note: 'bill-note', suffix: `-${'가나다라마바사'.repeat(6)}` },
  plan: { key: 'plan', cat: '생활', bought: kstDay(3), amount: 248_000, payBy: 'card', date: kstDay(30), krw: 248_000 },
  paid: { key: 'paid', cat: '경조사', bought: kstDay(-1), amount: 100_000, payBy: 'salary', date: kstDay(-1), krw: 100_000, state: 'paid' },
  usd: { key: 'usd', cat: '도구', bought: kstDay(0), amount: 49.5, currency: 'USD', payBy: 'subs', date: kstDay(0), krw: 70_000 },
  off: { key: 'off', cat: '여가', bought: kstDay(-10), amount: 132_000, payBy: 'salary', date: kstDay(-10), krw: 132_000, cancelled: true },
})
const gRow = (page: Page, name: string) => page.locator('table.gen-t tbody tr', { hasText: name })
const gCards = (page: Page) => page.locator('.kcard')
const readK = async (page: Page) => ({
  k1: digits(await gCards(page).nth(0).locator('.k2 b').innerText()),
  k1n: digits(await gCards(page).nth(0).locator('.k1 .hint').innerText()),
  k2: digits(await gCards(page).nth(1).locator('.k2 b').innerText()),
  k2n: digits(await gCards(page).nth(1).locator('.k1 .hint').innerText()),
  k3: digits(await gCards(page).nth(2).locator('.k2 b').innerText()),
  k3n: digits(await gCards(page).nth(2).locator('.k1 .hint').innerText()),
})
const segCounts = async (page: Page, labels: string[]) => Promise.all(labels.map(async (l) => digits(await page.getByRole('group', { name: '상태로 거르기' }).getByRole('button', { name: new RegExp(`^${l}`) }).innerText())))

test('(S-6, S-7) the 일반 tab: rows, states, 반영 text, filters, counts and the three cards come from the saved spendings', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const set = gSet()
  const names = Object.fromEntries(Object.values(set).map((g) => [g.key, `${MARK}-g${g.key}${g.suffix ?? ''}`]))
  const bodies = Object.values(set).map((g) => gBody(names[g.key]!, g))
  const ym = thisYm()
  await page.goto('/#spend/general')
  await expect(gCards(page)).toHaveCount(3)
  const k0 = await readK(page)
  const labels = ['전체', '예정', '냄', '취소']
  const c0 = await segCounts(page, labels)
  const billingDay = (await state(request)).settings.billingDay
  await withSpendings(request, bodies as unknown as ReturnType<typeof lump>[], async () => {
    await page.reload()
    await expect(gCards(page)).toHaveCount(3)
    // sorted by payment date; the rows carry their state, their month and the reason, their amounts
    const order = await page.locator('table.gen-t tbody tr').evaluateAll((trs, m) => trs.map((t) => t.querySelector('b.nm')?.textContent ?? '').filter((x) => x.startsWith(m)), `${MARK}-g`)
    expect(order, 'by payment date').toEqual(['off', 'bill', 'paid', 'usd', 'plan'].map((k) => names[k]))
    const cells = async (k: string) => (await gRow(page, names[k]!).locator('td').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
    const bill = await cells('bill')
    expect(bill[0]).toContain('bill-note')
    expect(bill[1]).toBe(GCAT)
    expect(bill[3]).toBe('KRW 159,000')
    expect(digits(bill[4]!)).toBe(159_000)
    expect(bill[5]).toBe('카드 · 일시불')
    expect(bill[6]).toContain(monthOf(set.bill!.date))
    expect(bill[6]).toContain(`${mdOf(set.bill!.date)} 청구 · 나머지에서`)
    expect(bill[7]).toBe('청구 예정')
    expect((await cells('plan'))[7], 'a card bought after today is only planned').toBe('예정')
    expect((await cells('plan'))[6]).toContain(`${mdOf(set.plan!.date)} 청구 · 나머지에서`)
    const paid = await cells('paid')
    expect(paid[5]).toBe('급여 통장')
    expect(paid[6]).toContain(monthOf(set.paid!.date))
    expect(paid[6]).toContain('나머지에서')
    expect(paid[7]).toBe('냄')
    const usd = await cells('usd')
    expect(usd[3]).toBe('USD 49.50')
    expect(digits(usd[4]!)).toBe(70_000)
    expect(usd[5]).toBe('구독 통장')
    expect(usd[6]).toContain('구독 이체에')
    expect(usd[7]).toBe('예정')
    const off = await cells('off')
    expect(off[6]).toContain('반영 안 함')
    expect(off[6]).toMatch(/—/)
    expect(off[7]).toBe('취소')
    // the filters: counts move by what was added; a pick shows only its rows
    const c1 = await segCounts(page, labels)
    expect(c1.map((n, i) => n - c0[i]!), '전체 · 예정 · 냄 · 취소').toEqual([5, 3, 1, 1])
    const seg = page.getByRole('group', { name: '상태로 거르기' })
    const mine = (k: string) => gRow(page, names[k]!)
    await seg.getByRole('button', { name: /^예정/ }).click()
    await expect(mine('bill')).toBeVisible(); await expect(mine('plan')).toBeVisible(); await expect(mine('usd')).toBeVisible()
    await expect(mine('paid')).toHaveCount(0); await expect(mine('off')).toHaveCount(0)
    await seg.getByRole('button', { name: /^냄/ }).click()
    await expect(mine('paid')).toBeVisible(); await expect(mine('bill')).toHaveCount(0)
    await seg.getByRole('button', { name: /^취소/ }).click()
    await expect(mine('off')).toBeVisible(); await expect(mine('paid')).toHaveCount(0)
    await seg.getByRole('button', { name: /^전체/ }).click()
    await choose(page.getByLabel('결제 수단', { exact: true }), { label: '구독 통장' })
    await expect(mine('usd')).toBeVisible(); await expect(mine('bill')).toHaveCount(0); await expect(mine('paid')).toHaveCount(0)
    await choose(page.getByLabel('결제 수단', { exact: true }), { label: '카드' })
    await expect(mine('bill')).toBeVisible(); await expect(mine('plan')).toBeVisible(); await expect(mine('usd')).toHaveCount(0)
    await choose(page.getByLabel('결제 수단', { exact: true }), { label: '결제 수단 전체' })
    // the category list holds the categories that occur; one pick leaves that category's rows, and the count line follows
    expect(await optionTexts(page.getByLabel('분류', { exact: true }))).toEqual(expect.arrayContaining(['분류 전체', GCAT, '경조사', '도구', '여가']))
    await choose(page.getByLabel('분류', { exact: true }), { label: GCAT })
    await expect(mine('bill')).toBeVisible(); await expect(mine('plan')).toHaveCount(0)
    await expect(page.getByText(/^1건 · 결제일 순$/)).toBeVisible()
    // nothing left for the pick: the empty state of the canvas
    await seg.getByRole('button', { name: /^취소/ }).click()
    await expect(page.getByText('이 상태의 지출이 없어요')).toBeVisible()
    await expect(page.getByText(/^0건 · 결제일 순$/)).toBeVisible()
    await seg.getByRole('button', { name: /^전체/ }).click()
    await choose(page.getByLabel('분류', { exact: true }), { label: '분류 전체' })
    // the cards: each moves by what the saved spendings put on it (the month of the round decides)
    const k1 = await readK(page)
    const inMonth = Object.values(set).filter((g) => !g.cancelled && g.date.slice(0, 7) === ym)
    const later = Object.values(set).filter((g) => !g.cancelled && g.state !== 'paid' && g.date.slice(0, 7) > ym)
    const sum = (l: G[]) => l.reduce((a, g) => a + g.krw, 0)
    expect(k1.k1 - k0.k1, 'this month').toBe(sum(inMonth))
    expect(k1.k1n - k0.k1n).toBe(inMonth.length)
    expect(k1.k2 - k0.k2, 'upcoming: not paid, a later month').toBe(sum(later))
    expect(k1.k2n - k0.k2n).toBe(later.length)
    expect(k1.k3 - k0.k3, 'by method: all but the cancelled').toBe(sum(Object.values(set).filter((g) => !g.cancelled)))
    expect(k1.k3n - k0.k3n).toBe(4)
    await expect(gCards(page).nth(2)).toContainText('취소 제외')
    await expect(gCards(page).nth(2).locator('.klg')).toContainText('카드')
    // the edit button is inert until the editor (W-7)
    await expect(page.getByRole('button', { name: `${names.bill} 수정 (준비 중)` })).toHaveAttribute('aria-disabled', 'true')
    // the note under the list names the billing day and links to the 할부 tab
    await expect(page.locator('.foot')).toContainText(`카드는 청구일(매달 ${billingDay}일)이 속한 달이에요`)
    await page.locator('.foot').getByRole('link', { name: '할부' }).click()
    await expect(page).toHaveURL(/#spend\/inst$/)
  })
  await page.goto('/#spend/general')
  await page.reload()
  expect(await readK(page), 'the cards are what they were').toEqual(k0)
})

test('(S-7, V-7) the 일반 tab on the phone: a card list, the three cards stacked, no sideways scroll', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const set = gSet()
  const names = Object.fromEntries(Object.values(set).map((g) => [g.key, `${MARK}-g${g.key}${g.suffix ?? ''}`]))
  await withSpendings(request, Object.values(set).map((g) => gBody(names[g.key]!, g)) as unknown as ReturnType<typeof lump>[], async () => {
    await page.goto('/#spend/general')
    await expect(gCards(page)).toHaveCount(3)
    await expect(page.locator('table.gen-t')).toBeHidden()
    const li = page.locator('.mlist .mcard', { hasText: names.bill })
    await expect(li).toBeVisible()
    await expect(li).toContainText('청구 예정')
    await expect(li).toContainText('카드 · 일시불')
    await expect(li).toContainText('KRW 159,000')
    await expect(page.locator('.mlist .mcard', { hasText: names.off })).toContainText('취소')
    const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
    expect(w.s, `scrollWidth ${w.s} > clientWidth ${w.c}`).toBeLessThanOrEqual(w.c)
    const boxes = await gCards(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.right)]))
    expect(new Set(boxes.map((b) => b[0])).size, 'one column').toBe(1)
  })
})

test('(S-10) the 일반 tab in English: filters, columns, states, the reason and the note', async ({ page, request }) => {
  const prefs = (await state(request)).preferences
  expect((await api(request, 'PUT', '/api/preferences', { ...prefs, language: 'en' })).status).toBe(200)
  const set = gSet()
  const names = Object.fromEntries(Object.values(set).map((g) => [g.key, `${MARK}-g${g.key}${g.suffix ?? ''}`]))
  try {
    await withSpendings(request, [set.bill!, set.off!].map((g) => gBody(names[g.key]!, g)) as unknown as ReturnType<typeof lump>[], async () => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/#spend/general')
      const seg = page.getByRole('group', { name: 'Filter by status' })
      await expect(seg.getByRole('button')).toHaveText([/^All\s*\d+$/, /^Planned\s*\d+$/, /^Paid\s*\d+$/, /^Cancelled\s*\d+$/])
      await expect(page.locator('table.gen-t thead th')).toHaveText(['Item', 'Category', 'Paid on', 'Amount', 'In KRW', 'Payment method', 'Counted', 'Status', 'Edit'])
      const bill = gRow(page, names.bill!)
      await expect(bill).toContainText('Billing due')
      await expect(bill).toContainText('Card · lump sum')
      await expect(bill).toContainText(`Billed ${mdOf(set.bill!.date)} · from remainder`)
      await expect(gRow(page, names.off!)).toContainText('Not counted')
      await expect(page.getByText(/^\d+ items · by payment date$/)).toBeVisible()
      await expect(page.locator('.foot')).toContainText('of each month')
      await expect(page.locator('.foot').getByRole('link', { name: 'Installments' })).toBeVisible()
    })
  } finally {
    await api(request, 'PUT', '/api/preferences', prefs)
  }
})

test('(review 3) the 구독 tab keeps its view and filter across a tab switch and Back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#spend/subs')
  await page.getByRole('tablist').first().waitFor()
  await page.getByRole('tab', { name: /^목록/ }).click()
  await page.getByRole('button', { name: /^전체/ }).click()
  await page.getByRole('tab', { name: /^변경 일정/ }).click()
  await page.getByRole('tablist', { name: '지출 종류' }).getByRole('tab', { name: /^일반/ }).click()
  await expect(page).toHaveURL(/#spend\/general$/)
  await page.goBack()
  await expect(page).toHaveURL(/#spend\/subs$/)
  await expect(page.getByRole('tab', { name: /^변경 일정/ })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: /^목록/ }).click()
  await expect(page.getByRole('button', { name: /^전체/ })).toHaveAttribute('aria-pressed', 'true')
})

// review 4: an editor opened on the 구독 tab closes when the tab is left (Back), and the tab's view and filter are kept.
for (const [what, view, open, title] of [
  ['subscription editor', '목록', '구독 추가', '구독 추가'],
  ['plan-change editor', '변경 일정', '+ 전환 예약', '플랜 전환 예약'],
] as const) {
  test(`(review 4) the ${what} closes when the 구독 tab is left with Back; the view and filter are kept`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/#spend/general')
    await page.getByRole('tablist').first().waitFor()
    await page.getByRole('tablist', { name: '지출 종류' }).getByRole('tab', { name: /^구독/ }).click()
    await page.getByRole('tab', { name: /^목록/ }).click()
    await page.getByRole('button', { name: /^전체/ }).click()
    await page.getByRole('tab', { name: new RegExp(`^${view}`) }).click()
    await page.getByRole('button', { name: open, exact: true }).click()
    await expect(sheet(page, title)).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/#spend\/general$/)
    await expect(sheet(page, title)).toBeHidden()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), 'focus is not left in a dialog').toBe(false)
    await page.getByRole('tablist', { name: '지출 종류' }).getByRole('tab', { name: /^구독/ }).click()
    await expect(page.getByRole('tab', { name: new RegExp(`^${view}`) })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: /^목록/ }).click()
    await expect(page.getByRole('button', { name: /^전체/ })).toHaveAttribute('aria-pressed', 'true')
  })
}

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
