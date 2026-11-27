// spec 018 (0.1.10-rc.1, V-6): the calculation changes on the screens. W-1: the weekend and holiday rule of each date
// (Settings › General › 기준 일정) and of each of the user's own monthly dates. W-2: a card's usage period (the card
// editor of 월급 분배, the card list, and the bill date of a new card spending).
// W-4: the month basis (Settings › General › 달의 기준): the confirmation, the period next to a month's name, the numbers.
// W-5: the month a card bill counts in and the transfers to the paying accounts (월급 분배 › 월별 시뮬레이션 › 대금 계좌 이체): the
// block, 지출's reflection strip and the account sheet's forecast show the same money.
// W-6: a charge uses the plan in force on its own date (현황 › 결제 예정), and the plan change editor's date hint says so.
// W-7: how a subscription is paid (구독 › the editor's 결제 수단, the list, and the account sheet's forecast).
// Every row made here carries the run mark and is removed by id in `finally`; the settings the tests change are put back.
// It changes the settings, so it runs only on a throwaway server: the test server (:15174) or the API of
// scripts/test-server/disposable.sh (:15184, started with STATIC_DIR=dist so it serves the built screens).
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { MARK as RUN, choose, fillDate, menu, readDate, saveSheet, sheet } from './helpers'

const THROWAWAY = ['http://127.0.0.1:15174', 'http://127.0.0.1:15184']
if (!THROWAWAY.includes(process.env.BASE ?? '')) throw new Error(`rc1-calc.spec runs only against ${THROWAWAY.join(' or ')} (BASE=${process.env.BASE ?? 'unset'})`)

const MARK = `${RUN}-c1`

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
type Shift = 'before' | 'none' | 'after'
type Settings = Record<string, unknown> & { payDay: number; transferDay: number; billingDay: number; payShift: Shift; transferShift: Shift; billingShift: Shift }
type Sched = { id: string; name: string; day: number; accountId: string | null; direction: 'in' | 'out'; note?: string | null; shift: Shift }
type CardRow = { id: string; name: string; last4: string; accountId: string | null; billingDay: number | null; usageFrom: number | null; note?: string }
type SpendRow = { id: string; name: string; how: string; payBy: string; cardId: string | null; count: number; rounds: { no: number; date: string; amount: number; state: string; edited: boolean }[] }
type State = { settings: Settings; schedules: Sched[]; cards: CardRow[]; spendings: SpendRow[] }
const state = async (request: APIRequestContext) => (await api(request, 'GET', '/api/state')).json as State
const rules = (s: Settings) => [s.payShift, s.transferShift, s.billingShift]

const WORD: Record<Shift, string> = { before: '앞당김', none: '그대로', after: '미룸' }
/** The rule segment of a date by the date's name (the three days and each own date have one). */
const seg = (page: Page, name: string) => page.getByRole('group', { name: `${name}: 주말·공휴일이면`, exact: true })
const pick = (s: Locator, rule: Shift) => s.getByRole('button', { name: WORD[rule], exact: true }).click()
async function shows(s: Locator, rule: Shift) {
  await expect(s.locator('button[aria-pressed="true"]')).toHaveCount(1)
  await expect(s.getByRole('button', { name: WORD[rule], exact: true })).toHaveAttribute('aria-pressed', 'true')
}
const form = (page: Page) => page.getByRole('form', { name: '기준 일정', exact: true })
async function saveForm(page: Page) {
  await form(page).getByRole('button', { name: '저장', exact: true }).click()
  await expect(form(page).getByRole('status')).toHaveText('저장했어요.')
}
/** A Saturday of this month whose Monday is in this month too (the calendar of the browser's zone, Asia/Seoul). */
function saturday() {
  const now = new Date(new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' }).replace(' ', 'T'))
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  for (let d = 1; d <= last - 2; d++) if (new Date(now.getFullYear(), now.getMonth(), d).getDay() === 6) return { day: d, month: now.getMonth() + 1 }
  throw new Error('no Saturday found')
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }) })

test.describe.serial('W-1 the weekend and holiday rule of each date', () => {
  test('(S-1, V-6) the rule saved the old way shows on all three dates; one is changed, saved and read back, the others stay', async ({ page, request }) => {
    const s0 = (await state(request)).settings
    try {
      // what 0.1.9 saved: one rule for the three dates, sent the old way (dayShift alone)
      const { payShift: _p, transferShift: _t, billingShift: _b, ...old } = s0
      const put = await api(request, 'PUT', '/api/settings', { ...old, dayShift: 'before' })
      expect(put.status).toBe(200)
      expect(rules(put.json as Settings)).toEqual(['before', 'before', 'before'])
      expect('dayShift' in (put.json as object)).toBe(false)

      await page.goto('/settings/general')
      for (const name of ['월급일', '분배일', '카드 결제일']) await shows(seg(page, name), 'before')
      // the one segment for all three and its note are gone
      await expect(page.getByText('세 날짜에 모두 적용돼요')).toHaveCount(0)

      // change the transfer day's rule only
      await pick(seg(page, '분배일'), 'after')
      await saveForm(page)
      expect(rules((await state(request)).settings)).toEqual(['before', 'after', 'before'])
      await page.reload()
      await shows(seg(page, '월급일'), 'before')
      await shows(seg(page, '분배일'), 'after')
      await shows(seg(page, '카드 결제일'), 'before')

      // the third value, on another date; the days are saved with the rules as before
      await pick(seg(page, '카드 결제일'), 'none')
      await pick(seg(page, '월급일'), 'after')
      await saveForm(page)
      const got = (await state(request)).settings
      expect(rules(got)).toEqual(['after', 'after', 'none'])
      expect([got.payDay, got.transferDay, got.billingDay]).toEqual([s0.payDay, s0.transferDay, s0.billingDay])
      await page.reload()
      await shows(seg(page, '월급일'), 'after')
      await shows(seg(page, '카드 결제일'), 'none')

      // 취소 puts an unsaved pick back
      await pick(seg(page, '월급일'), 'none')
      await form(page).getByRole('button', { name: '취소', exact: true }).click()
      await shows(seg(page, '월급일'), 'after')
      expect(rules((await state(request)).settings)).toEqual(['after', 'after', 'none'])
    } finally {
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
    }
  })

  test('(S-1, V-6) this month\'s date on a row follows that row\'s rule before it is saved, and only that row', async ({ page, request }) => {
    const s0 = (await state(request)).settings
    const sat = saturday()
    const md = (d: number) => `${sat.month}/${d}(`
    try {
      // the pay day and the billing day on the same Saturday, nothing moved
      expect((await api(request, 'PUT', '/api/settings', { ...s0, payDay: sat.day, billingDay: sat.day, payShift: 'none', transferShift: 'none', billingShift: 'none' })).status).toBe(200)
      await page.goto('/settings/general')
      const row = (id: string) => page.locator('ul.sched > li').filter({ has: page.locator(`#${id}`) })
      const date = (id: string) => row(id).locator('.thism b.num')
      await expect(date('g-pay')).toContainText(md(sat.day))
      await expect(date('g-pay')).not.toHaveClass(/moved/)
      // pick 미룸 on the pay day: its date moves off the weekend, the billing day's stays
      await pick(seg(page, '월급일'), 'after')
      await expect(date('g-pay')).toHaveClass(/moved/)
      await expect(date('g-pay')).not.toContainText(md(sat.day))
      await expect(row('g-pay').locator('.thism')).toContainText('미룸')
      await expect(date('g-bill')).toContainText(md(sat.day))
      await expect(date('g-bill')).not.toHaveClass(/moved/)
      // 앞당김 on the billing day: the Friday before, or earlier when that is a holiday
      await pick(seg(page, '카드 결제일'), 'before')
      await expect(date('g-bill')).toHaveClass(/moved/)
      await expect(date('g-bill')).not.toContainText(md(sat.day))
      // nothing is saved until 저장
      expect(rules((await state(request)).settings)).toEqual(['none', 'none', 'none'])
    } finally {
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
    }
  })

  test('(S-1, V-6) an own monthly date has its own rule on its row: picked, saved with the form and read back; the three dates stay', async ({ page, request }) => {
    const s0 = (await state(request)).settings
    const sat = saturday()
    const name = `${MARK}-own`
    let id = ''
    try {
      // a date in the 0.1.9 shape (no shift): it gets 그대로
      const made = await api(request, 'POST', '/api/schedules', { name, day: sat.day, accountId: null, direction: 'out' })
      expect(made.status).toBe(201)
      id = (made.json as Sched).id
      expect((made.json as Sched).shift).toBe('none')
      await page.goto('/settings/general')
      const row = page.locator('li.own', { hasText: name })
      await shows(seg(page, name), 'none')
      await expect(row.locator('.thism b.num')).not.toHaveClass(/moved/)
      // pick 미룸 on the row: this month's date moves at once, the saved row changes only with 저장
      await pick(seg(page, name), 'after')
      await expect(row.locator('.thism b.num')).toHaveClass(/moved/)
      expect((await state(request)).schedules.find((x) => x.id === id)!.shift).toBe('none')
      await saveForm(page)
      expect((await state(request)).schedules.find((x) => x.id === id)).toMatchObject({ name, day: sat.day, direction: 'out', accountId: null, shift: 'after' })
      expect(rules((await state(request)).settings)).toEqual(rules(s0))
      await page.reload()
      await shows(seg(page, name), 'after')
      await expect(page.locator('li.own', { hasText: name }).locator('.thism b.num')).toHaveClass(/moved/)
      // an update in the 0.1.9 shape (no shift) keeps the saved rule
      expect((await api(request, 'PUT', `/api/schedules/${id}`, { name, day: sat.day, accountId: null, direction: 'in' })).status).toBe(200)
      expect((await state(request)).schedules.find((x) => x.id === id)).toMatchObject({ direction: 'in', shift: 'after' })
    } finally {
      if (id) await api(request, 'DELETE', `/api/schedules/${id}`)
      expect((await state(request)).schedules.some((x) => x.id === id)).toBe(false)
    }
  })

  test('(S-1, V-6) the editor of an own date has the rule: a new date starts at 그대로, a date saved before shows its rule, a change is read back', async ({ page, request }) => {
    const name = `${MARK}-sheet`
    const rule = (title: string) => sheet(page, title).getByRole('group', { name: '주말·공휴일이면', exact: true })
    let id = ''
    try {
      // a date saved before, with 앞당김
      const made = await api(request, 'POST', '/api/schedules', { name, day: 9, accountId: null, direction: 'out', note: 'memo', shift: 'before' })
      expect(made.status).toBe(201)
      id = (made.json as Sched).id
      await page.goto('/settings/general')
      // a new date: 그대로 by default (nothing is saved here)
      await page.getByRole('button', { name: '+ 일정 추가' }).click()
      await shows(rule('기준 일정 추가'), 'none')
      await sheet(page, '기준 일정 추가').getByRole('button', { name: '취소', exact: true }).click()
      // the saved date shows 앞당김; saving the sheet untouched keeps every field
      await page.getByRole('button', { name: `${name} 수정` }).click()
      await shows(rule('기준 일정 수정'), 'before')
      await saveSheet(page, '기준 일정 수정')
      expect((await state(request)).schedules.find((x) => x.id === id)).toMatchObject({ name, day: 9, direction: 'out', accountId: null, note: 'memo', shift: 'before' })
      // changed to 미룸 in the sheet: saved at once (the sheet is its own save), and the row shows it
      await page.getByRole('button', { name: `${name} 수정` }).click()
      await pick(rule('기준 일정 수정'), 'after')
      await saveSheet(page, '기준 일정 수정')
      expect((await state(request)).schedules.find((x) => x.id === id)).toMatchObject({ name, day: 9, direction: 'out', note: 'memo', shift: 'after' })
      await shows(seg(page, name), 'after')
      await expect(form(page).getByRole('button', { name: '저장', exact: true })).toBeDisabled()
      // a rule picked on the row and not saved yet is what the sheet opens with, and saving the sheet saves it
      await pick(seg(page, name), 'none')
      await expect(form(page).getByRole('button', { name: '저장', exact: true })).toBeEnabled()
      await page.getByRole('button', { name: `${name} 수정` }).click()
      await shows(rule('기준 일정 수정'), 'none')
      await saveSheet(page, '기준 일정 수정')
      expect((await state(request)).schedules.find((x) => x.id === id)!.shift).toBe('none')
      await expect(form(page).getByRole('button', { name: '저장', exact: true })).toBeDisabled()
      await page.reload()
      await shows(seg(page, name), 'none')
    } finally {
      if (id) await api(request, 'DELETE', `/api/schedules/${id}`)
    }
  })

  test('(V-6) the rows fit a phone without sideways scrolling, and the English screen names each rule', async ({ page, request }) => {
    const name = `${MARK}-phone`
    const made = await api(request, 'POST', '/api/schedules', { name, day: 12, accountId: null, direction: 'out', shift: 'before' })
    expect(made.status).toBe(201)
    const id = (made.json as Sched).id
    const prefs = (await api(request, 'GET', '/api/state')).json.preferences as Record<string, unknown>
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/settings/general')
      await shows(seg(page, name), 'before')
      for (const n of ['월급일', '분배일', '카드 결제일', name]) await expect(seg(page, n)).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      for (const n of ['월급일', name]) {
        const box = (await seg(page, n).boundingBox())!
        expect(box.x >= 0 && box.x + box.width <= 390, `${n}: the segment is inside the screen`).toBe(true)
      }
      // English
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, language: 'en' })).status).toBe(200)
      await page.reload()
      const en = page.getByRole('group', { name: 'Pay day: if it falls on a weekend or holiday', exact: true })
      await expect(en.getByRole('button')).toHaveText(['Earlier', 'Keep', 'Later'])
      await expect(page.getByRole('group', { name: `${name}: if it falls on a weekend or holiday`, exact: true }).getByRole('button', { name: 'Earlier', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByText('Applies to all three dates.')).toHaveCount(0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    } finally {
      await api(request, 'PUT', '/api/preferences', prefs)
      await api(request, 'DELETE', `/api/schedules/${id}`)
    }
  })
})

// ---------- W-2 the card's usage period ----------
const kst = () => new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' })
const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7)
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`
async function cardsTable(page: Page) {
  await page.goto('/pay')
  await page.getByRole('tab', { name: '통장·생활비·설정' }).click()
  await expect(page.getByRole('heading', { name: '돈의 흐름' })).toBeVisible()
  return page.getByTestId('cards-table')
}
/** The third tab of 월급 분배, where the accounts and the cards are. */
const accountsTab = (page: Page) => page.getByRole('tab', { name: '통장·생활비·설정', exact: true })
const cardOf = async (request: APIRequestContext, id: string) => (await state(request)).cards.find((c) => c.id === id)

test.describe.serial('W-2 the card\'s usage period', () => {
  test('(S-2, V-6) the first day of the usage period: a card saved before has none and stays so; it is set in the editor, shown on the list, read back, changed and cleared', async ({ page, request }) => {
    const s0 = (await state(request)).settings
    const name = `${MARK}-use`
    const ids: string[] = []
    try {
      expect((await api(request, 'PUT', '/api/settings', { ...s0, billingShift: 'none' })).status).toBe(200)
      // a card in the 0.1.9 shape: no usageFrom in the body
      const made = await api(request, 'POST', '/api/cards', { name, last4: '4321', accountId: null, billingDay: 25, note: 'memo' })
      expect(made.status).toBe(201)
      const id = (made.json as CardRow).id
      ids.push(id)
      expect((made.json as CardRow).usageFrom).toBeNull()

      const table = await cardsTable(page)
      const row = () => table.locator('tbody tr').filter({ hasText: name })
      await expect(row()).toContainText('25일')
      await expect(row().getByTestId('card-usage')).toHaveCount(0)
      // the editor shows 정하지 않음; saving it untouched keeps every field
      await row().click()
      let e = sheet(page, '카드 수정')
      await expect(e.locator('#cd-usage')).toContainText('정하지 않음')
      await expect(e.getByTestId('cd-usage-now')).toHaveCount(0)
      await expect(e.getByText('예: 결제일이 25일이면 보통 12일', { exact: false })).toBeVisible()
      // the note tells saved rounds (kept) from a buffer use's card bill date (worked out, so it follows the period) — review 1 finding 2
      await expect(e.getByText('이미 저장된 지출의 회차 날짜는 그대로예요. 다만 버퍼 사용의 카드값 나가는 날은 저장하지 않고 그때마다 계산해서, 저장하면 바로 이 기간을 따라요.', { exact: false })).toBeVisible()
      await saveSheet(page, '카드 수정')
      expect(await cardOf(request, id)).toMatchObject({ name, last4: '4321', accountId: null, billingDay: 25, usageFrom: null, note: 'memo' })

      // set to the 12th: the line under the field names the period of today and its bill before anything is saved
      await row().click()
      e = sheet(page, '카드 수정')
      await choose(e.locator('#cd-usage'), '12')
      const today = kst().slice(0, 10)
      const ym = today.slice(0, 7)
      const start = +today.slice(8) >= 12 ? `${ym}-12` : `${ymAdd(ym, -1)}-12`
      const end = `${ymAdd(start.slice(0, 7), 1)}-11`
      await expect(e.getByTestId('cd-usage-now')).toHaveText(`지금은 ${md(start)}~${md(end)}에 쓴 것이 ${md(`${end.slice(0, 7)}-25`)}에 청구돼요.`)
      expect((await cardOf(request, id))!.usageFrom, 'nothing is saved before 저장').toBeNull()
      await saveSheet(page, '카드 수정')
      expect(await cardOf(request, id)).toMatchObject({ name, last4: '4321', billingDay: 25, usageFrom: 12, note: 'memo' })
      await expect(row().getByTestId('card-usage')).toHaveText('이용 12일~11일')
      // read back after a reload, on the list and in the editor
      const again = await cardsTable(page)
      await expect(again.locator('tbody tr').filter({ hasText: name }).getByTestId('card-usage')).toHaveText('이용 12일~11일')
      await row().click()
      e = sheet(page, '카드 수정')
      await expect(e.locator('#cd-usage')).toContainText('12일')
      await e.getByRole('button', { name: '취소', exact: true }).click()
      await expect(e).toBeHidden()

      // an update in the 0.1.9 shape (no usageFrom) keeps the saved first day
      expect((await api(request, 'PUT', `/api/cards/${id}`, { name, last4: '4321', accountId: null, billingDay: 25, note: 'memo' })).status).toBe(200)
      expect((await cardOf(request, id))!.usageFrom).toBe(12)

      // the 1st is saved as 1 (the calendar month), not as empty
      await row().click()
      await choose(sheet(page, '카드 수정').locator('#cd-usage'), '1')
      await saveSheet(page, '카드 수정')
      expect((await cardOf(request, id))!.usageFrom).toBe(1)
      await expect(row().getByTestId('card-usage')).toHaveText('이용 1일~말일')
      // the 31st, the last option
      await row().click()
      await choose(sheet(page, '카드 수정').locator('#cd-usage'), '31')
      await saveSheet(page, '카드 수정')
      expect((await cardOf(request, id))!.usageFrom).toBe(31)
      await expect(row().getByTestId('card-usage')).toHaveText('이용 31일~30일')
      // cleared again
      await row().click()
      await choose(sheet(page, '카드 수정').locator('#cd-usage'), '')
      await saveSheet(page, '카드 수정')
      expect(await cardOf(request, id)).toMatchObject({ billingDay: 25, usageFrom: null })
      await expect(row().getByTestId('card-usage')).toHaveCount(0)

      // a new card made in the sheet with a first day
      await table.getByRole('button', { name: '+ 카드 추가' }).click()
      const a = sheet(page, '카드 추가')
      await expect(a.locator('#cd-usage')).toContainText('정하지 않음')
      await a.locator('#cd-name').fill(`${name}-new`)
      await choose(a.locator('#cd-day'), '1')
      await choose(a.locator('#cd-usage'), '18')
      await saveSheet(page, '카드 추가')
      const fresh = (await state(request)).cards.find((c) => c.name === `${name}-new`)!
      ids.push(fresh.id)
      expect(fresh).toMatchObject({ billingDay: 1, usageFrom: 18 })
      await expect(table.locator('tbody tr').filter({ hasText: `${name}-new` }).getByTestId('card-usage')).toHaveText('이용 18일~17일')
    } finally {
      for (const id of ids) await api(request, 'DELETE', `/api/cards/${id}`)
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      expect((await state(request)).cards.filter((c) => c.name.startsWith(name))).toHaveLength(0)
    }
  })

  test('(S-2, V-6) a new card spending is billed after the card\'s usage period ends; a card without one bills the month after, as before; a spending saved before keeps its dates', async ({ page, request }) => {
    const s0 = (await state(request)).settings
    const name = `${MARK}-bill`
    const today = kst().slice(0, 10)
    const ym = today.slice(0, 7)
    // From the 2nd on: first day 2, billing day 1. Today is in the period that ends on the 1st of next month, so its bill
    // is the 1st of the month after that. On the 1st: first day 2, billing day 2. The period ends today, the bill is tomorrow.
    const first = +today.slice(8) === 1
    const day = first ? 2 : 1
    const want = first ? `${ym}-02` : `${ymAdd(ym, 2)}-01`
    const asBefore = `${ymAdd(ym, 1)}-${String(day).padStart(2, '0')}`
    const cards: string[] = []
    const spends = async () => (await state(request)).spendings.filter((x) => x.name.startsWith(name))
    const grp = (s: ReturnType<typeof sheet>, n: string) => s.getByRole('group', { name: n, exact: true })
    const next = (s: ReturnType<typeof sheet>) => s.getByRole('button', { name: '다음', exact: true }).click()
    try {
      expect((await api(request, 'PUT', '/api/settings', { ...s0, billingShift: 'none' })).status).toBe(200)
      const plain = await api(request, 'POST', '/api/cards', { name: `${name}-plain`, last4: '', accountId: null, billingDay: day, note: '' })
      const used = await api(request, 'POST', '/api/cards', { name: `${name}-used`, last4: '', accountId: null, billingDay: day, usageFrom: 2, note: '' })
      expect([plain.status, used.status]).toEqual([201, 201])
      cards.push((plain.json as CardRow).id, (used.json as CardRow).id)
      const usedId = (used.json as CardRow).id
      // a spending saved before the card had a usage period: its round is on the date the old rule gave
      const old = await api(request, 'POST', '/api/spendings', {
        name: `${name}-old`, note: '', category: 'etc', bought: today, amount: 7_000, currency: 'KRW', fxRate: null, fxBuffer: null,
        how: 'lump', payBy: 'card', count: 1, fee: 0, interval: null, cancelled: false, cardId: usedId,
        rounds: [{ no: 1, date: asBefore, amount: 7_000, state: 'left', edited: false }],
      })
      expect(old.status).toBe(201)

      await page.goto('/')
      await menu(page, '지출')
      await page.getByRole('button', { name: '지출 추가', exact: true }).click()
      let s = sheet(page, '지출 추가')
      await s.getByLabel('내용', { exact: true }).fill(`${name}-lump`)
      await s.getByLabel('금액', { exact: true }).fill('1000')
      await next(s)
      // a card without a usage period: the billing day of the month after, as before
      await choose(s.locator('#sp-card'), cards[0]!)
      expect(await readDate(grp(s, '청구일'))).toBe(asBefore)
      // the card with one: the first billing date after its period ends
      await choose(s.locator('#sp-card'), usedId)
      expect(await readDate(grp(s, '청구일'))).toBe(want)
      await next(s)
      await saveSheet(page, '지출 추가')
      const lump = (await spends()).find((x) => x.name === `${name}-lump`)!
      expect(lump).toMatchObject({ how: 'lump', payBy: 'card', cardId: usedId })
      expect(lump.rounds.map((r) => r.date)).toEqual([want])

      // an installment: the first round on that bill, then one billing date a month
      await page.getByRole('tablist', { name: '지출 종류' }).getByRole('tab', { name: /^할부/ }).click()
      await page.getByRole('button', { name: '할부 추가', exact: true }).click()
      s = sheet(page, '할부 추가')
      await s.getByLabel('내용', { exact: true }).fill(`${name}-inst`)
      await s.getByLabel('금액', { exact: true }).fill('300000')
      await next(s)
      await grp(s, '할부 개월').getByRole('button', { name: '3개월', exact: true }).click()
      await choose(s.locator('#sp-card'), usedId)
      expect(await readDate(grp(s, '첫 청구일'))).toBe(want)
      await next(s)
      await saveSheet(page, '할부 추가')
      const inst = (await spends()).find((x) => x.name === `${name}-inst`)!
      expect(inst).toMatchObject({ how: 'installment', payBy: 'card', cardId: usedId, count: 3 })
      expect(inst.rounds.map((r) => r.date)).toEqual([0, 1, 2].map((i) => `${ymAdd(want.slice(0, 7), i)}${want.slice(7)}`))

      // the spending saved before keeps the date it was saved with
      expect((await spends()).find((x) => x.name === `${name}-old`)!.rounds.map((r) => r.date)).toEqual([asBefore])
    } finally {
      for (const x of await spends()) await api(request, 'DELETE', `/api/spendings/${x.id}`)
      for (const id of cards) await api(request, 'DELETE', `/api/cards/${id}`)
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      const left = await state(request)
      expect(left.spendings.filter((x) => x.name.startsWith(name))).toHaveLength(0)
      expect(left.cards.filter((c) => c.name.startsWith(name))).toHaveLength(0)
    }
  })

  test('(V-6) the card editor and the card list fit a phone without sideways scrolling, and the English screen names the usage period', async ({ page, request }) => {
    const name = `${MARK}-usep`
    const made = await api(request, 'POST', '/api/cards', { name, last4: '', accountId: null, billingDay: 25, usageFrom: 12, note: '' })
    expect(made.status).toBe(201)
    const id = (made.json as CardRow).id
    const prefs = (await api(request, 'GET', '/api/state')).json.preferences as Record<string, unknown>
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      const table = await cardsTable(page)
      const row = table.locator('tbody tr').filter({ hasText: name })
      await expect(row.getByTestId('card-usage')).toHaveText('이용 12일~11일')
      expect(await fits()).toBe(true)
      await row.click()
      const e = sheet(page, '카드 수정')
      await expect(e.locator('#cd-usage')).toBeVisible()
      await expect(e.getByTestId('cd-usage-now')).toBeVisible()
      const box = (await e.locator('#cd-usage').boundingBox())!
      expect(box.x >= 0 && box.x + box.width <= 390, 'the field is inside the screen').toBe(true)
      expect(await fits()).toBe(true)
      await e.getByRole('button', { name: '취소', exact: true }).click()
      // English
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, language: 'en' })).status).toBe(200)
      await page.reload()
      await page.getByRole('tab', { name: 'Accounts, living costs, settings' }).click()
      const enRow = page.getByTestId('cards-table').locator('tbody tr').filter({ hasText: name })
      await expect(enRow.getByTestId('card-usage')).toHaveText('Used day 12 to 11')
      await enRow.click()
      const en = sheet(page, 'Edit card')
      await expect(en.getByText('First day of the usage period')).toBeVisible()
      await expect(en.getByText('the round dates of saved spendings stay. The card bill date of a buffer use is not saved but worked out each time, so it follows this period as soon as you save.', { exact: false })).toBeVisible()
      await expect(en.getByTestId('cd-usage-now')).toHaveText(/^Right now, what you buy from \d+\/\d+ to \d+\/\d+ is billed on \d+\/\d+\.$/)
      expect(await fits()).toBe(true)
    } finally {
      await api(request, 'PUT', '/api/preferences', prefs)
      await api(request, 'DELETE', `/api/cards/${id}`)
    }
  })
})

// ── W-4: what a month is (spec 018 S-3, S-4) ──
type Extra = { id: string; date: string; name: string; amount: number }
const p2 = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
/** Today in Asia/Seoul (the test account's zone), as a local date. */
const seoulToday = () => new Date(new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' }).replace(' ', 'T'))
/**
 * A pay day that puts today inside a period which does not hold every day of today's calendar month, and a day of today's
 * calendar month outside that period: the day before the pay day, or on the 1st the pay day 2 itself (tomorrow).
 */
function payCase() {
  const now = seoulToday()
  const [y, m, day] = [now.getFullYear(), now.getMonth(), now.getDate()]
  const pay = day === 1 ? 2 : Math.min(day, 28)
  const outside = day === 1 ? new Date(y, m, 2) : new Date(y, m, pay - 1)
  // the pay period that holds today: from the pay day on or before today to the day before the next one
  const start = day >= pay ? new Date(y, m, pay) : new Date(y, m - 1, pay)
  const end = new Date(start.getFullYear(), start.getMonth() + 1, pay - 1)
  const next = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  const ym = (d: Date) => `${d.getFullYear()}.${p2(d.getMonth() + 1)}`
  const span = `${p2(start.getMonth() + 1)}-${p2(start.getDate())}~${p2(end.getMonth() + 1)}-${p2(end.getDate())}`
  const lastDay = new Date(y, m + 1, 0).getDate()
  return {
    pay, outside: iso(outside), span,
    // named after the month it starts in (first day the 15th or earlier), else after the month it ends in
    auto: pay <= 15 ? 'start' as const : 'end' as const,
    startName: ym(start), endName: ym(next),
    calendar: `${ym(now)} · ${p2(m + 1)}-01~${p2(m + 1)}-${p2(lastDay)}`,
    calendarName: ym(now),
  }
}
const basisCard = (page: Page) => page.getByTestId('month-basis')
const basisSeg = (page: Page) => page.getByRole('group', { name: '달의 기준', exact: true })
const namingSeg = (page: Page) => page.getByRole('group', { name: '달 이름', exact: true })
const pressed = (g: Locator, name: string) => expect(g.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true')
/** Pick an option of a 달의 기준 segment, read the question and answer it. */
async function askMonth(page: Page, g: Locator, option: string, want: { before: string; after: string }, answer: '바꾸기' | '취소') {
  await g.getByRole('button', { name: option, exact: true }).click()
  const dlg = page.getByRole('alertdialog')
  await expect(dlg.getByRole('heading', { name: '달의 기준을 바꿀까요?' })).toBeVisible()
  await expect(dlg.getByText('달 이름은 그대로이고, 그 달이 가리키는 날짜가 바뀌어요.')).toBeVisible()
  // what has a date counts by the date, a card bill by the pay before it (spec 018 S-5; review 2 F-6)
  await expect(dlg.getByText('날짜가 있는 것(한 번 들어온 돈, 지출 회차)은 그 날짜가 든 달에 셈하고, 카드 청구 회차만 청구일 바로 앞 월급의 달에 셈해요.', { exact: false })).toBeVisible()
  await expect(dlg.getByTestId('month-before')).toHaveText(want.before)
  await expect(dlg.getByTestId('month-after')).toHaveText(want.after)
  if (answer === '취소') {
    await dlg.getByRole('button', { name: '취소', exact: true }).click()
  } else {
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/settings')
    await dlg.getByRole('button', { name: '바꾸기', exact: true }).click()
    expect((await saved).ok()).toBe(true)
  }
  await expect(dlg).toBeHidden()
}
const amountOf = async (l: Locator) => Number(((await l.textContent()) ?? '').replace(/[^\d]/g, ''))
/** What comes in this month, as the home's 3초 card shows it. */
const homeIn = (page: Page) => page.locator('section.hero .eqc').first().locator('.num.big')
const headerMonth = (page: Page) => page.locator('header.topbar .monthnav .ml')

test.describe.serial('W-4 the month basis', () => {
  test('(S-3, S-4, V-6) the basis is changed after a confirmation that shows this month before and after; the month shows its period and the numbers follow; the calendar puts the screens back', async ({ page, request }) => {
    const c = payCase()
    const st0 = (await api(request, 'GET', '/api/state')).json as State & { preferences: Record<string, unknown> }
    const s0 = st0.settings
    const prefs = st0.preferences
    const name = `${MARK}-mb`
    let extra = ''
    try {
      // the calendar basis, the pay day of the case, ISO dates, and money that came in once on a day of this calendar
      // month that the pay period of today does not hold
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      expect((await api(request, 'PUT', '/api/settings', { ...s0, payDay: c.pay, payShift: 'none', monthBasis: 'calendar', monthBasisCardId: null, monthNaming: 'auto' })).status).toBe(200)
      const made = await api(request, 'POST', '/api/income-extras', { date: c.outside, name, amount: 5_000, note: '' })
      expect(made.status).toBe(201)
      extra = (made.json as Extra).id

      // ── the calendar basis: the month's name alone, as before ──
      await page.goto('/')
      await expect(headerMonth(page)).toHaveText(c.calendarName.replace('.', '. '))
      await expect(page.getByTestId('month-period')).toHaveCount(0)
      await expect(page.getByTestId('home-period')).toHaveCount(0)
      const calIn = await amountOf(homeIn(page))
      expect(calIn).toBeGreaterThanOrEqual(5_000)

      // ── Settings › General › 달의 기준 ──
      await menu(page, '설정')
      await expect(basisCard(page)).toBeVisible()
      await pressed(basisSeg(page), '1일~말일')
      await expect(namingSeg(page)).toHaveCount(0)
      await expect(page.getByTestId('month-preview')).toHaveText(`이번 달: ${c.calendar}`)
      const payName = c.auto === 'start' ? c.startName : c.endName
      const payLine = `${payName} · ${c.span}`
      // cancelled: nothing is saved
      await askMonth(page, basisSeg(page), '월급', { before: c.calendar, after: payLine }, '취소')
      await pressed(basisSeg(page), '1일~말일')
      expect((await state(request)).settings.monthBasis).toBe('calendar')
      // confirmed: saved, and the block shows the new month
      await askMonth(page, basisSeg(page), '월급', { before: c.calendar, after: payLine }, '바꾸기')
      expect((await state(request)).settings).toMatchObject({ monthBasis: 'pay', monthNaming: 'auto', payDay: c.pay })
      await pressed(basisSeg(page), '월급')
      await pressed(namingSeg(page), '자동')
      await expect(basisCard(page)).toContainText(`자동: 시작일이 ${c.pay}일이라 지금은 ${c.auto === 'start' ? '시작하는 달' : '끝나는 달'}이에요.`)
      await expect(page.getByTestId('month-preview')).toHaveText(`이번 달: ${payLine}`)

      // ── the screens: the month with its period, and the money of that period ──
      await menu(page, '현황')
      await expect(headerMonth(page)).toHaveText(`${payName.replace('.', '. ')} · ${c.span}`)
      await expect(page.getByTestId('home-period')).toHaveText(`${c.span} ·`)
      // the money that came in on a day outside the period is not this month's any more
      expect(await amountOf(homeIn(page))).toBe(calIn - 5_000)
      await menu(page, '수입')
      await expect(headerMonth(page)).toHaveText(`${payName.replace('.', '. ')} · ${c.span}`)
      await expect(page.getByTestId('sum-total')).toHaveText(/\d/)
      expect(await amountOf(page.getByTestId('sum-total'))).toBe(calIn - 5_000)
      await expect(page.getByText(name)).toHaveCount(0)
      // 월급 분배 › 월별 시뮬레이션: this month of the basis, with its period
      await menu(page, '월급 분배')
      await page.getByRole('tab', { name: '월별 시뮬레이션' }).click()
      await expect(page.getByRole('heading', { name: new RegExp(`^${payName.replace('.', '\\.')} `) })).toContainText(c.span)
      // 지출: the month's reflection names the same month and period
      await menu(page, '지출')
      await expect(page.locator('#ms-t')).toContainText(`${payName.replace('.', '. ')}`)
      await expect(page.locator('#ms-t')).toContainText(c.span)

      // ── the month's name: the other one of the two; the dates stay, the name changes ──
      await menu(page, '설정')
      const other = c.auto === 'start' ? { word: '끝나는 달', name: c.endName, value: 'end' } : { word: '시작하는 달', name: c.startName, value: 'start' }
      await askMonth(page, namingSeg(page), other.word, { before: payLine, after: `${other.name} · ${c.span}` }, '바꾸기')
      expect((await state(request)).settings).toMatchObject({ monthBasis: 'pay', monthNaming: other.value })
      await pressed(namingSeg(page), other.word)
      await expect(page.getByTestId('month-preview')).toHaveText(`이번 달: ${other.name} · ${c.span}`)
      await menu(page, '현황')
      await expect(headerMonth(page)).toHaveText(`${other.name.replace('.', '. ')} · ${c.span}`)
      // the saved value is read back after a reload
      await page.goto('/settings/general')
      await pressed(basisSeg(page), '월급')
      await pressed(namingSeg(page), other.word)

      // ── back to the calendar: the screens are what they were ──
      await askMonth(page, basisSeg(page), '1일~말일', { before: `${other.name} · ${c.span}`, after: c.calendar }, '바꾸기')
      expect((await state(request)).settings.monthBasis).toBe('calendar')
      await pressed(basisSeg(page), '1일~말일')
      await expect(namingSeg(page)).toHaveCount(0)
      await expect(page.getByTestId('month-preview')).toHaveText(`이번 달: ${c.calendar}`)
      await menu(page, '현황')
      await expect(headerMonth(page)).toHaveText(c.calendarName.replace('.', '. '))
      await expect(page.getByTestId('month-period')).toHaveCount(0)
      await expect(page.getByTestId('home-period')).toHaveCount(0)
      expect(await amountOf(homeIn(page))).toBe(calIn)
      await menu(page, '수입')
      await expect(page.getByText(name).first()).toBeVisible()
      expect(await amountOf(page.getByTestId('sum-total'))).toBe(calIn)
    } finally {
      if (extra) await api(request, 'DELETE', `/api/income-extras/${extra}`)
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })

  test('(S-3, V-6) the card basis: a card is picked; without a first day of its usage period it is the calendar month; with one the month is that period; deleting the card puts the calendar back', async ({ page, request }) => {
    const s0 = (await state(request)).settings
    const prefs = ((await api(request, 'GET', '/api/state')).json as { preferences: Record<string, unknown> }).preferences
    const name = `${MARK}-mbc`
    const c = payCase()
    const made = await api(request, 'POST', '/api/cards', { name, last4: '', accountId: null, billingDay: 25, usageFrom: null, note: '' })
    expect(made.status).toBe(201)
    const card = made.json as CardRow
    let gone = false
    try {
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      expect((await api(request, 'PUT', '/api/settings', { ...s0, monthBasis: 'calendar', monthBasisCardId: null, monthNaming: 'auto' })).status).toBe(200)
      await page.goto('/settings/general')
      // the card has no usage period: the question shows the same month on both sides
      await askMonth(page, basisSeg(page), '카드 집계', { before: c.calendar, after: c.calendar }, '바꾸기')
      const saved = (await state(request)).settings
      expect(saved.monthBasis).toBe('card')
      // the card picked for it: the first card with a usage period, else the first card — a card of this account either way
      const picked = (await state(request)).cards.find((x) => x.id === saved.monthBasisCardId)
      expect(picked, 'a card of the account is the basis card').toBeTruthy()
      // make this run's card the basis card through the select
      if (picked!.id !== card.id) {
        await choose(page.locator('#g-mcard'), card.id)
        const dlg = page.getByRole('alertdialog')
        await expect(dlg.getByTestId('month-after')).toHaveText(c.calendar)
        const put = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/settings')
        await dlg.getByRole('button', { name: '바꾸기', exact: true }).click()
        expect((await put).ok()).toBe(true)
        await expect(dlg).toBeHidden()
      }
      expect((await state(request)).settings).toMatchObject({ monthBasis: 'card', monthBasisCardId: card.id })
      await expect(page.locator('#g-mcard')).toContainText(name)
      await expect(page.getByTestId('month-card-note')).toHaveText('이 카드는 이용 기간 시작일이 비어 있어서 1일~말일과 같아요. 카드에 시작일을 넣으면 그 기간을 써요.')
      await expect(page.getByTestId('month-preview')).toHaveText(`이번 달: ${c.calendar}`)
      await menu(page, '현황')
      await expect(page.getByTestId('month-period')).toHaveCount(0)

      // the card gets a first day: the month is its usage period (the period that holds today, from that day)
      const now = seoulToday()
      const from = now.getDate() === 1 ? 2 : Math.min(now.getDate(), 28)
      expect((await api(request, 'PUT', `/api/cards/${card.id}`, { name, last4: '', accountId: null, billingDay: 25, usageFrom: from, note: '' })).status).toBe(200)
      await page.goto('/settings/general')
      await expect(page.getByTestId('month-card-note')).toHaveCount(0)
      const cardName = c.auto === 'start' ? c.startName : c.endName
      await expect(page.getByTestId('month-preview')).toHaveText(`이번 달: ${cardName} · ${c.span}`)
      await expect(page.locator('#g-mcard')).toContainText(`이용 기간 ${from}일부터`)
      await menu(page, '현황')
      await expect(headerMonth(page)).toHaveText(`${cardName.replace('.', '. ')} · ${c.span}`)

      // the basis card is deleted: the basis is the calendar month again (spec 018 S-12)
      expect((await api(request, 'DELETE', `/api/cards/${card.id}`)).status).toBe(204)
      gone = true
      expect((await state(request)).settings).toMatchObject({ monthBasis: 'calendar', monthBasisCardId: null })
      await page.goto('/settings/general')
      await pressed(basisSeg(page), '1일~말일')
      await expect(page.locator('#g-mcard')).toHaveCount(0)
      await expect(page.getByTestId('month-preview')).toHaveText(`이번 달: ${c.calendar}`)
    } finally {
      if (!gone) await api(request, 'DELETE', `/api/cards/${card.id}`)
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })

  // Review 2 F-2: the saves that move a month's dates outside the three picks of 달의 기준 are asked with the same question.
  test('(S-4) the question is also asked when the pay day or its rule is saved under a pay basis, when the basis card\'s first day of use is saved and when the basis card is deleted; cancelled, nothing changes; a save that leaves the months alone is not asked', async ({ page, request }) => {
    const s0 = (await state(request)).settings
    const prefs = ((await api(request, 'GET', '/api/state')).json as { preferences: Record<string, unknown> }).preferences
    const name = `${MARK}-mq`
    const made = await api(request, 'POST', '/api/cards', { name, last4: '', accountId: null, billingDay: 25, usageFrom: 12, note: '' })
    expect(made.status).toBe(201)
    const card = made.json as CardRow
    let gone = false
    const dlg = page.getByRole('alertdialog')
    /** The open question: its words and the two lines; then the answer. */
    async function answer(before: RegExp, after: RegExp, how: '바꾸기' | '취소') {
      await expect(dlg.getByRole('heading', { name: '달의 기준을 바꿀까요?' })).toBeVisible()
      await expect(dlg.getByText('달 이름은 그대로이고, 그 달이 가리키는 날짜가 바뀌어요.')).toBeVisible()
      await expect(dlg.getByTestId('month-before')).toHaveText(before)
      await expect(dlg.getByTestId('month-after')).toHaveText(after)
      await dlg.getByRole('button', { name: how, exact: true }).click()
      await expect(dlg).toBeHidden()
    }
    const days = (x: Settings) => [x.payDay, x.transferDay, x.billingDay, x.payShift]
    try {
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      // ── a pay basis: pay day 10, no rule
      expect((await api(request, 'PUT', '/api/settings', { ...s0, payDay: 10, transferDay: 11, billingDay: 14, payShift: 'none', monthBasis: 'pay', monthBasisCardId: null, monthNaming: 'auto' })).status).toBe(200)
      await page.goto('/settings/general')
      const pay = form(page).getByRole('spinbutton', { name: '월급일', exact: true })
      const transfer = form(page).getByRole('spinbutton', { name: '분배일', exact: true })
      // the transfer day is no part of a pay month: saved without a question
      await transfer.fill('12')
      await saveForm(page)
      await expect(dlg).toHaveCount(0)
      expect(days((await state(request)).settings)).toEqual([10, 12, 14, 'none'])
      // the pay day: asked; cancelled, nothing is saved and the draft stays as typed
      await pay.fill('20')
      await form(page).getByRole('button', { name: '저장', exact: true }).click()
      await answer(/^\d{4}\.\d{2} · \d{2}-10~\d{2}-09$/, /^\d{4}\.\d{2} · \d{2}-20~\d{2}-19$/, '취소')
      expect(days((await state(request)).settings)).toEqual([10, 12, 14, 'none'])
      await expect(pay).toHaveValue('20')
      await expect(page.getByTestId('month-preview')).toHaveText(/-10~\d{2}-09$/)
      // confirmed: saved, and the month block follows
      await form(page).getByRole('button', { name: '저장', exact: true }).click()
      await answer(/-10~\d{2}-09$/, /-20~\d{2}-19$/, '바꾸기')
      await expect(form(page).getByRole('status')).toHaveText('저장했어요.')
      expect(days((await state(request)).settings)).toEqual([20, 12, 14, 'none'])
      await expect(page.getByTestId('month-preview')).toHaveText(/-20~\d{2}-19$/)
      // the pay date's rule alone is asked too
      await pick(seg(page, '월급일'), 'before')
      await form(page).getByRole('button', { name: '저장', exact: true }).click()
      await answer(/^\d{4}\.\d{2} · /, /^\d{4}\.\d{2} · /, '바꾸기')
      await expect(form(page).getByRole('status')).toHaveText('저장했어요.')
      expect(days((await state(request)).settings)).toEqual([20, 12, 14, 'before'])

      // ── a card basis on this run's card (first day of use 12)
      expect((await api(request, 'PUT', '/api/settings', { ...s0, payShift: 'none', monthBasis: 'card', monthBasisCardId: card.id, monthNaming: 'auto' })).status).toBe(200)
      const table = await cardsTable(page)
      const row = () => table.locator('tbody tr').filter({ hasText: name })
      // a save that leaves the first day of use alone is not asked
      await row().click()
      let e = sheet(page, '카드 수정')
      await e.locator('#cd-note').fill('memo')
      await saveSheet(page, '카드 수정')
      await expect(dlg).toHaveCount(0)
      expect(await cardOf(request, card.id)).toMatchObject({ usageFrom: 12, note: 'memo' })
      // the first day of use: asked; cancelled, the card is as saved and the editor is still open
      await row().click()
      e = sheet(page, '카드 수정')
      await choose(e.locator('#cd-usage'), '20')
      await e.getByRole('button', { name: '저장', exact: true }).click()
      await answer(/-12~\d{2}-11$/, /-20~\d{2}-19$/, '취소')
      await expect(e).toBeVisible()
      expect((await cardOf(request, card.id))!.usageFrom).toBe(12)
      await e.getByRole('button', { name: '저장', exact: true }).click()
      await answer(/-12~\d{2}-11$/, /-20~\d{2}-19$/, '바꾸기')
      await expect(e).toBeHidden()
      await expect.poll(async () => (await cardOf(request, card.id))!.usageFrom).toBe(20)
      // The page was made again when the basis changed (A-6): it is still on the tab the user was on (A-41), with no
      // reload and no click on the tab.
      await expect(accountsTab(page)).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('heading', { name: '돈의 흐름' })).toBeVisible()
      await expect(row().getByTestId('card-usage')).toHaveText('이용 20일~19일')
      // deleting the basis card: the delete question, then this one (the basis goes back to the calendar month)
      await row().click()
      e = sheet(page, '카드 수정')
      await e.getByRole('button', { name: '삭제', exact: true }).click()
      await dlg.getByRole('button', { name: '삭제', exact: true }).click()
      await answer(/-20~\d{2}-19$/, /-01~\d{2}-(28|29|30|31)$/, '취소')
      await expect(e).toBeVisible()
      expect(await cardOf(request, card.id), 'the card is still there').toBeTruthy()
      expect((await state(request)).settings).toMatchObject({ monthBasis: 'card', monthBasisCardId: card.id })
      await e.getByRole('button', { name: '삭제', exact: true }).click()
      await dlg.getByRole('button', { name: '삭제', exact: true }).click()
      await answer(/-20~\d{2}-19$/, /-01~\d{2}-(28|29|30|31)$/, '바꾸기')
      await expect(e).toBeHidden()
      await expect.poll(async () => (await cardOf(request, card.id)) ?? null).toBeNull()
      gone = true
      // made again once more (the calendar month is back): the same tab still, and the card is off the list
      await expect(accountsTab(page)).toHaveAttribute('aria-selected', 'true')
      await expect(page.getByRole('heading', { name: '돈의 흐름' })).toBeVisible()
      await expect(row()).toHaveCount(0)
      expect((await state(request)).settings).toMatchObject({ monthBasis: 'calendar', monthBasisCardId: null })
    } finally {
      if (!gone) await api(request, 'DELETE', `/api/cards/${card.id}`)
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })

  // Report 13 point 9 (A-41): 월급 분배 is made again when the month basis changes (A-6). Made again under the user's hands
  // — the basis card deleted on its own third tab — it stays on that tab; made again while another page is on screen, it
  // starts on its first tab as before.
  test('(A-6, A-41) 월급 분배 keeps the tab the user was on when a save on it changes what a month is, also when the page that comes back is one kept from the calendar basis; changed from the settings, it opens on its first tab', async ({ page, request }) => {
    const s0 = (await state(request)).settings
    const prefs = ((await api(request, 'GET', '/api/state')).json as { preferences: Record<string, unknown> }).preferences
    const name = `${MARK}-tab`
    const made = await api(request, 'POST', '/api/cards', { name, last4: '', accountId: null, billingDay: 25, usageFrom: 12, note: '' })
    expect(made.status).toBe(201)
    const card = made.json as CardRow
    let gone = false
    const dlg = page.getByRole('alertdialog')
    const tabOf = (label: string) => page.getByRole('tab', { name: label, exact: true })
    /** Answer the month question with 바꾸기 and wait for the settings to be saved. */
    async function confirmMonth() {
      await expect(dlg.getByRole('heading', { name: '달의 기준을 바꿀까요?' })).toBeVisible()
      const put = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/settings')
      await dlg.getByRole('button', { name: '바꾸기', exact: true }).click()
      expect((await put).ok()).toBe(true)
      await expect(dlg).toBeHidden()
    }
    try {
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      expect((await api(request, 'PUT', '/api/settings', { ...s0, monthBasis: 'calendar', monthBasisCardId: null, monthNaming: 'auto' })).status).toBe(200)
      // the page of the calendar basis, left on its second tab: it is kept while the app stays open
      await page.goto('/pay')
      await tabOf('월별 시뮬레이션').click()
      await expect(tabOf('월별 시뮬레이션')).toHaveAttribute('aria-selected', 'true')
      // the basis becomes this run's card, in the settings (no page load from here on)
      await menu(page, '설정')
      await basisSeg(page).getByRole('button', { name: '카드 집계', exact: true }).click()
      await confirmMonth()
      if ((await state(request)).settings.monthBasisCardId !== card.id) {
        await choose(page.locator('#g-mcard'), card.id)
        await confirmMonth()
      }
      expect((await state(request)).settings).toMatchObject({ monthBasis: 'card', monthBasisCardId: card.id })
      // made again while the settings were on screen: the first tab, as before
      await menu(page, '월급 분배')
      await expect(tabOf('구간')).toHaveAttribute('aria-selected', 'true')
      // the third tab; the basis card is deleted there, so the calendar month is back and with it the page kept above
      await accountsTab(page).click()
      const row = () => page.getByTestId('cards-table').locator('tbody tr').filter({ hasText: name })
      await row().click()
      const e = sheet(page, '카드 수정')
      await e.getByRole('button', { name: '삭제', exact: true }).click()
      await dlg.getByRole('button', { name: '삭제', exact: true }).click()
      await expect(dlg.getByRole('heading', { name: '달의 기준을 바꿀까요?' })).toBeVisible()
      await dlg.getByRole('button', { name: '바꾸기', exact: true }).click()
      await expect(dlg).toBeHidden()
      await expect.poll(async () => (await cardOf(request, card.id)) ?? null).toBeNull()
      gone = true
      expect((await state(request)).settings).toMatchObject({ monthBasis: 'calendar', monthBasisCardId: null })
      // the tab the user was on, not the first one and not the one the kept page was left on
      await expect(accountsTab(page)).toHaveAttribute('aria-selected', 'true')
      await expect(tabOf('월별 시뮬레이션')).toHaveAttribute('aria-selected', 'false')
      await expect(page.getByRole('heading', { name: '돈의 흐름' })).toBeVisible()
      await expect(row()).toHaveCount(0)
      // a tab picked afterwards is the page's own again: leaving and coming back keeps it (KeepAlive, as before)
      await tabOf('구간').click()
      await menu(page, '현황')
      await menu(page, '월급 분배')
      await expect(tabOf('구간')).toHaveAttribute('aria-selected', 'true')
    } finally {
      if (!gone) await api(request, 'DELETE', `/api/cards/${card.id}`)
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })

  // Review 2 F-7: two places that named a month without saying which dates it stands for, or by the wrong calendar.
  test('(S-3) under a pay basis a new event starts on today\'s calendar month, and the account sheet\'s forecast shows each month\'s period; with the calendar basis the forecast has none', async ({ page, request }) => {
    const s0 = (await state(request)).settings
    const prefs = ((await api(request, 'GET', '/api/state')).json as { preferences: Record<string, unknown> }).preferences
    const accName = `${MARK}-mf`
    const now = seoulToday()
    const calendar = `${now.getFullYear()}-${p2(now.getMonth() + 1)}`
    // pay day 1, named after the month the period ends in: today's period is named after the next calendar month
    const named = iso(new Date(now.getFullYear(), now.getMonth() + 1, 1)).slice(0, 7)
    const acc = (await api(request, 'POST', '/api/accounts', { name: accName, role: '', inflow: '', outflow: '' })).json as { id: string }
    try {
      expect((await api(request, 'POST', '/api/balances', { accountId: acc.id, date: iso(now), amount: 1_000_000, note: '' })).status).toBe(201)
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      expect((await api(request, 'PUT', '/api/settings', { ...s0, payDay: 1, payShift: 'none', monthBasis: 'pay', monthBasisCardId: null, monthNaming: 'end' })).status).toBe(200)
      // this month by the basis is the next calendar month's name
      await page.goto('/')
      await expect(headerMonth(page)).toContainText(named.replace('-', '. '))
      // a new event: the calendar month of today, where the events' calendar puts it
      await page.goto('/events')
      await page.getByRole('button', { name: '이벤트 추가' }).click()
      const ev = sheet(page, '이벤트 추가')
      await expect(ev.getByRole('textbox', { name: '월', exact: true })).toHaveValue(calendar)
      await ev.getByRole('button', { name: '취소', exact: true }).click()
      // the forecast: twelve months from this month, each with its dates (the 1st to the last day of the month before its name)
      await page.goto('/pay')
      await page.getByRole('tab', { name: '통장·생활비·설정' }).click()
      await page.getByTestId('accounts-table').locator('tbody tr', { hasText: accName }).click()
      const rows = sheet(page, accName).getByTestId('account-forecast').locator('tbody tr')
      await expect(rows).toHaveCount(12)
      const periods = rows.getByTestId('forecast-period')
      await expect(periods).toHaveCount(12)
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      await expect(rows.first().locator('td').first()).toContainText(named.replace('-', '.'))
      await expect(periods.first()).toHaveText(`${p2(now.getMonth() + 1)}-01~${p2(now.getMonth() + 1)}-${p2(last)}`)
      await page.setViewportSize({ width: 390, height: 844 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no sideways scrolling on a phone').toBe(true)
      await page.setViewportSize({ width: 1440, height: 900 })
      // the calendar basis: the table is as it was, and a new event still starts on the calendar month
      expect((await api(request, 'PUT', '/api/settings', { ...s0, monthBasis: 'calendar', monthBasisCardId: null })).status).toBe(200)
      await page.goto('/pay')
      await page.getByRole('tab', { name: '통장·생활비·설정' }).click()
      await page.getByTestId('accounts-table').locator('tbody tr', { hasText: accName }).click()
      await expect(sheet(page, accName).getByTestId('account-forecast').locator('tbody tr')).toHaveCount(12)
      await expect(sheet(page, accName).getByTestId('forecast-period')).toHaveCount(0)
      await page.goto('/events')
      await page.getByRole('button', { name: '이벤트 추가' }).click()
      await expect(sheet(page, '이벤트 추가').getByRole('textbox', { name: '월', exact: true })).toHaveValue(calendar)
    } finally {
      await api(request, 'DELETE', `/api/accounts/${acc.id}`)
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })

  test('(V-6) on a phone the month bar shows the period without sideways scrolling, and the English screen words the block and the question', async ({ page, request }) => {
    const c = payCase()
    const s0 = (await state(request)).settings
    const prefs = ((await api(request, 'GET', '/api/state')).json as { preferences: Record<string, unknown> }).preferences
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    try {
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'us', language: 'ko' })).status).toBe(200)
      expect((await api(request, 'PUT', '/api/settings', { ...s0, payDay: c.pay, payShift: 'none', monthBasis: 'pay', monthBasisCardId: null, monthNaming: 'auto' })).status).toBe(200)
      await page.setViewportSize({ width: 390, height: 844 })
      // the period in the user's date format (MM/DD)
      const us = c.span.replace(/-/g, '/')
      await page.goto('/')
      await expect(page.getByTestId('month-period-phone')).toHaveText(`${us} ·`)
      expect(await fits()).toBe(true)
      await page.goto('/income')
      await expect(page.getByTestId('month-period-phone')).toHaveText(`${us} ·`)
      expect(await fits()).toBe(true)
      await page.goto('/settings/general')
      await expect(basisCard(page)).toBeVisible()
      await expect(page.getByTestId('month-preview')).toContainText(us)
      expect(await fits()).toBe(true)
      await namingSeg(page).getByRole('button', { name: c.auto === 'start' ? '끝나는 달' : '시작하는 달', exact: true }).click()
      const dlg = page.getByRole('alertdialog')
      await expect(dlg.getByTestId('month-after')).toContainText(us)
      const box = (await dlg.boundingBox())!
      expect(box.x >= 0 && box.x + box.width <= 390, 'the question is inside the screen').toBe(true)
      expect(await fits()).toBe(true)
      await dlg.getByRole('button', { name: '취소', exact: true }).click()
      await expect(dlg).toBeHidden()

      // English
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'us', language: 'en' })).status).toBe(200)
      await page.reload()
      const en = page.getByTestId('month-basis')
      await expect(page.getByRole('heading', { name: 'What a month is', exact: true })).toBeVisible()
      const enBasis = page.getByRole('group', { name: 'What a month is', exact: true })
      await expect(enBasis.getByRole('button', { name: 'Pay date', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(en).toContainText(`Auto: the first day is ${c.pay}, so now it is: ${c.auto === 'start' ? 'Start month' : 'End month'}.`)
      await expect(page.getByTestId('month-preview')).toHaveText(new RegExp(`^This month: \\d{4}\\.\\d{2} · ${us}$`))
      await enBasis.getByRole('button', { name: '1st to last day', exact: true }).click()
      const ask = page.getByRole('alertdialog')
      await expect(ask.getByRole('heading', { name: 'Change what a month is?' })).toBeVisible()
      await expect(ask.getByText('Month names stay as they are; the dates each one stands for change.')).toBeVisible()
      await expect(ask.getByText('counts in the month that holds the date; only a card bill counts in the month of the pay before it.', { exact: false })).toBeVisible()
      await expect(ask.getByText('This month now')).toBeVisible()
      await expect(ask.getByText('This month after')).toBeVisible()
      expect(await fits()).toBe(true)
      await ask.getByRole('button', { name: 'Cancel', exact: true }).click()
      expect((await state(request)).settings.monthBasis).toBe('pay')
    } finally {
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })
})

// ---------- W-5: the month a card bill counts in, and the transfers to the paying accounts ----------
type Money = { id: string }
/**
 * The dates of the case, from today (Asia/Seoul). With the pay day and the transfer day on the 1st and no weekend rule,
 * a card bill dated on the 1st of next month is paid with this month's pay (a bill on a pay date goes with the pay
 * before), and one dated on the 2nd with next month's — on any day the test runs.
 */
function billCase() {
  const now = seoulToday()
  const [y, m] = [now.getFullYear(), now.getMonth()]
  const ym = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}`
  const month = (d: Date, lang: 'ko' | 'en') => d.toLocaleString(lang === 'en' ? 'en-US' : 'ko-KR', { month: 'short' })
  const [here, next] = [new Date(y, m, 1), new Date(y, m + 1, 1)]
  return {
    ym: ym(here), nextYm: ym(next), first: iso(here), prevLast: iso(new Date(y, m, 0)),
    next1: iso(next), next2: iso(new Date(y, m + 1, 2)), after1: iso(new Date(y, m + 2, 1)),
    ko: month(here, 'ko'), nextKo: month(next, 'ko'), en: month(here, 'en'),
  }
}
const stripOut = (page: Page) => page.getByTestId('strip-out')
const payout = (page: Page, account: string) => page.getByTestId('payouts').locator(`li[data-account="${account}"]`)
const part = (page: Page, account: string, key: 'subscriptions' | 'card' | 'refill' | 'total') => payout(page, account).locator(`[data-part="${key}"] dd`)
async function simTab(page: Page) {
  await page.goto('/pay?tab=sim')
  await expect(page.getByRole('tab', { name: '월별 시뮬레이션' })).toHaveAttribute('aria-selected', 'true')
}
/** The account sheet's forecast rows: month, in, out, end. */
async function forecastOf(page: Page, title: string) {
  const rows = sheet(page, title).getByTestId('account-forecast').locator('tbody tr')
  await expect(rows).toHaveCount(12)
  return Promise.all((await rows.all()).map(async (r) => {
    const td = r.locator('td')
    const cell = async (i: number) => { const x = (await td.nth(i).innerText()).trim(); return x === '—' ? 0 : Number(x.replace(/[^\d]/g, '')) }
    return { ym: (await td.nth(0).innerText()).trim().slice(0, 7).replace('.', '-'), inflow: await cell(1), outflow: await cell(2), end: await cell(3) }
  }))
}

test.describe.serial('W-5 the month a card bill counts in and the paying accounts', () => {
  test('(S-5, S-6, V-6) the paying-account block, the spending strip and the account forecast show the same money; a bill paid with an earlier pay says which month\'s allocation pays it', async ({ page, request }) => {
    const c = billCase()
    const st0 = (await api(request, 'GET', '/api/state')).json as State & { preferences: Record<string, unknown> }
    const s0 = st0.settings
    const prefs = st0.preferences
    const name = `${MARK}-w5`
    const accName = `${name}-acc`
    const made: [string, string][] = []
    const post = async (path: string, body: unknown) => {
      const r = await api(request, 'POST', path, body)
      expect(r.status, `${path} ${JSON.stringify(r.json)}`).toBe(201)
      made.unshift([path, (r.json as Money).id])
      return (r.json as Money).id
    }
    const spend = (suffix: string, over: Record<string, unknown>, rounds: [string, number][]) => post('/api/spendings', {
      name: `${name}-${suffix}`, note: '', category: 'etc', bought: c.first, amount: rounds.reduce((a, r) => a + r[1], 0), currency: 'KRW', fxRate: null, fxBuffer: null,
      how: 'lump', payBy: 'card', count: 1, fee: 0, interval: null, cancelled: false, refillFrom: null, ...over,
      rounds: rounds.map(([date, amount], i) => ({ no: i + 1, date, amount, state: 'left', edited: false })),
    })
    try {
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      expect((await api(request, 'PUT', '/api/settings', {
        ...s0, payDay: 1, transferDay: 1, payShift: 'none', transferShift: 'none', billingShift: 'none', monthBasis: 'calendar', monthBasisCardId: null, monthNaming: 'auto',
      })).status).toBe(200)
      // what the strip shows before this test's spendings (other rows of the account may count this month)
      await page.goto('/spend/general')
      await expect(stripOut(page)).toHaveText(/\d/)
      const base = await amountOf(stripOut(page))

      // an account no target sends to, a card paid from it, and a balance record of the last day of last month
      const accountId = await post('/api/accounts', { name: accName, role: '', inflow: '', outflow: '', buffer: 500_000 })
      const cardId = await post('/api/cards', { name: `${name}-card`, last4: '', accountId, billingDay: null, note: '' })
      await post('/api/balances', { accountId, date: c.prevLast, amount: 1_000_000, note: '' })
      // a lump sum billed on the 1st of next month (this month's pay pays it): 123,000
      const lumpId = await spend('lump', { cardId }, [[c.next1, 123_000]])
      // an installment billed on the 1st of the next two months: 30,000 each — this month's and next month's
      await spend('inst', { how: 'installment', count: 2, cardId }, [[c.next1, 30_000], [c.after1, 30_000]])
      // a buffer use refilled on the 1st of this month: 20,000 (its own bill leaves the buffer next month)
      await spend('buf', { how: 'buffer', cardId, refillFrom: c.first }, [[c.first, 20_000]])
      const CARD = 153_000
      const REFILL = 20_000
      const TOTAL = CARD + REFILL

      // ── 지출: the strip, and the row that says which month's allocation pays the bill ──
      await page.goto('/spend/general')
      await expect(stripOut(page)).toHaveText(new RegExp(`${(base + TOTAL).toLocaleString('ko-KR')}`))
      const row = page.locator('table.gen-t tbody tr', { hasText: `${name}-lump` })
      const cell = row.locator('td[data-paid-in]')
      await expect(cell).toHaveAttribute('data-paid-in', c.ym)
      await expect(cell.locator('.blk')).toHaveText(c.ko)
      await expect(cell).toContainText(`${md(c.next1)} 청구 · ${c.ko} 분배에서 냄`)
      // 할부: each round under its date; the refill of this month's 1st counts by its own date and says nothing
      await page.goto('/spend/inst')
      const item = (n: string) => page.getByRole('list', { name: '할부 목록' }).getByRole('button', { name: new RegExp(n) })
      await item(`${name}-inst`).click()
      const dates = page.locator('table.rt tbody td.dt')
      await expect(dates).toHaveCount(2)
      await expect(dates.nth(0)).toContainText(c.next1)
      await expect(dates.nth(0)).toContainText(`${c.ko} 분배에서 냄`)
      await expect(dates.nth(0)).toHaveAttribute('data-paid-in', c.ym)
      // the bill of the 1st of the month after next is paid with next month's pay
      await expect(dates.nth(1)).toContainText(`${c.nextKo} 분배에서 냄`)
      await expect(dates.nth(1)).toHaveAttribute('data-paid-in', c.nextYm)
      await item(`${name}-buf`).click()
      await expect(dates).toHaveCount(1)
      await expect(dates.first()).toContainText(c.first)
      await expect(page.locator('table.rt tbody td.dt[data-paid-in]')).toHaveCount(0)

      // ── 월급 분배 › 월별 시뮬레이션 › 대금 계좌 이체 ──
      await simTab(page)
      await expect(page.getByTestId('payouts').getByRole('heading', { name: '대금 계좌 이체', exact: true })).toBeVisible()
      await expect(payout(page, accName)).toHaveCount(1)
      expect(await amountOf(part(page, accName, 'card'))).toBe(CARD)
      expect(await amountOf(part(page, accName, 'refill'))).toBe(REFILL)
      expect(await amountOf(part(page, accName, 'total'))).toBe(TOTAL)
      await expect(payout(page, accName).locator('dt')).toHaveText(['카드 지출', '버퍼 채우기', '합계'])
      // no subscription goes to this account: that row is left out
      await expect(part(page, accName, 'subscriptions')).toHaveCount(0)
      // next month counts the installment's second bill only
      const monthNav = page.getByRole('group', { name: '달 선택', exact: true })
      await monthNav.getByRole('button', { name: '다음 달', exact: true }).click()
      await expect(part(page, accName, 'total')).toHaveText(/30,000/)
      expect(await amountOf(part(page, accName, 'card'))).toBe(30_000)
      await expect(part(page, accName, 'refill')).toHaveCount(0)
      await monthNav.getByRole('button', { name: '이전 달', exact: true }).click()
      await expect(part(page, accName, 'refill')).toHaveCount(1)
      expect(await amountOf(part(page, accName, 'total'))).toBe(TOTAL)

      // ── the accounts table and the account sheet: the same money comes into the paying account this month ──
      await page.getByRole('tab', { name: '통장·생활비·설정' }).click()
      const accRow = page.getByTestId('accounts-table').locator('tbody tr', { hasText: accName })
      expect(await amountOf(accRow.locator('td.amt'))).toBe(TOTAL)
      await accRow.click()
      const rows = await forecastOf(page, accName)
      // the note under the table: the account that takes the left over is no exception any more (review 3 F-1)
      await expect(sheet(page, accName).getByTestId('account-forecast')).toContainText('이 통장에서 내는 카드값은 그 달 분배일에 들어오고 청구일에 나가요(여유를 받는 통장도 같아요: 여유와 따로 들어와요)')
      // this month: the card rounds come in with the transfer of the 1st and the refill on the 1st; nothing leaves yet
      expect(rows[0]).toEqual({ ym: c.ym, inflow: TOTAL, outflow: 0, end: 1_000_000 + TOTAL })
      // next month: 30,000 in for the second bill; out go the two bills of the 1st (153,000) and the buffer use's own bill (20,000)
      expect(rows[1]).toEqual({ ym: c.nextYm, inflow: 30_000, outflow: 173_000, end: 1_030_000 })
      // the month after: the second bill leaves, and the balance is back where it started
      expect(rows[2]).toMatchObject({ inflow: 0, outflow: 30_000, end: 1_000_000 })
      // one number: the block's sum, what the strip gained and the forecast's money in
      expect(rows[0]!.inflow).toBe(TOTAL)
      await sheet(page, accName).getByRole('button', { name: '닫기', exact: true }).last().click()
      await expect(sheet(page, accName)).toHaveCount(0)

      // ── a bill of the day after the pay day is next month's: it leaves this month's block and strip, and its row says nothing ──
      const lump = (await state(request)).spendings.find((x) => x.id === lumpId)!
      const moved = await api(request, 'PUT', `/api/spendings/${lumpId}`, { ...lump, id: undefined, rounds: [{ ...lump.rounds[0]!, date: c.next2 }] })
      expect(moved.status, JSON.stringify(moved.json)).toBe(200)
      await simTab(page)
      expect(await amountOf(part(page, accName, 'card'))).toBe(30_000)
      expect(await amountOf(part(page, accName, 'total'))).toBe(30_000 + REFILL)
      await page.goto('/spend/general')
      await expect(stripOut(page)).toHaveText(new RegExp(`${(base + 30_000 + REFILL).toLocaleString('ko-KR')}`))
      const after = page.locator('table.gen-t tbody tr', { hasText: `${name}-lump` })
      await expect(after.locator('td[data-paid-in]')).toHaveCount(0)
      await expect(after).toContainText(`${md(c.next2)} 청구 · 여유에서`)
      await expect(after.locator('.blk')).toHaveText(c.nextKo)
    } finally {
      for (const [path, id] of made) await api(request, 'DELETE', `${path}/${id}`)
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })

  test('(V-6) on a phone the paying-account block and the spending cards fit without sideways scrolling, and the English screen words them', async ({ page, request }) => {
    const c = billCase()
    const st0 = (await api(request, 'GET', '/api/state')).json as State & { preferences: Record<string, unknown> }
    const s0 = st0.settings
    const prefs = st0.preferences
    const name = `${MARK}-w5p`
    const accName = `${name}-acc`
    const made: [string, string][] = []
    const post = async (path: string, body: unknown) => {
      const r = await api(request, 'POST', path, body)
      expect(r.status, `${path} ${JSON.stringify(r.json)}`).toBe(201)
      made.unshift([path, (r.json as Money).id])
      return (r.json as Money).id
    }
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    try {
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      expect((await api(request, 'PUT', '/api/settings', {
        ...s0, payDay: 1, transferDay: 1, payShift: 'none', transferShift: 'none', billingShift: 'none', monthBasis: 'calendar', monthBasisCardId: null, monthNaming: 'auto',
      })).status).toBe(200)
      const accountId = await post('/api/accounts', { name: accName, role: '', inflow: '', outflow: '', buffer: 500_000 })
      const cardId = await post('/api/cards', { name: `${name}-card`, last4: '', accountId, billingDay: null, note: '' })
      const body = (suffix: string, over: Record<string, unknown>, date: string, amount: number) => ({
        name: `${name}-${suffix}`, note: '', category: 'etc', bought: c.first, amount, currency: 'KRW', fxRate: null, fxBuffer: null,
        how: 'lump', payBy: 'card', count: 1, fee: 0, interval: null, cancelled: false, cardId, refillFrom: null, ...over,
        rounds: [{ no: 1, date, amount, state: 'left', edited: false }],
      })
      await post('/api/spendings', body('lump', {}, c.next1, 1_234_000))
      await post('/api/spendings', body('buf', { how: 'buffer', refillFrom: c.first }, c.first, 20_000))

      await page.setViewportSize({ width: 390, height: 844 })
      await simTab(page)
      await expect(payout(page, accName)).toBeVisible()
      expect(await amountOf(part(page, accName, 'total'))).toBe(1_254_000)
      const box = (await page.getByTestId('payouts').boundingBox())!
      expect(box.x >= 0 && box.x + box.width <= 390, 'the block is inside the screen').toBe(true)
      expect(await fits()).toBe(true)
      // the phone's card of the lump sum names the month whose allocation pays it
      await page.goto('/spend/general')
      const card = page.locator('ul.mlist li', { hasText: `${name}-lump` })
      await expect(card).toContainText(`${c.ko} 분배에서 냄`)
      expect(await fits()).toBe(true)

      // English
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'en' })).status).toBe(200)
      await page.goto('/spend/general')
      await expect(page.locator('ul.mlist li', { hasText: `${name}-lump` })).toContainText(`Paid from ${c.en}'s allocation`)
      expect(await fits()).toBe(true)
      await page.goto('/pay?tab=sim')
      await expect(page.getByTestId('payouts').getByRole('heading', { name: 'Transfers to paying accounts', exact: true })).toBeVisible()
      await expect(payout(page, accName).locator('dt')).toHaveText(['Card spending', 'Buffer refill', 'Total'])
      await expect(page.getByTestId('payouts')).toContainText('already off the left over above')
      expect(await fits()).toBe(true)
    } finally {
      for (const [path, id] of made) await api(request, 'DELETE', `${path}/${id}`)
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })
})

test.describe.serial('W-6 a charge uses the plan in force on its own date', () => {
  test('(S-7, V-6) 결제 예정: a plan change and a cancellation dated the day after a charge leave that charge as it was, and the next charge has the new plan; the change editor says so in both languages', async ({ page, request }) => {
    const st0 = (await api(request, 'GET', '/api/state')).json as State & { preferences: Record<string, unknown> }
    const prefs = st0.preferences
    const p2 = (n: number) => String(n).padStart(2, '0')
    const iso = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
    const now = new Date(new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' }).replace(' ', 'T'))
    const today = iso(now)
    const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
    const [upName, endName] = [`${MARK}-w6-up`, `${MARK}-w6-end`]
    const subs: string[] = []
    const sub = async (name: string, plan: string, amount: number) => {
      const r = await api(request, 'POST', '/api/subscriptions', { name, category: 'tool', plan, amount, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: today, path: 'direct', verified: false })
      expect(r.status, JSON.stringify(r.json)).toBe(201)
      subs.push((r.json as { id: string }).id)
      return (r.json as { id: string }).id
    }
    const change = async (subId: string, to: Record<string, unknown>) =>
      expect((await api(request, 'POST', '/api/plan-changes', { subId, effective: tomorrow, to, note: '' })).status).toBe(201)
    try {
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      // both are charged today. Tomorrow one moves to a dearer plan and the other is cancelled.
      await change(await sub(upName, '기본요금', 11_000), { plan: '상위요금', amount: 33_000 })
      await change(await sub(endName, '기본요금', 7_000), { status: 'cancelled' })

      await page.goto('/')
      const rows = (name: string) => page.locator('section.paycard ul.pays > li').filter({ hasText: name })
      // today's charge is the old plan's; the one a month on (inside the 31 days) is the new plan's
      await expect(rows(upName)).toHaveCount(2)
      await expect(rows(upName).nth(0)).toContainText('기본요금')
      await expect(rows(upName).nth(0)).toContainText('11,000')
      await expect(rows(upName).nth(0)).toContainText('D-0')
      await expect(rows(upName).nth(1)).toContainText('상위요금')
      await expect(rows(upName).nth(1)).toContainText('33,000')
      // the cancelled one is still charged today, and not again
      await expect(rows(endName)).toHaveCount(1)
      await expect(rows(endName)).toContainText('7,000')
      await expect(rows(endName)).toContainText('D-0')

      // the plan change editor's date hint
      await page.goto('/spend/subs')
      await page.getByRole('tablist').first().waitFor()
      await page.getByRole('tab', { name: '변경 일정' }).click()
      await page.getByRole('button', { name: '+ 전환 예약' }).click()
      await expect(sheet(page, '플랜 전환 예약')).toContainText('월 비용과 이체액은 적용일이 속한 달부터 새 금액으로 계산하고, 결제는 적용일부터 새 플랜으로 내요.')
      await sheet(page, '플랜 전환 예약').getByRole('button', { name: '취소', exact: true }).click()
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'en' })).status).toBe(200)
      await page.goto('/spend/subs')
      await page.getByRole('tablist').first().waitFor()
      await page.getByRole('tab', { name: 'Scheduled changes' }).click()
      await page.getByRole('button', { name: '+ Schedule change' }).click()
      await expect(sheet(page, 'Schedule plan change')).toContainText('The monthly cost and the transfer count it from the month of this date; charges use the new plan from this date on.')
      await sheet(page, 'Schedule plan change').getByRole('button', { name: 'Cancel', exact: true }).click()
    } finally {
      for (const id of subs) await api(request, 'DELETE', `/api/subscriptions/${id}`)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })
})

test.describe.serial('W-6 follow-up: the subscription list names a charge due before a cancellation', () => {
  test('(S-7, A-20, A-35) 구독 목록: a row cancelled or changed from tomorrow still shows today\'s charge as its next payment, with that charge\'s own plan and amount; one cancelled from today shows none; the CSV carries the same', async ({ page, request }) => {
    const st0 = (await api(request, 'GET', '/api/state')).json as State & { preferences: Record<string, unknown> }
    const prefs = st0.preferences
    const now = seoulToday()
    const today = iso(now)
    const tomorrow = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))
    const [dueName, goneName, chgName, plainName] = [`${MARK}-w6-due`, `${MARK}-w6-gone`, `${MARK}-w6-chg`, `${MARK}-w6-plain`]
    const subs: string[] = []
    const sub = async (name: string, effective: string | null, to: Record<string, unknown> = { status: 'cancelled' }) => {
      const r = await api(request, 'POST', '/api/subscriptions', { name, category: 'tool', plan: '기본요금', amount: 7_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: today, path: 'direct', verified: false })
      expect(r.status, JSON.stringify(r.json)).toBe(201)
      const id = (r.json as { id: string }).id
      subs.push(id)
      if (effective) expect((await api(request, 'POST', '/api/plan-changes', { subId: id, effective, to, note: '' })).status).toBe(201)
    }
    // On the month's last day tomorrow's change is next month's: the row still is the old plan, so nothing differs.
    const sameMonth = tomorrow.slice(0, 7) === today.slice(0, 7)
    try {
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      // both are charged today: one is cancelled from tomorrow (today's charge is still made), one from today (no charge)
      await sub(dueName, tomorrow)
      await sub(goneName, today)
      // a plan change dated tomorrow: the row is the month's (new) plan, today's charge is still the old plan's (review 4 finding 1)
      await sub(chgName, tomorrow, { plan: '새요금', amount: 9_000 })
      await sub(plainName, null)
      await page.goto('/spend/subs')
      // every status: a row cancelled later this month reads 해지 for the month
      await page.getByRole('group', { name: '상태로 거르기', exact: true }).getByRole('button', { name: /^전체/ }).click()
      const row = (name: string) => page.locator('table.subs-t tbody tr', { hasText: name })
      const next = (name: string) => row(name).locator('td').nth(5)
      const said = (name: string) => next(name).getByTestId('sub-next-charge')
      await expect(next(dueName)).toContainText(today)
      await expect(next(goneName)).toHaveText('—')
      await expect(next(chgName)).toContainText(today)
      // nothing scheduled: the date alone, the row's own plan is what is charged
      await expect(next(plainName)).toHaveText(today)
      await expect(said(plainName)).toHaveCount(0)
      if (sameMonth) {
        // the charge of today is made with the plan in force today: said under the date, since the row shows another
        await expect(said(dueName)).toHaveText('기본요금 · KRW 7,000')
        await expect(row(chgName).locator('td').first()).toContainText('새요금')
        await expect(row(chgName).locator('td').nth(3)).toHaveText('KRW 9,000')
        await expect(said(chgName)).toHaveText('기본요금 · KRW 7,000')
      } else {
        await expect(said(dueName)).toHaveCount(0)
        await expect(said(chgName)).toHaveCount(0)
      }
      // the CSV: the row's plan in its columns, the next charge's own plan, amount and currency in the last three
      const wait = page.waitForEvent('download')
      await page.getByRole('button', { name: 'CSV 내보내기', exact: true }).click()
      const file = await (await wait).path()
      const lines = (await import('node:fs')).readFileSync(file!, 'utf8').replace(/^\uFEFF/, '').trim().split('\r\n')
      expect(lines[0]!.endsWith(',다음 결제일,월 환산(원),다음 결제 요금제,다음 결제 금액,다음 결제 통화')).toBe(true)
      const line = (name: string) => lines.find((l) => l.startsWith(`${name},`)) ?? ''
      expect(line(plainName)).toMatch(new RegExp(`,기본요금,7000,KRW,.*,${today},\\d+,,,$`))
      if (sameMonth) {
        expect(line(chgName)).toMatch(new RegExp(`,새요금,9000,KRW,.*,${today},\\d+,기본요금,7000,KRW$`))
        expect(line(dueName)).toMatch(new RegExp(`,${today},\\d*,기본요금,7000,KRW$`))
      }
      expect(line(goneName)).toMatch(/,,\d*,,,$/)
      // the phone list shows the same date, with the charge's own plan and amount where it differs
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(page.locator('ul.mlist li', { hasText: dueName }).locator('.m3')).toContainText(today)
      await expect(page.locator('ul.mlist li', { hasText: goneName }).locator('.m3')).not.toContainText(today)
      await expect(page.locator('ul.mlist li', { hasText: plainName }).locator('.m3')).toContainText(`${today} · KRW 7,000`)
      if (sameMonth) await expect(page.locator('ul.mlist li', { hasText: chgName }).locator('.m3')).toContainText(`${today} · 기본요금 · KRW 7,000`)
    } finally {
      for (const id of subs) await api(request, 'DELETE', `/api/subscriptions/${id}`)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })
})

test.describe.serial('W-7 how a subscription is paid', () => {
  type SubRow = Record<string, unknown> & { id: string; name: string; cardId: string | null; accountId: string | null }
  const subOf = async (request: APIRequestContext, id: string) => ((await api(request, 'GET', '/api/state')).json as { subscriptions: SubRow[] }).subscriptions.find((x) => x.id === id)!
  const payGroup = (s: Locator, name = '결제 수단') => s.getByRole('group', { name, exact: true })
  const pressed = (g: Locator) => g.locator('button[aria-pressed="true"]')
  const listRow = (page: Page, name: string) => page.locator('table.subs-t tbody tr', { hasText: name })
  async function openSub(page: Page, name: string) {
    await page.goto('/spend/subs')
    await listRow(page, name).getByRole('button', { name: `${name} 수정`, exact: true }).click()
    const s = sheet(page, `구독 수정 · ${name}`)
    await expect(payGroup(s)).toBeVisible()
    return s
  }
  async function saveSub(page: Page, name: string) {
    await sheet(page, `구독 수정 · ${name}`).getByRole('button', { name: '다음', exact: true }).click()
    await saveSheet(page, `구독 수정 · ${name}`)
  }
  async function forecast(page: Page, account: string) {
    await page.goto('/pay')
    await page.getByRole('tab', { name: '통장·생활비·설정' }).click()
    await page.getByTestId('accounts-table').locator('tbody tr', { hasText: account }).click()
    return forecastOf(page, account)
  }

  test('(S-8, S-9, V-6) 결제 수단: a card is set in the editor and read back, then an account, then 없음; the account sheet\'s forecast takes the charges out', async ({ page, request }) => {
    const st0 = (await api(request, 'GET', '/api/state')).json as State & { preferences: Record<string, unknown> }
    const s0 = st0.settings
    const prefs = st0.preferences
    const now = seoulToday()
    const today = iso(now)
    // the date entered is the 5th of next month, so the 5th of this month is a charge too (one cycle before it)
    const next5 = iso(new Date(now.getFullYear(), now.getMonth() + 1, 5))
    const [name, cardName, accName, acc2Name] = [`${MARK}-w7-sub`, `${MARK}-w7-card`, `${MARK}-w7-accA`, `${MARK}-w7-accB`]
    const made: [string, string][] = []
    const mk = async (path: string, body: unknown) => {
      const r = await api(request, 'POST', path, body)
      expect(r.status, JSON.stringify(r.json)).toBe(201)
      made.unshift([path, (r.json as { id: string }).id])
      return (r.json as { id: string }).id
    }
    try {
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      // calendar months, no date moves, card billing day 14
      expect((await api(request, 'PUT', '/api/settings', { ...s0, billingDay: 14, payShift: 'none', transferShift: 'none', billingShift: 'none', monthBasis: 'calendar', monthBasisCardId: null, monthNaming: 'auto' })).status).toBe(200)
      const acc = await mk('/api/accounts', { name: accName, role: '', inflow: '', outflow: '' })
      const acc2 = await mk('/api/accounts', { name: acc2Name, role: '', inflow: '', outflow: '' })
      for (const accountId of [acc, acc2]) await mk('/api/balances', { accountId, date: today, amount: 1_000_000, note: '' })
      const card = await mk('/api/cards', { name: cardName, last4: '', accountId: acc, billingDay: null })
      // saved the way 0.1.9 saved it: no way of paying
      const OLD = { name, category: 'content', plan: '기본요금\n둘째 줄', amount: 12_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: next5, path: 'google', verified: true, note: '메모 그대로' }
      const sid = await mk('/api/subscriptions', OLD)
      expect(await subOf(request, sid)).toMatchObject({ cardId: null, accountId: null })

      // ── the old value: 없음 is shown, and a save that does not touch it keeps every field as it was ──
      let s = await openSub(page, name)
      await expect(pressed(payGroup(s))).toHaveText('없음')
      await expect(s.locator('#e-pay-card, #e-pay-acc')).toHaveCount(0)
      await expect(s.getByTestId('sub-pay-hint')).toHaveText('이 구독료가 어디서 빠지는지 고르면 그 통장의 잔액 예상에서 결제마다 빠져요. 고르지 않으면 어디서도 빠지지 않아요. 결제 경로와는 따로예요.')
      await saveSub(page, name)
      expect(await subOf(request, sid)).toMatchObject({ ...OLD, cardId: null, accountId: null })
      await expect(listRow(page, name).locator('.paid')).toHaveCount(0)

      // ── a card ──
      s = await openSub(page, name)
      await payGroup(s).getByRole('button', { name: '카드', exact: true }).click()
      await choose(s.locator('#e-pay-card'), card)
      await expect(s.locator('#e-pay-card')).toContainText(`${cardName} · ${accName}에서 결제`)
      await expect(s.getByTestId('sub-pay-hint')).toHaveText('결제한 날이 든 이용 기간이 끝난 뒤의 카드 결제일에, 이 카드의 결제 통장에서 빠져요.')
      await saveSub(page, name)
      // every other field is stored as before; the card is saved and the account stays empty
      expect(await subOf(request, sid)).toMatchObject({ ...OLD, cardId: card, accountId: null })
      await page.reload()
      await expect(listRow(page, name).locator('.paid')).toHaveText(cardName)
      await expect(listRow(page, name)).toContainText('Google Play')
      s = await openSub(page, name)
      await expect(pressed(payGroup(s))).toHaveText('카드')
      await expect(s.locator('#e-pay-card')).toHaveAttribute('data-value', card)
      // the change history words the card by its name, not its id (the newest set is that save)
      await page.goto('/history')
      await page.locator('button.disc').first().click()
      const cardField = page.locator('.det').first().locator('tbody tr').filter({ has: page.locator('th', { hasText: /^카드$/ }) })
      await expect(cardField.locator('td.bef')).toHaveText('—')
      await expect(cardField.locator('td.aft')).toHaveText(cardName)
      // the forecast of the card's paying account: the charge of this month's 5th is billed on the 14th of next month,
      // the one of next month's 5th on the 14th of the month after
      let rows = await forecast(page, accName)
      expect(rows.slice(0, 3).map((r) => r.outflow)).toEqual([0, 12_000, 12_000])
      expect(rows.slice(0, 3).map((r) => r.end)).toEqual([1_000_000, 988_000, 976_000])
      expect((await forecast(page, acc2Name)).slice(0, 3).map((r) => r.outflow)).toEqual([0, 0, 0])

      // ── an account ──
      s = await openSub(page, name)
      await payGroup(s).getByRole('button', { name: '통장', exact: true }).click()
      await choose(s.locator('#e-pay-acc'), acc2)
      await expect(s.getByTestId('sub-pay-hint')).toHaveText('결제일마다 이 통장에서 바로 빠져요.')
      await saveSub(page, name)
      expect(await subOf(request, sid)).toMatchObject({ ...OLD, cardId: null, accountId: acc2 })
      await page.reload()
      await expect(listRow(page, name).locator('.paid')).toHaveText(acc2Name)
      s = await openSub(page, name)
      await expect(pressed(payGroup(s))).toHaveText('통장')
      await expect(s.locator('#e-pay-acc')).toHaveAttribute('data-value', acc2)
      // each charge leaves the account on the 5th: this month's only when the 5th is still to come (the record is today's)
      rows = await forecast(page, acc2Name)
      expect(rows.slice(0, 3).map((r) => r.outflow)).toEqual([now.getDate() < 5 ? 12_000 : 0, 12_000, 12_000])
      expect((await forecast(page, accName)).slice(0, 3).map((r) => r.outflow)).toEqual([0, 0, 0])

      // ── back to 없음 ──
      s = await openSub(page, name)
      await payGroup(s).getByRole('button', { name: '없음', exact: true }).click()
      await expect(s.locator('#e-pay-card, #e-pay-acc')).toHaveCount(0)
      await saveSub(page, name)
      expect(await subOf(request, sid)).toMatchObject({ ...OLD, cardId: null, accountId: null })
      await page.reload()
      await expect(listRow(page, name)).toBeVisible()
      await expect(listRow(page, name).locator('.paid')).toHaveCount(0)
      expect((await forecast(page, acc2Name)).slice(0, 3).map((r) => r.outflow)).toEqual([0, 0, 0])

      // ── a card without a paying account may be chosen; the editor says what that means ──
      const loose = await mk('/api/cards', { name: `${cardName}-loose`, last4: '', accountId: null, billingDay: null })
      s = await openSub(page, name)
      await payGroup(s).getByRole('button', { name: '카드', exact: true }).click()
      await choose(s.locator('#e-pay-card'), loose)
      await expect(s.locator('#e-pay-card')).toContainText(`${cardName}-loose · 결제 통장 없음`)
      await expect(s.getByTestId('sub-pay-hint')).toContainText('이 카드에는 결제 통장이 없어서 잔액 예상에서 빠지지 않아요.')
      await saveSub(page, name)
      expect(await subOf(request, sid)).toMatchObject({ cardId: loose, accountId: null })
      // deleting the card on its screen's API unlinks the subscription; the list follows after a reload
      expect((await api(request, 'DELETE', `/api/cards/${loose}`)).status).toBe(204)
      expect(await subOf(request, sid)).toMatchObject({ ...OLD, cardId: null, accountId: null })
      // the history of that delete names the card the subscription lost, though the card is gone
      await page.goto('/history')
      await page.locator('button.disc').first().click()
      const lost = page.locator('.det').first().locator('.chg-row', { hasText: name }).locator('tbody tr').filter({ has: page.locator('th', { hasText: /^카드$/ }) })
      await expect(lost.locator('td.bef')).toHaveText(`${cardName}-loose`)
      await expect(lost.locator('td.aft')).toHaveText('—')
    } finally {
      for (const [path, id] of made) await api(request, 'DELETE', `${path}/${id}`)
      expect((await api(request, 'PUT', '/api/settings', s0)).status).toBe(200)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })

  test('(S-8, V-6) 결제 수단 on a new subscription, on a phone and in English', async ({ page, request }) => {
    const st0 = (await api(request, 'GET', '/api/state')).json as State & { preferences: Record<string, unknown> }
    const prefs = st0.preferences
    const [name, cardName, accName] = [`${MARK}-w7-new`, `${MARK}-w7-card2`, `${MARK}-w7-accC`]
    const made: [string, string][] = []
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    try {
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'ko' })).status).toBe(200)
      const acc = (await api(request, 'POST', '/api/accounts', { name: accName, role: '', inflow: '', outflow: '' })).json as { id: string }
      made.unshift(['/api/accounts', acc.id])
      const card = (await api(request, 'POST', '/api/cards', { name: cardName, last4: '1234', accountId: acc.id, billingDay: null })).json as { id: string }
      made.unshift(['/api/cards', card.id])

      // a new subscription: 없음 until something is picked; picked here, it is saved with the rest
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/spend/subs?add')
      const s = sheet(page, '구독 추가')
      await expect(pressed(payGroup(s))).toHaveText('없음')
      await s.getByLabel('서비스 이름').fill(name)
      await payGroup(s).getByRole('button', { name: '카드', exact: true }).click()
      await choose(s.locator('#e-pay-card'), card.id)
      await expect(s.locator('#e-pay-card')).toContainText(`${cardName} 1234 · ${accName}에서 결제`)
      expect(await fits()).toBe(true)
      await s.getByRole('button', { name: '다음', exact: true }).click()
      await s.getByLabel('금액', { exact: true }).fill('3300')
      await fillDate(s.getByRole('group', { name: '다음 결제일' }), '2031-02-10')
      await saveSheet(page, '구독 추가')
      const saved = ((await api(request, 'GET', '/api/state')).json as { subscriptions: SubRow[] }).subscriptions.find((x) => x.name === name)!
      made.unshift(['/api/subscriptions', saved.id])
      expect(saved).toMatchObject({ cardId: card.id, accountId: null, amount: 3300, nextDate: '2031-02-10', path: 'direct' })
      // the phone list names the card after the payment path
      await page.reload()
      await expect(page.locator('ul.mlist li', { hasText: name }).locator('.paid')).toHaveText(cardName)
      expect(await fits()).toBe(true)

      // English
      expect((await api(request, 'PUT', '/api/preferences', { ...prefs, dateFormat: 'iso', language: 'en' })).status).toBe(200)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/spend/subs')
      await listRow(page, name).getByRole('button', { name: `Edit ${name}`, exact: true }).click()
      const e = sheet(page, `Edit subscription · ${name}`)
      await expect(payGroup(e, 'Paid with').getByRole('button')).toHaveText(['None', 'Card', 'Account'])
      await expect(pressed(payGroup(e, 'Paid with'))).toHaveText('Card')
      await expect(e.locator('#e-pay-card')).toContainText(`${cardName} 1234 · paid from ${accName}`)
      await expect(e.getByTestId('sub-pay-hint')).toHaveText('Each charge leaves this card\'s paying account on the card\'s billing date after the usage period that holds the charge.')
      await payGroup(e, 'Paid with').getByRole('button', { name: 'Account', exact: true }).click()
      await expect(e.getByTestId('sub-pay-hint')).toHaveText('Each charge leaves this account on its date.')
      await payGroup(e, 'Paid with').getByRole('button', { name: 'None', exact: true }).click()
      await expect(e.getByTestId('sub-pay-hint')).toHaveText('Choose where this subscription is charged and each charge is taken out of that account\'s balance forecast. Without a choice nothing is taken out. It is apart from the payment path.')
      await e.getByRole('button', { name: 'Cancel', exact: true }).click()
      // cancelled: nothing was saved
      expect(await subOf(request, saved.id)).toMatchObject({ cardId: card.id, accountId: null })
    } finally {
      for (const [path, id] of made) await api(request, 'DELETE', `${path}/${id}`)
      await api(request, 'PUT', '/api/preferences', prefs)
    }
  })
})
