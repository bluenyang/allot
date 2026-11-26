// spec 018 (0.1.10-rc.1, V-6): the calculation changes on the screens. W-1: the weekend and holiday rule of each date
// (Settings › General › 기준 일정) and of each of the user's own monthly dates.
// Every row made here carries the run mark and is removed by id in `finally`; the settings the tests change are put back.
// It changes the settings, so it runs only on a throwaway server: the test server (:15174) or the API of
// scripts/test-server/disposable.sh (:15184, started with STATIC_DIR=dist so it serves the built screens).
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { MARK as RUN } from './helpers'

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
type State = { settings: Settings; schedules: Sched[] }
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
