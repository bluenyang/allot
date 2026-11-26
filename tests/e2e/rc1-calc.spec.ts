// spec 018 (0.1.10-rc.1, V-6): the calculation changes on the screens. W-1: the weekend and holiday rule of each date
// (Settings › General › 기준 일정) and of each of the user's own monthly dates. W-2: a card's usage period (the card
// editor of 월급 분배, the card list, and the bill date of a new card spending).
// Every row made here carries the run mark and is removed by id in `finally`; the settings the tests change are put back.
// It changes the settings, so it runs only on a throwaway server: the test server (:15174) or the API of
// scripts/test-server/disposable.sh (:15184, started with STATIC_DIR=dist so it serves the built screens).
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { MARK as RUN, choose, menu, readDate, saveSheet, sheet } from './helpers'

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
      await expect(en.getByTestId('cd-usage-now')).toHaveText(/^Right now, what you buy from \d+\/\d+ to \d+\/\d+ is billed on \d+\/\d+\.$/)
      expect(await fits()).toBe(true)
    } finally {
      await api(request, 'PUT', '/api/preferences', prefs)
      await api(request, 'DELETE', `/api/cards/${id}`)
    }
  })
})
