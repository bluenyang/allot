// spec 011 W-4 to W-6 (V-6 shell and preservation part, the 일반 and 할부 tabs, V-7 phone width): the 지출 menu, its three tabs and addresses,
// the month's reflection card, and what the subscription editor of 0.1.4 accepted, saved and read back on
// the 구독 tab. Every spending or subscription made here carries the test mark and is removed by id in `finally`,
// then checked to be gone.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK as RUN, choose, deleteInSheet, fillDate, go, optionTexts, readDate, saveSheet, sheet } from './helpers'

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
  name, note: '', category: '생활', bought: `${thisYm()}-05`, amount, currency: 'KRW', fxRate: null, fxBuffer: null,
  how: 'lump', payBy, count: 1, fee: 0, interval: null, cancelled: false,
  rounds: [{ no: 1, date: `${thisYm()}-28`, amount, state: 'left', edited: false }],
})
/** Make spendings, run the check, always remove them by id and verify they are gone. */
async function withSpendings(request: APIRequestContext, bodies: { name: string }[], run: (ids: string[]) => Promise<void>) {
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
  // the add button follows the tab and opens its editor (W-7)
  await expect(page.getByRole('button', { name: '지출 추가', exact: true })).toBeEnabled()
  await tabs.getByRole('tab', { name: /^할부/ }).click()
  await expect(page).toHaveURL(/#spend\/inst$/)
  await expect(page.locator('nav.crumbs')).toContainText('예산/지출/할부')
  await expect(page.getByRole('button', { name: '할부 추가', exact: true })).toBeEnabled()
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
  name, note: g.note ?? '', category: g.cat, bought: g.bought, amount: g.amount, currency: g.currency ?? 'KRW', fxRate: g.currency === 'USD' ? 1380 : null, fxBuffer: g.currency === 'USD' ? 3 : null,
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
    // the edit button opens the editor (W-7)
    await expect(page.getByRole('button', { name: `${names.bill} 수정` })).toBeEnabled()
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
    await expect(page.getByRole('button', { name: 'Add spending', exact: true })).toBeEnabled()
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

// ---------- W-6: the 할부 tab ----------
const ymAdd = (ym: string, n: number) => { const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)); return d.toISOString().slice(0, 7) }
const todayKst = () => new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' }).slice(0, 10)
type R = { no: number; date: string; amount: number; state: 'left' | 'paid' | 'merged'; edited: boolean }
type Inst = {
  id: string; name: string; cancelled: boolean; rounds: R[]
}
const rounds = (start: string, day: number, amounts: number[], paid = 0): R[] => amounts.map((amount, i) => ({ no: i + 1, date: `${ymAdd(start, i)}-${String(day).padStart(2, '0')}`, amount, state: i < paid ? 'paid' : 'left', edited: false }))
const instBody = (name: string, o: { how: 'installment' | 'split'; payBy: 'card' | 'salary'; amount: number; fee?: number; count: number; rounds: R[]; interval?: 'monthly' }) => ({
  name, note: '', category: '가전', bought: `${thisYm()}-05`, amount: o.amount, currency: 'KRW', fxRate: null, fxBuffer: null, how: o.how, payBy: o.payBy, count: o.count,
  fee: o.fee ?? 0, interval: o.how === 'split' ? (o.interval ?? 'monthly') : null, cancelled: false, rounds: o.rounds,
})
const instRows = (page: Page) => page.locator('.rt tbody tr')
const kv = (page: Page, name: string) => page.locator('.id-s > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${name}$`) }) })
const listItem = (page: Page, name: string) => page.getByRole('list', { name: '할부 목록' }).getByRole('button', { name: new RegExp(name) })
const seg = (page: Page) => page.getByRole('group', { name: '상태로 거르기' })
const segCount = async (page: Page, name: string) => Number((await seg(page).getByRole('button', { name: new RegExp(`^${name}`) }).locator('.c').innerText()).trim())
const kcard = (page: Page, i: number) => page.locator('.inst .kcard').nth(i)
const kval = async (page: Page, i: number) => digits(await kcard(page, i).locator('.k2 b').innerText())

test('(S-4, S-6, S-7, V-6) the 할부 tab: list, filters, detail numbers, rounds table, KPIs; a round edited, marked paid, an early payoff, a cancel and turning it back on', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const ym = thisYm()
  const nA = `${MARK}-ac`, nB = `${MARK}-nb`, nC = `${MARK}-dt`, nD = `${MARK}-tb`
  await page.goto('/#spend/inst')
  await expect(card(page)).toBeVisible()
  await expect(seg(page)).toBeVisible()
  const base = { on: await segCount(page, '진행 중'), done: await segCount(page, '완료'), all: await segCount(page, '전체') }
  const out0 = await big(page, 0)
  const k = [await kval(page, 0), await kval(page, 1), await kval(page, 2)]
  const bodies = [
    // A: card, 6 months with a fee: 1,290,000 + 35,000 → 220,830 × 5, last 220,850; the first round is this month
    instBody(nA, { how: 'installment', payBy: 'card', amount: 1_290_000, fee: 35_000, count: 6, rounds: rounds(ym, 28, [220_830, 220_830, 220_830, 220_830, 220_830, 220_850]) }),
    // B: card, 12 months interest free, four rounds paid (the fourth is this month)
    instBody(nB, { how: 'installment', payBy: 'card', amount: 1_899_000, count: 12, rounds: rounds(ymAdd(ym, -3), 16, Array(12).fill(158_250), 4) }),
    // C: split in three, salary account, from next month
    instBody(nC, { how: 'split', payBy: 'salary', amount: 900_000, count: 3, rounds: rounds(ymAdd(ym, 1), 25, [300_000, 300_000, 300_000]) }),
    // D: all paid
    instBody(nD, { how: 'installment', payBy: 'card', amount: 549_000, count: 3, rounds: rounds(ymAdd(ym, -5), 16, [183_000, 183_000, 183_000], 3) }),
  ]
  await withSpendings(request, bodies, async (ids) => {
    await page.reload()
    await expect(seg(page)).toBeVisible()
    // the filter counts: three in progress, one done
    expect(await segCount(page, '진행 중')).toBe(base.on + 3)
    expect(await segCount(page, '완료')).toBe(base.done + 1)
    expect(await segCount(page, '전체')).toBe(base.all + 4)
    expect(await big(page, 0), 'the month card: A round 1 + B round 4').toBe(out0 + 220_830 + 158_250)
    // the three cards: left to pay, this month's rounds, fees
    expect(await kval(page, 0)).toBe(k[0]! + 1_325_000 + 1_266_000 + 900_000)
    expect(await kval(page, 1)).toBe(k[1]! + 220_830 + 158_250)
    expect(await kval(page, 2)).toBe(k[2]! + 35_000)
    await expect(kcard(page, 1).locator('.kbars span')).toHaveCount(6)
    await expect(page.getByRole('list', { name: '할부 목록' }).getByRole('button', { name: new RegExp(nD) })).toHaveCount(0) // done is not in 진행 중

    // B: interest free, four paid
    await listItem(page, nB).click()
    await expect(page.locator('.id-n h2')).toHaveText(nB)
    await expect(listItem(page, nB)).toContainText('4/12회 냄')
    await expect(listItem(page, nB)).toContainText('카드 할부 12개월 · 무이자')
    await expect(listItem(page, nB)).toContainText('매달 청구')
    expect(digits(await kv(page, '총액').locator('dd').innerText())).toBe(1_899_000)
    await expect(kv(page, '총액')).toContainText('무이자')
    expect(digits(await kv(page, '낸 금액').locator('dd').innerText())).toBe(633_000)
    await expect(kv(page, '낸 금액')).toContainText('4회')
    expect(digits(await kv(page, '남은 금액').locator('dd').innerText())).toBe(1_266_000)
    await expect(kv(page, '남은 금액')).toContainText('8회')
    await expect(instRows(page)).toHaveCount(12)
    await expect(instRows(page).locator('.pill', { hasText: /^냄$/ })).toHaveCount(4)
    await expect(instRows(page).locator('.pill', { hasText: /^다음$/ })).toHaveCount(1)
    await expect(instRows(page).locator('.pill', { hasText: /^남음$/ })).toHaveCount(7)

    // C: split
    await listItem(page, nC).click()
    await expect(listItem(page, nC)).toContainText('나눠 내기 3회')
    await expect(listItem(page, nC)).toContainText('회당')
    await expect(kv(page, '총액')).toContainText('나눠 내기 · 수수료 없음')
    expect(digits(await kv(page, '회당').locator('dd').innerText())).toBe(300_000)
    await expect(instRows(page)).toHaveCount(3)

    // A: the fee and the odd 20 won
    await listItem(page, nA).click()
    await expect(page.locator('.id-n h2')).toHaveText(nA)
    expect(digits(await kv(page, '총액').locator('dd').innerText())).toBe(1_325_000)
    await expect(kv(page, '총액')).toContainText('원금 ₩1,290,000 + 수수료 ₩35,000')
    expect(digits(await kv(page, '회당').locator('dd').innerText())).toBe(220_830)
    await expect(kv(page, '회당')).toContainText('마지막 회차 ₩220,850')
    await expect(instRows(page)).toHaveCount(6)
    expect(digits(await instRows(page).nth(5).locator('td').nth(2).innerText())).toBe(220_850)
    await expect(instRows(page).first().locator('.pill')).toHaveText('다음')
    await expect(page.locator('.pane .cfoot').first()).toBeVisible()
    await expect(page.getByText('수수료 ₩35,000을 6회에 나눠 더했어요.')).toBeVisible()
    await expect(page.getByText('끝전 ₩20은 마지막 회차가 받아요.')).toBeVisible()
    await expect(page.locator('.diff')).toHaveCount(0)
    // 수정 opens the whole-spending editor (W-7)
    await expect(page.getByRole('button', { name: `${nA} 수정` })).toBeEnabled()

    // edit round 1: 220,830 → 200,000 shows 고침 and the difference, and the month card moves
    await page.getByRole('button', { name: '1회차 수정' }).click()
    const e1 = sheet(page, `회차 수정 · ${nA} 1/6회`)
    await expect(e1).toBeVisible()
    await expect(e1.getByText('저장하면 변경 내역에 남아요.')).toBeVisible()
    await e1.getByLabel('금액 (₩)').fill('200000')
    await saveSheet(page, `회차 수정 · ${nA} 1/6회`)
    await expect(instRows(page).first()).toContainText('· 고침')
    await expect(instRows(page).nth(1)).not.toContainText('· 고침')
    await expect(page.locator('.diff')).toContainText('총액보다 ₩20,830 적어요')
    expect(await big(page, 0)).toBe(out0 + 200_000 + 158_250)
    const got1 = ((await state(request)).spendings as unknown as Inst[]).find((x) => x.id === ids[0])!
    expect(got1.rounds[0]).toMatchObject({ amount: 200_000, edited: true, state: 'left' })

    // mark round 2 paid: the state alone does not mark it edited
    await page.getByRole('button', { name: '2회차 수정' }).click()
    const e2 = sheet(page, `회차 수정 · ${nA} 2/6회`)
    await e2.getByRole('group', { name: /^상태/ }).getByRole('button', { name: '냄', exact: true }).click()
    await saveSheet(page, `회차 수정 · ${nA} 2/6회`)
    await expect(listItem(page, nA)).toContainText('1/6회 냄')
    await expect(instRows(page).nth(1).locator('.pill')).toHaveText('냄')
    await expect(instRows(page).nth(1)).not.toContainText('· 고침')
    const got2 = ((await state(request)).spendings as unknown as Inst[]).find((x) => x.id === ids[0])!
    expect(got2.rounds[1]).toMatchObject({ amount: 220_830, edited: false, state: 'paid' })
    expect(digits(await kv(page, '낸 금액').locator('dd').innerText())).toBe(220_830)

    // early payoff: the date is today, the amount the sum left; lower it; five rounds merge and one is added
    await page.getByRole('button', { name: '중도 완납', exact: true }).click()
    const po = sheet(page, `중도 완납 · ${nA}`)
    await expect(po).toBeVisible()
    expect(await readDate(po.getByRole('group', { name: '완납일' }))).toBe(todayKst())
    await expect(po.getByLabel('완납 금액 (₩)')).toHaveValue('1,083,340')
    await po.getByLabel('완납 금액 (₩)').fill('1000000')
    await saveSheet(page, `중도 완납 · ${nA}`, '완납하기')
    await expect(instRows(page)).toHaveCount(7)
    await expect(instRows(page).locator('.pill', { hasText: '중도 완납으로 합침' })).toHaveCount(5)
    await expect(instRows(page).last()).toContainText('중도 완납')
    expect(digits(await instRows(page).last().locator('td').nth(2).innerText())).toBe(1_000_000)
    await expect(page.locator('.diff')).toContainText('총액보다 ₩104,170 적어요')
    const got3 = ((await state(request)).spendings as unknown as Inst[]).find((x) => x.id === ids[0])!
    expect(got3.rounds.map((r) => r.state)).toEqual(['merged', 'paid', 'merged', 'merged', 'merged', 'merged', 'left'])
    expect(got3.rounds[6]).toMatchObject({ no: 7, amount: 1_000_000, date: todayKst(), edited: false })
    expect(await big(page, 0), 'the merged rounds left the month, the payoff round (today) is in').toBe(out0 + 158_250 + 1_000_000)
    await expect(page.getByRole('button', { name: '중도 완납', exact: true })).toBeVisible() // one round is still left

    // cancel: asks first; the left round leaves the month and the 진행 중 count
    const onBefore = await segCount(page, '진행 중')
    await page.getByRole('button', { name: '취소', exact: true }).click()
    const ask = page.getByRole('alertdialog')
    await expect(ask).toContainText(`${nA}을(를) 취소할까요?`)
    await ask.getByRole('button', { name: '취소하기' }).click()
    await expect(ask).toBeHidden()
    expect(await segCount(page, '진행 중')).toBe(onBefore - 1)
    await seg(page).getByRole('button', { name: /^전체/ }).click()
    await listItem(page, nA).click()
    await expect(page.locator('.id-n .pill')).toHaveText('취소')
    expect(await big(page, 0), 'a cancelled spending keeps only what was paid').toBe(out0 + 158_250)
    expect(digits(await kv(page, '남은 금액').locator('dd').innerText())).toBe(0)
    await expect(page.getByRole('button', { name: '중도 완납', exact: true })).toHaveCount(0)
    // turn it back on with the same button
    await page.getByRole('button', { name: '다시 켜기' }).click()
    await expect(page.locator('.id-n .pill')).toHaveText('진행 중')
    expect(await big(page, 0)).toBe(out0 + 158_250 + 1_000_000)
    expect(((await state(request)).spendings as unknown as Inst[]).find((x) => x.id === ids[0])!.cancelled).toBe(false)

    // 버퍼 사용 is not selectable (0.1.6)
    await page.getByRole('combobox', { name: '내는 방식' }).click()
    await expect(page.getByRole('option', { name: /^버퍼 사용/ })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    // the 카드 할부 / 나눠 내기 filter
    await choose(page.getByRole('combobox', { name: '내는 방식' }), { label: '나눠 내기' })
    await expect(listItem(page, nC)).toBeVisible()
    await expect(page.getByRole('list', { name: '할부 목록' }).getByRole('button', { name: new RegExp(nB) })).toHaveCount(0)
  })
})

test('(S-4) a round the server refuses keeps its editor open and shows the reason; nothing is saved', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const n = `${MARK}-big`
  await withSpendings(request, [instBody(n, { how: 'split', payBy: 'salary', amount: 600_000, count: 2, rounds: rounds(ymAdd(thisYm(), 1), 25, [300_000, 300_000]) })], async (ids) => {
    await page.goto('/#spend/inst')
    await page.getByRole('list', { name: '할부 목록' }).getByRole('button', { name: new RegExp(n) }).click()
    await page.getByRole('button', { name: '1회차 수정' }).click()
    const s = sheet(page, `회차 수정 · ${n} 1/2회`)
    await s.getByLabel('금액 (₩)').fill('2147483647')
    await s.getByRole('button', { name: '저장', exact: true }).click()
    await expect(s.getByRole('alert')).toBeVisible()
    await expect(s).toBeVisible()
    await s.getByRole('button', { name: '취소', exact: true }).click()
    await expect(s).toBeHidden()
    const got = ((await state(request)).spendings as unknown as Inst[]).find((x) => x.id === ids[0])!
    expect(got.rounds[0]!.amount).toBe(300_000)
  })
})

test('(V-7) the 할부 tab and its round editor at 390px: stacked, no sideways scroll', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const n = `${MARK}-ph-${'가나다라마바사'.repeat(5)}`
  await withSpendings(request, [instBody(n, { how: 'installment', payBy: 'card', amount: 1_290_000, fee: 35_000, count: 6, rounds: rounds(thisYm(), 28, [220_830, 220_830, 220_830, 220_830, 220_830, 220_850]) })], async () => {
    await page.goto('/#spend/inst')
    await expect(card(page)).toBeVisible()
    await page.getByRole('list', { name: '할부 목록' }).getByRole('button', { name: new RegExp(MARK) }).first().click()
    const fits = async (what: string) => {
      const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }))
      expect(w.s, `${what}: scrollWidth ${w.s} > clientWidth ${w.c}`).toBeLessThanOrEqual(w.c)
    }
    await expect(page.locator('.id-n h2')).toBeVisible()
    // the list sits above the detail
    const lb = await page.getByRole('list', { name: '할부 목록' }).boundingBox()
    const db = await page.locator('.idet').boundingBox()
    expect(db!.y, 'the detail is below the list').toBeGreaterThanOrEqual(lb!.y + lb!.height - 1)
    await fits('detail')
    await page.getByRole('button', { name: '1회차 수정' }).first().click()
    await expect(page.getByRole('form', { name: /^회차 수정/ })).toBeVisible()
    await fits('round editor')
    const box = await page.getByRole('form', { name: /^회차 수정/ }).boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(390)
    await page.getByRole('button', { name: '취소', exact: true }).click()
    await page.getByRole('button', { name: '중도 완납', exact: true }).click()
    await expect(page.getByRole('form', { name: /^중도 완납/ })).toBeVisible()
    await fits('early payoff')
  })
})

test('(S-10) the 할부 tab in English', async ({ page, request }) => {
  const prefs = (await state(request)).preferences
  expect((await api(request, 'PUT', '/api/preferences', { ...prefs, language: 'en' })).status).toBe(200)
  const n = `${MARK}-en`
  try {
    await withSpendings(request, [instBody(n, { how: 'installment', payBy: 'card', amount: 1_290_000, fee: 35_000, count: 6, rounds: rounds(thisYm(), 28, [220_830, 220_830, 220_830, 220_830, 220_830, 220_850]) })], async () => {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/#spend/inst')
      await expect(page.getByRole('group', { name: 'Filter by status' }).getByRole('button')).toHaveText([/^In progress\s*\d+$/, /^Done\s*\d+$/, /^All\s*\d+$/])
      await page.getByRole('list', { name: 'Installments' }).getByRole('button', { name: new RegExp(n) }).click()
      await expect(page.locator('.id-n h2')).toHaveText(n)
      await expect(page.getByRole('button', { name: 'Pay off early', exact: true })).toBeVisible()
      await expect(page.locator('.rt thead th')).toHaveText(['Round', 'Billing date', 'Amount', 'Counted', 'Status', 'Edit'])
      await expect(page.locator('.rt tbody tr').first()).toContainText('Next')
      await expect(page.locator('.id-s')).toContainText('Principal ₩1,290,000 + fee ₩35,000')
      await page.getByRole('button', { name: 'Edit Round 1' }).click()
      await expect(page.getByRole('form', { name: `Edit round · ${n} 1/6` })).toBeVisible()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    })
  } finally {
    await api(request, 'PUT', '/api/preferences', prefs)
  }
})

// ---------- W-7: the three-step editor (spec 011 S-2, S-3, S-4, S-6, S-8; V-6, V-7) ----------
const EDM = `${RUN}-ed`
type FullSpend = {
  id: string; name: string; note: string; category: string; bought: string; amount: number; currency: string; fxRate: number | null
  how: string; payBy: string; count: number; fee: number; interval: string | null; cancelled: boolean; rounds: R[]
}
type Cfg = { billingDay: number; dayShift: string; fxRate: number; fxBuffer: number }
const cfg = async (request: APIRequestContext) => ((await state(request)) as unknown as { settings: Cfg }).settings
const mineEd = async (request: APIRequestContext) => ((await state(request)) as unknown as { spendings: FullSpend[] }).spendings.filter((s) => s.name.startsWith(EDM))
const byName = async (request: APIRequestContext, n: string) => (await mineEd(request)).find((s) => s.name === `${EDM}-${n}`)!
/** Remove what the editor tests made, by id, and say it is gone. */
async function cleanEd(request: APIRequestContext) {
  for (const s of await mineEd(request)) await api(request, 'DELETE', `/api/spendings/${s.id}`)
  expect(await mineEd(request), 'the editor tests leave no spending').toHaveLength(0)
}
const grp = (s: ReturnType<typeof sheet>, name: string) => s.getByRole('group', { name, exact: true })
const next = (s: ReturnType<typeof sheet>) => s.getByRole('button', { name: '다음', exact: true }).click()
const stepsOf = (s: ReturnType<typeof sheet>) => s.locator('ol.stp li:not(.cn) .nm')
async function openAdd(page: Page, tab: 'general' | 'inst') {
  await page.goto(`/#spend/${tab}`)
  await expect(card(page)).toBeVisible()
  await page.getByRole('button', { name: tab === 'general' ? '지출 추가' : '할부 추가', exact: true }).click()
  const s = sheet(page, tab === 'general' ? '지출 추가' : '할부 추가')
  await expect(s).toBeVisible()
  return s
}
async function fillBought(s: ReturnType<typeof sheet>, name: string, amount: string, date?: string) {
  await s.getByLabel('내용', { exact: true }).fill(name)
  await s.getByLabel('금액', { exact: true }).fill(amount)
  if (date) await fillDate(grp(s, '결제일'), date)
}
const sepDigits = (t: string) => Number(t.replace(/[^\d]/g, ''))
const ymdAdd = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10)

test('(S-2, S-4, W-7) 지출 추가: a card lump sum is billed on the billing day of the next month; the steps, the rounds and the saved values', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const c = await cfg(request)
  const name = `${EDM}-lump`
  try {
    const s = await openAdd(page, 'general')
    await expect(stepsOf(s)).toHaveText(['무엇을 샀나요', '내는 방식', '회차 확인'])
    await expect(s.locator('ol.stp li[aria-current="step"]')).toContainText('무엇을 샀나요')
    // a name and an amount are needed to go on, and the editor says which
    await next(s)
    await expect(s.getByRole('alert')).toContainText('내용을 적어 주세요')
    await fillBought(s, name, '159000', '2031-03-10')
    await expect(s.getByRole('radio', { name: '생활' })).toHaveAttribute('aria-checked', 'true')
    await s.getByRole('radio', { name: '가전' }).click()
    await next(s)
    await expect(s.locator('ol.stp li[aria-current="step"]')).toContainText('내는 방식')
    await expect(grp(s, '내는 방식').getByRole('button', { name: '일시불', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(s.getByLabel('결제 수단', { exact: true })).toContainText(`카드 · 매달 ${c.billingDay}일 청구`)
    const first = await readDate(grp(s, '청구일'))
    expect(first.slice(0, 7), 'the card is billed the month after the purchase').toBe('2031-04')
    if (c.dayShift === 'none') expect(first.slice(8)).toBe(String(c.billingDay).padStart(2, '0'))
    await next(s)
    await expect(s.getByTestId('sp-plan')).toContainText('한 번 · ₩159,000')
    await expect(s.locator('.rl li')).toHaveCount(1)
    await expect(s.locator('.rl li').first()).toContainText(first)
    await expect(s.getByText('4월 나머지에서 빠지고 일반에 들어가요')).toBeVisible()
    await expect(s.getByText('3/3 · 저장하면 변경 내역에 남아요')).toBeVisible()
    await saveSheet(page, '지출 추가')
    const got = await byName(request, 'lump')
    expect(got).toMatchObject({ name, category: '가전', bought: '2031-03-10', amount: 159_000, currency: 'KRW', fxRate: null, how: 'lump', payBy: 'card', count: 1, fee: 0, interval: null, cancelled: false })
    expect(got.rounds).toEqual([{ no: 1, date: first, amount: 159_000, state: 'left', edited: false }])
    // it is in the list of the 일반 tab
    await expect(page.getByRole('button', { name: `${name} 수정` })).toBeEnabled()
  } finally {
    await cleanEd(request)
  }
})

test('(S-4, W-7) 할부 추가: a card installment with a fee shows 6 rounds with the odd 20 won on the last, and saves them', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const c = await cfg(request)
  try {
    const s = await openAdd(page, 'inst')
    await fillBought(s, `${EDM}-fee`, '1290000', '2031-03-10')
    await next(s)
    await expect(grp(s, '내는 방식').getByRole('button', { name: '카드 할부', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(grp(s, '할부 개월').getByRole('button', { name: '6개월', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(s.getByLabel('결제 수단', { exact: true })).toBeDisabled() // an installment is always on the card
    await expect(s.getByLabel('수수료 합계 (₩)')).toHaveCount(0)
    await grp(s, '이자').getByRole('button', { name: '유이자', exact: true }).click()
    await s.getByLabel('수수료 합계 (₩)').fill('35000')
    await next(s)
    await expect(s.getByTestId('sp-plan')).toContainText('6개월')
    await expect(s.getByTestId('sp-plan')).toContainText('수수료 ₩35,000 포함 ₩1,325,000')
    await expect(s.getByTestId('sp-plan')).toContainText('회당 ₩220,830')
    await expect(s.locator('.rl li')).toHaveCount(6)
    await expect(s.locator('.rl li').last()).toContainText('₩220,850')
    await expect(s.getByText('끝전 ₩20은 마지막 회차가 받아요.').first()).toBeVisible()
    await expect(s.getByText('회차마다 그 달 나머지에서 빠지고 할부에 들어가요')).toBeVisible()
    await saveSheet(page, '할부 추가')
    const got = await byName(request, 'fee')
    expect(got).toMatchObject({ how: 'installment', payBy: 'card', count: 6, fee: 35_000, amount: 1_290_000, interval: null, fxRate: null })
    expect(got.rounds.map((r) => r.amount)).toEqual([220_830, 220_830, 220_830, 220_830, 220_830, 220_850])
    expect(got.rounds.every((r) => r.state === 'left' && !r.edited)).toBe(true)
    expect(got.rounds[0]!.date.slice(0, 7)).toBe('2031-04')
    if (c.dayShift === 'none') expect(got.rounds.map((r) => r.date.slice(8))).toEqual(Array(6).fill(String(c.billingDay).padStart(2, '0')))
    await expect(page.getByRole('list', { name: '할부 목록' }).getByRole('button', { name: new RegExp(`${EDM}-fee`) })).toBeVisible()
  } finally {
    await cleanEd(request)
  }
})

test('(S-4, W-7) 나눠 내기: every 2 weeks from a date, and "날짜 직접 정하기" with one date input per round', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  try {
    // every two weeks, three times, paid from the salary account
    let s = await openAdd(page, 'inst')
    await fillBought(s, `${EDM}-bi`, '900000', '2031-03-10')
    await next(s)
    await grp(s, '내는 방식').getByRole('button', { name: '나눠 내기', exact: true }).click()
    await expect(grp(s, '나눠 낼 횟수').getByRole('button', { name: '3회', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(grp(s, '이자')).toHaveCount(0) // a split payment has no fee
    await choose(s.getByLabel('간격', { exact: true }), { label: '2주마다' })
    await choose(s.getByLabel('결제 수단', { exact: true }), { label: '급여 통장' })
    await expect(grp(s, '1회차 날짜')).toBeVisible()
    await fillDate(grp(s, '1회차 날짜'), '2031-03-10')
    await next(s)
    await expect(s.getByTestId('sp-plan')).toContainText('3회')
    await expect(s.locator('.rl li')).toHaveText([/2031-03-10.*₩300,000/, /2031-03-24.*₩300,000/, /2031-04-07.*₩300,000/])
    await expect(s.getByText('회차마다 그 달 나머지에서 빠지고 할부에 들어가요')).toBeVisible()
    await saveSheet(page, '할부 추가')
    const bi = await byName(request, 'bi')
    expect(bi).toMatchObject({ how: 'split', payBy: 'salary', count: 3, fee: 0, interval: 'biweekly' })
    expect(bi.rounds.map((r) => [r.date, r.amount])).toEqual([['2031-03-10', 300_000], ['2031-03-24', 300_000], ['2031-04-07', 300_000]])

    // the user picks the date of each of four rounds; a fee is not asked
    s = await openAdd(page, 'inst')
    await fillBought(s, `${EDM}-cu`, '100000', '2031-03-10')
    await next(s)
    await grp(s, '내는 방식').getByRole('button', { name: '나눠 내기', exact: true }).click()
    await grp(s, '나눠 낼 횟수').getByRole('button', { name: '4회', exact: true }).click()
    await choose(s.getByLabel('간격', { exact: true }), { label: '날짜 직접 정하기' })
    await expect(s.getByRole('group', { name: /^\d회차 날짜$/ })).toHaveCount(4)
    const picks = ['2031-05-02', '2031-05-20', '2031-07-01', '2031-12-24']
    for (const [i, d] of picks.entries()) await fillDate(grp(s, `${i + 1}회차 날짜`), d)
    await next(s)
    await expect(s.locator('.rl li')).toHaveText(picks.map((d) => new RegExp(`${d}.*₩25,000`)))
    await saveSheet(page, '할부 추가')
    const cu = await byName(request, 'cu')
    expect(cu).toMatchObject({ how: 'split', count: 4, interval: 'custom' })
    expect(cu.rounds.map((r) => r.date)).toEqual(picks)
  } finally {
    await cleanEd(request)
  }
})

test('(S-3, V-6, W-7) USD from the subscription account: KRW at the rate with the buffer, kept with its rate; the month card and the transfer move', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const c = await cfg(request)
  const krw = Math.round(49 * c.fxRate * (1 + c.fxBuffer / 100))
  await page.goto('/#spend/general')
  await expect(card(page)).toBeVisible()
  const before = await big(page, 1)
  try {
    const s = await openAdd(page, 'general')
    await s.getByLabel('내용', { exact: true }).fill(`${EDM}-usd`)
    await s.getByRole('button', { name: 'USD', exact: true }).click()
    await s.getByLabel('금액', { exact: true }).fill('49')
    await expect(s.getByTestId('sp-fx')).toContainText(`₩${c.fxRate.toLocaleString('en-US')}`)
    await expect(s.getByTestId('sp-fx')).toContainText(`버퍼 ${c.fxBuffer}%`)
    expect(sepDigits(await s.getByTestId('sp-krw').innerText())).toBe(krw)
    await s.getByRole('radio', { name: '기타 · 직접 입력' }).click()
    await s.getByLabel('분류 직접 입력').fill('교육')
    await next(s)
    await choose(s.getByLabel('결제 수단', { exact: true }), { label: '구독 통장' })
    await next(s)
    await expect(s.getByTestId('sp-plan')).toContainText(`₩${krw.toLocaleString('en-US')}`)
    await expect(s.getByText(/월 구독 이체에 더해지고 일반에 들어가요/)).toBeVisible()
    await saveSheet(page, '지출 추가')
    const got = await byName(request, 'usd')
    expect(got).toMatchObject({ currency: 'USD', amount: 49, fxRate: c.fxRate, fxBuffer: c.fxBuffer, how: 'lump', payBy: 'subs', category: '교육' })
    expect(got.rounds).toHaveLength(1)
    expect(got.rounds[0]!.amount).toBe(krw)
    // the round is on the day of the purchase (today): this month's card adds it to the subscription transfer
    expect(got.rounds[0]!.date).toBe(todayKst())
    await page.reload()
    await expect(card(page)).toBeVisible()
    expect(await big(page, 1) - before, 'the subscription transfer gets the KRW amount').toBe(krw)
  } finally {
    await cleanEd(request)
  }
})

test('(S-7, W-7) 버퍼 사용 cannot be chosen', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const s = await openAdd(page, 'general')
  await s.getByLabel('내용', { exact: true }).fill(`${EDM}-buf`)
  await s.getByLabel('금액', { exact: true }).fill('1000')
  await next(s)
  const how = grp(s, '내는 방식')
  const buf = how.getByRole('button', { name: '버퍼 사용', exact: true })
  await expect(buf).toBeDisabled()
  await buf.click({ force: true })
  await expect(how.getByRole('button', { name: '일시불', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(s.getByText('버퍼 사용은 준비 중이에요.')).toBeVisible()
  await s.getByRole('button', { name: '취소', exact: true }).click()
  await expect(s).toBeHidden()
})

test('(S-4, S-6, W-7) 수정: no change keeps the rounds as they were, edited flags and paid marks included; a change asks before the rounds are worked out again', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const name = `${EDM}-re`
  const ym = ymAdd(thisYm(), 1)
  const original: R[] = [
    { no: 1, date: `${ym}-16`, amount: 100_000, state: 'paid', edited: false },
    { no: 2, date: `${ymAdd(ym, 1)}-20`, amount: 110_000, state: 'left', edited: true },
    { no: 3, date: `${ymAdd(ym, 2)}-16`, amount: 90_000, state: 'left', edited: false },
  ]
  try {
    const made = await api(request, 'POST', '/api/spendings', instBody(name, { how: 'installment', payBy: 'card', amount: 300_000, count: 3, rounds: original }))
    expect(made.status).toBe(201)
    await page.goto('/#spend/inst')
    await listItem(page, name).click()
    await page.getByRole('button', { name: `${name} 수정` }).click()
    const s = sheet(page, `할부 수정 · ${name}`)
    await expect(s).toBeVisible()
    await expect(s.getByLabel('내용', { exact: true })).toHaveValue(name)
    await expect(s.getByLabel('금액', { exact: true })).toHaveValue('300,000')
    await next(s)
    await expect(grp(s, '할부 개월').getByRole('button', { name: '3개월', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(grp(s, '이자').getByRole('button', { name: '무이자', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(readDate(grp(s, '첫 청구일'))).resolves.toBe(original[0]!.date)
    await next(s)
    // the stored rounds are shown as they are, without a warning
    await expect(s.locator('.rl li')).toHaveCount(3)
    await expect(s.locator('.rl li').nth(1)).toContainText('고침')
    await expect(s.locator('.rl li').nth(0)).toContainText('냄')
    await expect(s.locator('.rl li').nth(1)).toContainText('₩110,000')
    await expect(s.getByTestId('sp-replan')).toHaveCount(0)
    await s.getByRole('button', { name: '+ 메모 추가' }).click()
    await s.getByLabel('메모').fill('고친 메모')
    await saveSheet(page, `할부 수정 · ${name}`)
    let got = await byName(request, 're')
    expect(got.note).toBe('고친 메모')
    expect(got.rounds, 'the rounds are exactly as they were').toEqual(original)

    // 6 months instead of 3: the editor warns, and asks again on save; "취소" there saves nothing
    await page.getByRole('button', { name: `${name} 수정` }).click()
    const e = sheet(page, `할부 수정 · ${name}`)
    await expect(e).toBeVisible()
    await next(e)
    await grp(e, '할부 개월').getByRole('button', { name: '6개월', exact: true }).click()
    await next(e)
    await expect(e.locator('.rl li')).toHaveCount(6)
    await expect(e.getByTestId('sp-replan')).toContainText('고친 회차 1개는 계산한 값으로 돌아가요')
    await expect(e.getByTestId('sp-replan')).toContainText('냄으로 표시한 회차 1개는 같은 회차 번호에 냄으로 남아요')
    await e.getByRole('button', { name: '저장', exact: true }).click()
    const ask = page.getByRole('alertdialog')
    await expect(ask).toContainText('회차를 다시 계산할까요?')
    await ask.getByRole('button', { name: '취소', exact: true }).click()
    await expect(ask).toBeHidden()
    await expect(e).toBeVisible()
    expect((await byName(request, 're')).rounds, 'nothing was saved').toEqual(original)
    await e.getByRole('button', { name: '저장', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '다시 계산하고 저장', exact: true }).click()
    await expect(e).toBeHidden()
    got = await byName(request, 're')
    expect(got.count).toBe(6)
    expect(got.rounds.map((r) => r.amount)).toEqual(Array(6).fill(50_000))
    expect(got.rounds.map((r) => r.state)).toEqual(['paid', 'left', 'left', 'left', 'left', 'left'])
    expect(got.rounds.every((r) => !r.edited)).toBe(true)
    expect(got.rounds[0]!.date).toBe(original[0]!.date) // the first date is kept
    expect(got.rounds.map((r) => r.date.slice(0, 7))).toEqual([0, 1, 2, 3, 4, 5].map((k) => ymAdd(ym, k)))
  } finally {
    await cleanEd(request)
  }
})

test('(S-6, W-7) 일반 수정: mark the single round 냄, then delete inside the editor after a confirmation', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const name = `${EDM}-gen`
  try {
    expect((await api(request, 'POST', '/api/spendings', { ...lump(name, 55_000, 'salary') })).status).toBe(201)
    await page.goto('/#spend/general')
    await page.getByRole('button', { name: `${name} 수정` }).click()
    const s = sheet(page, `지출 수정 · ${name}`)
    await expect(s).toBeVisible()
    await next(s); await next(s)
    await expect(grp(s, '상태').getByRole('button', { name: '남음', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await grp(s, '상태').getByRole('button', { name: '냄', exact: true }).click()
    await saveSheet(page, `지출 수정 · ${name}`)
    const got = await byName(request, 'gen')
    expect(got.rounds).toHaveLength(1)
    expect(got.rounds[0]).toMatchObject({ state: 'paid', amount: 55_000, edited: false })
    await expect(page.locator('table.gen-t tbody tr').filter({ hasText: name })).toContainText('냄')

    // cancel the confirmation: still there; confirm: gone
    await page.getByRole('button', { name: `${name} 수정` }).click()
    const e = sheet(page, `지출 수정 · ${name}`)
    await next(e); await next(e)
    await e.getByRole('button', { name: '삭제', exact: true }).click()
    const ask = page.getByRole('alertdialog')
    await expect(ask).toContainText(`${name}을(를) 삭제할까요?`)
    await ask.getByRole('button', { name: '취소', exact: true }).click()
    await expect(ask).toBeHidden()
    expect(await mineEd(request)).toHaveLength(1)
    await deleteInSheet(page, `지출 수정 · ${name}`)
    expect(await mineEd(request), 'the spending and its rounds are gone').toHaveLength(0)
    await expect(page.getByRole('button', { name: `${name} 수정` })).toHaveCount(0)
  } finally {
    await cleanEd(request)
  }
})

test('(S-4, W-7) the server says no: the editor stays open with the reason and nothing is saved', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  try {
    const s = await openAdd(page, 'general')
    await fillBought(s, `${EDM}-big`, '2147483648') // KRW 2,147,483,648 does not fit a round
    await next(s); await next(s)
    await s.getByRole('button', { name: '저장', exact: true }).click()
    await expect(s.getByRole('alert')).toBeVisible()
    await expect(s).toBeVisible()
    expect(await mineEd(request)).toHaveLength(0)
    await s.getByRole('contentinfo').getByRole('button', { name: '취소', exact: true }).click() // not the 취소 of the 상태 control
  } finally {
    await cleanEd(request)
  }
})

test('(S-8, W-7) 기록 추가 › 일회성 지출 › 다음 opens the three-step editor on the 일반 tab; the round is in the upcoming payments and on the calendar', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const today = todayKst()
  const name = `${EDM}-home`
  const nameS = `${EDM}-hs`
  try {
    // a split with its first round today, 3 payments: "1/3회"
    const rs: R[] = [0, 1, 2].map((k) => ({ no: k + 1, date: k === 0 ? today : `${ymAdd(today.slice(0, 7), k)}-28`, amount: 40_000, state: 'left', edited: false }))
    expect((await api(request, 'POST', '/api/spendings', instBody(nameS, { how: 'split', payBy: 'salary', amount: 120_000, count: 3, rounds: rs }))).status).toBe(201)
    await go(page, 'home')
    await page.getByRole('button', { name: '기록 추가', exact: true }).click()
    const m = sheet(page, '기록 추가')
    await expect(m.getByRole('radio')).toHaveText([/^확인할 것/, /^일정/, /^구독/, /^일회성 지출/])
    await m.getByRole('radio', { name: /^일회성 지출/ }).click()
    await expect(m.getByRole('button', { name: '다음', exact: true })).toBeEnabled()
    await m.getByRole('button', { name: '다음', exact: true }).click()
    await expect(page).toHaveURL(/#spend\/general$/)
    const s = sheet(page, '지출 추가')
    await expect(s).toBeVisible()
    await expect(stepsOf(s)).toHaveCount(3)
    await fillBought(s, name, '77000') // bought today, paid from the salary account below
    await next(s)
    await choose(s.getByLabel('결제 수단', { exact: true }), { label: '급여 통장' })
    await next(s)
    await saveSheet(page, '지출 추가')
    const got = await byName(request, 'home')
    expect(got.rounds[0]).toMatchObject({ date: today, amount: 77_000, state: 'left' })

    // the home's upcoming payments: the name, "n/N회" for a split and nothing for a lump sum
    await go(page, 'home')
    const pays = page.locator('ul.pays')
    await expect(pays.locator('li').filter({ hasText: name })).toContainText('₩77,000')
    await expect(pays.locator('li').filter({ hasText: name })).toContainText('일회성 지출')
    await expect(pays.locator('li').filter({ hasText: nameS })).toContainText('1/3회')
    await expect(pays.locator('li').filter({ hasText: nameS })).toContainText('₩40,000')
    await expect(pays.locator('li').filter({ hasText: nameS })).not.toContainText('2/3회')
    // the calendar tab: the same label on the day
    await page.goto('/#events')
    const day = page.locator('.agenda li[data-kind="spend"]')
    await expect(day.filter({ hasText: name })).toContainText('₩77,000')
    await expect(day.filter({ hasText: `${nameS} 1/3회` })).toContainText('₩40,000')
    await expect(day.filter({ hasText: `${nameS} 2/3회` })).toHaveCount(0) // next month's round is on next month's page
    // a round marked paid and a cancelled spending leave both places
    await api(request, 'PUT', `/api/spendings/${got.id}`, { ...got, id: undefined, cancelled: true })
    await page.goto('/#home')
    await page.reload()
    await page.getByRole('tablist').first().waitFor()
    await expect(pays.locator('li').filter({ hasText: name })).toHaveCount(0)
    await expect(pays.locator('li').filter({ hasText: nameS })).toHaveCount(1)
  } finally {
    await cleanEd(request)
  }
})

test('(V-6 preservation) 기록 추가 still saves 확인할 것 and 일정 (with a month range) and still goes on to the subscription editor', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const text = `${EDM}-todo`
  const title = `${EDM}-ev`
  type Mini = { checks: { id: string; text: string; done: boolean }[]; events: { id: string; when: string; kind: string; title: string; state: string }[] }
  const st = async () => (await state(request)) as unknown as Mini
  try {
    await go(page, 'home')
    await page.getByRole('button', { name: '기록 추가', exact: true }).click()
    const m = sheet(page, '기록 추가')
    // 확인할 것 is the first kind and saves its text with done = false
    await m.getByLabel('내용', { exact: true }).fill(text)
    await saveSheet(page, '기록 추가')
    const todo = (await st()).checks.find((c) => c.text === text)
    expect(todo, '확인할 것 saved').toMatchObject({ text, done: false })
    // 일정: the 시기 is text, a month range stays a month range, the 종류 defaults to what it was
    await page.getByRole('button', { name: '기록 추가', exact: true }).click()
    await m.getByRole('radio', { name: /^일정/ }).click()
    await m.getByLabel('제목').fill(title)
    await m.getByLabel('날짜 또는 월').fill('2027-01~02')
    await saveSheet(page, '기록 추가')
    const ev = (await st()).events.find((e) => e.title === title)
    expect(ev, '일정 saved').toMatchObject({ when: '2027-01~02', kind: '저축', state: 'todo' })
    // 구독 goes on to the subscription editor, as before
    await page.getByRole('button', { name: '기록 추가', exact: true }).click()
    await m.getByRole('radio', { name: /^구독/ }).click()
    await expect(m.getByRole('button', { name: '다음', exact: true })).toBeVisible()
    await m.getByRole('button', { name: '다음', exact: true }).click()
    await expect(page).toHaveURL(/#subs$/)
    await expect(sheet(page, '구독 추가')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet(page, '구독 추가')).toBeHidden()
  } finally {
    const now = await st()
    for (const c of now.checks.filter((x) => x.text === text)) await api(request, 'DELETE', `/api/checks/${c.id}`)
    for (const e of now.events.filter((x) => x.title === title)) await api(request, 'DELETE', `/api/events/${e.id}`)
    const after = await st()
    expect(after.checks.filter((x) => x.text === text)).toHaveLength(0)
    expect(after.events.filter((x) => x.title === title)).toHaveLength(0)
  }
})

test('(V-7, W-7) the editor at 390px: every step fits, no sideways scroll', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const fits = async (label: string) => {
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth, body: [...document.querySelectorAll<HTMLElement>('.modal .body, .modal')].every((e) => e.scrollWidth <= e.clientWidth + 1) }))
    expect(w, `${label}: no sideways scroll`).toEqual({ doc: true, body: true })
  }
  try {
    const s = await openAdd(page, 'inst')
    await expect(s).toBeVisible()
    await s.getByLabel('내용', { exact: true }).fill(`${EDM}-a-very-long-name-that-has-to-wrap-onto-more-than-one-line-on-a-phone`)
    await s.getByRole('button', { name: 'USD', exact: true }).click()
    await s.getByLabel('금액', { exact: true }).fill('1234.5')
    await s.getByRole('radio', { name: '기타 · 직접 입력' }).click()
    await fits('step 1 (USD, other category)')
    await next(s)
    await grp(s, '이자').getByRole('button', { name: '유이자', exact: true }).click()
    await grp(s, '할부 개월').getByRole('button', { name: '직접', exact: true }).click()
    await fits('step 2 (installment, fee, custom count)')
    await grp(s, '내는 방식').getByRole('button', { name: '나눠 내기', exact: true }).click()
    await grp(s, '나눠 낼 횟수').getByRole('button', { name: '4회', exact: true }).click()
    await choose(s.getByLabel('간격', { exact: true }), { label: '날짜 직접 정하기' })
    await fits('step 2 (split, a date for each round)')
    await next(s)
    await expect(s.locator('.rl li')).toHaveCount(4)
    await fits('step 3')
    await s.getByRole('button', { name: '취소', exact: true }).click()
  } finally {
    await cleanEd(request)
  }
})

test('(S-10, W-7) the editor in English', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const prefs = (await state(request)).preferences
  expect((await api(request, 'PUT', '/api/preferences', { ...prefs, language: 'en' })).status).toBe(200)
  try {
    await page.goto('/#spend/general')
    await page.getByRole('button', { name: 'Add spending', exact: true }).click()
    const s = sheet(page, 'Add spending')
    await expect(s).toBeVisible()
    await expect(stepsOf(s)).toHaveText(['What you bought', 'How you pay', 'Check the rounds'])
    await expect(s.getByLabel('What for', { exact: true })).toBeVisible()
    await expect(s.getByRole('radio', { name: 'Appliance' })).toBeVisible()
    await s.getByLabel('What for', { exact: true }).fill(`${EDM}-en`)
    await s.getByLabel('Amount', { exact: true }).fill('12000')
    await s.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(grp(s, 'How you pay').getByRole('button')).toHaveText(['Lump sum', 'Card installment', 'Split payment', 'Use buffer'])
    await expect(s.getByText('Use buffer is coming soon.')).toBeVisible()
    await s.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(s.getByText('3/3 · Saved to the change history')).toBeVisible()
    await expect(s.getByText(/Comes off the remainder of month \d+ and goes to One-off/)).toBeVisible()
    await s.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(s).toBeHidden()
    expect((await byName(request, 'en')).category).toBe('Living') // a category is saved in the words shown
    await page.getByRole('button', { name: `Edit ${EDM}-en` }).click()
    await expect(sheet(page, `Edit spending · ${EDM}-en`)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  } finally {
    await api(request, 'PUT', '/api/preferences', prefs)
    await cleanEd(request)
  }
})

test('(review 7, S-3) a USD installment keeps the rate and the buffer it was saved with: a changed buffer moves no total, KPI or difference', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const before = (await state(request)) as unknown as { settings: Record<string, unknown> }
  const settings = before.settings
  const n = `${MARK}-usdi`
  // USD 100 at 1,000 with a 3% buffer is 103,000 over 2 rounds; the fee on a card installment adds 4,000
  const body = { ...instBody(n, { how: 'installment', payBy: 'card', amount: 100, fee: 4_000, count: 2, rounds: rounds(thisYm(), 28, [53_500, 53_500]) }), currency: 'USD', fxRate: 1000, fxBuffer: 3 }
  const feeKpi = async () => digits(await kcard(page, 2).locator('.k2 b').innerText())
  try {
    await withSpendings(request, [body], async () => {
      await page.goto('/#spend/inst')
      await listItem(page, n).click()
      const totals = async () => ({ total: await kv(page, '총액').innerText(), fee: await feeKpi(), left: await kval(page, 0), sub: await kcard(page, 2).innerText() })
      expect(digits(await kv(page, '총액').locator('dd').innerText())).toBe(107_000)
      await expect(kv(page, '총액')).toContainText('원금 ₩103,000 + 수수료 ₩4,000')
      await expect(page.locator('.diff')).toHaveCount(0)
      const t0 = await totals()
      expect((await api(request, 'PUT', '/api/settings', { ...settings, fxBuffer: 9 })).status).toBe(200)
      await page.reload()
      await listItem(page, n).click()
      expect(await totals(), 'the total, the fee card and the left card did not move with the buffer').toEqual(t0)
      await expect(page.locator('.diff')).toHaveCount(0)
      // a round marked paid or paid off at the same amount creates no difference either
      await page.getByRole('button', { name: '1회차 수정' }).click()
      const e = sheet(page, `회차 수정 · ${n} 1/2회`)
      await e.getByRole('group', { name: /^상태/ }).getByRole('button', { name: '냄', exact: true }).click()
      await saveSheet(page, `회차 수정 · ${n} 1/2회`)
      await expect(page.locator('.diff')).toHaveCount(0)
      expect(digits(await kv(page, '총액').locator('dd').innerText())).toBe(107_000)
    })
  } finally {
    await api(request, 'PUT', '/api/settings', settings)
  }
})

test('(review 7, S-4) the per-round amount is not the odd last round: 1,001 won in 2 rounds is 500 + 501; with the first rounds edited the next plain one is used', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const two = `${MARK}-two`, four = `${MARK}-four`
  const mk = (name: string, amounts: number[], edited: number[]) => instBody(name, { how: 'split', payBy: 'salary', amount: amounts.reduce((a, b) => a + b, 0), count: amounts.length, rounds: rounds(ymAdd(thisYm(), 1), 25, amounts).map((r, i) => ({ ...r, edited: edited.includes(i) })) })
  await withSpendings(request, [mk(two, [500, 501], []), mk(four, [900, 900, 500, 501], [0, 1])], async () => {
    await page.goto('/#spend/inst')
    await listItem(page, two).click()
    expect(digits(await kv(page, '회당').locator('dd').innerText())).toBe(500)
    await expect(kv(page, '회당')).toContainText('마지막 회차 ₩501')
    // two plain rounds are left (the 3rd and the 4th): the 3rd is the per-round amount, the 4th is the last
    await listItem(page, four).click()
    expect(digits(await kv(page, '회당').locator('dd').innerText())).toBe(500)
    await expect(kv(page, '회당')).toContainText('마지막 회차 ₩501')
    await expect(kv(page, '회당')).toContainText('고친 회차 2개')
  })
})

test('(S-4, A-25, review 8, W-7) a first date set a year on: the later billing dates still move off a holiday of that year', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const before = (await state(request)).settings as unknown as Record<string, unknown>
  let setId = ''
  try {
    // billing day 16, a billing date on a closed day moves to the next business day, and 2027-12-16 (a Thursday) is a holiday
    expect((await api(request, 'PUT', '/api/settings', { ...before, billingDay: 16, dayShift: 'after' })).status).toBe(200)
    const made = await api(request, 'POST', '/api/holiday-sets', { name: `${EDM}-hol`, enabled: true, builtin: null, rules: [{ name: `${EDM}-day`, rdate: ['2027-12-16'] }] })
    expect(made.status).toBe(201)
    setId = (made.json as { id: string }).id
    await page.goto('/#spend/inst')
    await page.reload()
    await page.getByRole('button', { name: '할부 추가', exact: true }).click()
    const s = sheet(page, '할부 추가')
    await fillBought(s, `${EDM}-hol`, '300000', '2026-11-10')
    await next(s)
    await expect(grp(s, '할부 개월').getByRole('button', { name: '3개월', exact: true })).toBeVisible()
    await grp(s, '할부 개월').getByRole('button', { name: '3개월', exact: true }).click()
    await fillDate(grp(s, '첫 청구일'), '2027-11-16')
    await next(s)
    await expect(s.locator('.rl li')).toHaveCount(3)
    await expect(s.locator('.rl li').nth(0)).toContainText('2027-11-16')
    await expect(s.locator('.rl li').nth(1)).toContainText('2027-12-17') // not the 16th, a holiday
    await saveSheet(page, '할부 추가')
    const got = await byName(request, 'hol')
    expect(got.rounds.map((r) => r.date).slice(0, 2)).toEqual(['2027-11-16', '2027-12-17'])
  } finally {
    if (setId) await api(request, 'DELETE', `/api/holiday-sets/${setId}`)
    await api(request, 'PUT', '/api/settings', before)
    await cleanEd(request)
    expect(((await api(request, 'GET', '/api/state')).json as { holidaySets: { id: string }[] }).holidaySets.some((h) => h.id === setId), 'the test holiday set is removed').toBe(false)
  }
})

test('(S-5, S-6, review 13, W-7) a lump sum is cancelled and resumed from its editor: 취소 on the tab, out of the month card and the method card', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const name = `${EDM}-cx`
  const row = () => page.locator('table.gen-t tbody tr').filter({ hasText: name })
  const edit = async (pick: '취소' | '남음') => {
    await page.getByRole('button', { name: `${name} 수정` }).click()
    const s = sheet(page, `지출 수정 · ${name}`)
    await next(s); await next(s)
    await grp(s, '상태').getByRole('button', { name: pick, exact: true }).click()
    if (pick === '취소') await expect(s.getByText('반영 안 함')).toBeVisible()
    await saveSheet(page, `지출 수정 · ${name}`)
  }
  try {
    await page.goto('/#spend/general')
    await expect(card(page)).toBeVisible()
    const out0 = await big(page, 0)
    const k0 = digits(await gCards(page).nth(2).locator('.k2 b').innerText())
    expect((await api(request, 'POST', '/api/spendings', lump(name, 55_000, 'salary'))).status).toBe(201)
    await page.reload()
    await expect(card(page)).toBeVisible()
    expect(await big(page, 0)).toBe(out0 + 55_000)
    expect(digits(await gCards(page).nth(2).locator('.k2 b').innerText())).toBe(k0 + 55_000)

    await edit('취소')
    const got = await byName(request, 'cx')
    expect(got.cancelled).toBe(true)
    expect(got.rounds).toHaveLength(1)
    expect(got.rounds[0]).toMatchObject({ amount: 55_000, state: 'left', edited: false })
    await expect(row()).toContainText('취소')
    await expect(row()).toContainText('반영 안 함')
    expect(await big(page, 0), 'the month card drops it').toBe(out0)
    expect(digits(await gCards(page).nth(2).locator('.k2 b').innerText()), 'the method card leaves it out').toBe(k0)

    await edit('남음')
    expect((await byName(request, 'cx')).cancelled).toBe(false)
    await expect(row()).not.toContainText('취소')
    expect(await big(page, 0)).toBe(out0 + 55_000)
  } finally {
    await cleanEd(request)
  }
})
