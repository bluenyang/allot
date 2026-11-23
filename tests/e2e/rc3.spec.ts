// spec 013 rev 1 W-21 (0.1.7-rc.3): the time zone and the user's own monthly dates (V-19), the currency list and the
// automatic rate refresh (V-20), the password policy, the generator and API key management (V-21). Every row made here
// carries the run mark and is removed by id in `finally`; what the tests change in rows they did not make (preferences,
// settings, the password policy) is put back.
// The automatic refresh runs only when FX_FAKE names the fake rate service (tests/api/fx-fake.mjs, e.g.
// http://127.0.0.1:15179) and the test server was started with ALLOT_FX_URL pointing at it; otherwise it is skipped.
// No request ever goes to the real rate service.
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK as RUN, choose, deleteInSheet, fillDate, saveSheet, sheet } from './helpers'
import { tool } from './proposal-helpers'

// This file changes the password policy, turns the lockout on and makes accounts: only on the throwaway test server
// (:15174), never the staging stack the user uses (review rc3-5 R5-5).
const TEST_SERVER = 'http://127.0.0.1:15174'
if ((process.env.BASE ?? '') !== TEST_SERVER) throw new Error(`rc3.spec runs only against ${TEST_SERVER} (BASE=${process.env.BASE ?? 'unset'})`)

const MARK = `${RUN}-r3`

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
type Row = Record<string, unknown> & { id: string; name: string }
type Settings = Record<string, unknown> & { fxRate: number; fxBuffer: number; fxAuto?: boolean; dayShift: string; fxAutoAt?: string | null }
type Cur = { id: string; code: string; rate: number; buffer: number; auto: boolean; autoAt?: string | null; autoError?: string | null }
type Sched = { id: string; name: string; day: number; accountId: string | null; direction: 'in' | 'out'; note?: string | null }
type State = {
  settings: Settings; preferences: Record<string, unknown> & { timezone?: string | null }; currencies: Cur[]; schedules: Sched[]
  subscriptions: (Row & { currency: string; amount: number; vat: number; cycle: string })[]
  spendings: (Row & { currency: string; amount: number; fxRate: number | null; fxBuffer: number | null; rounds: { amount: number }[] })[]
}
const state = async (request: APIRequestContext) => (await api(request, 'GET', '/api/state')).json as State
const sepDigits = (t: string) => Number(t.replace(/[^\d]/g, ''))
const dayIn = (tz: string, d = new Date()) => d.toLocaleString('sv', { timeZone: tz }).slice(0, 10)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }) })

// ───────────────────────── V-19: time zone, own monthly dates ─────────────────────────
test.describe.serial('V-19 time zone and own monthly dates', () => {
  test('(V-19) a picked time zone is saved, and "today" on the 일정 page follows it', async ({ page, request }) => {
    const before = (await state(request)).preferences
    // Kiritimati is UTC+14 and Pago Pago UTC−11: 25 hours apart, so their dates always differ.
    const zones = ['Pacific/Kiritimati', 'Pacific/Pago_Pago'] as const
    expect(dayIn(zones[0])).not.toBe(dayIn(zones[1]))
    try {
      for (const tz of zones) {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto('/settings/general')
        await choose(page.locator('#g-tz'), tz)
        await expect(page.getByRole('status').filter({ hasText: '시간대를 바꿨어요' })).toBeVisible()
        await expect.poll(async () => (await state(request)).preferences.timezone).toBe(tz)
        await page.reload()
        await expect(page.locator('#g-tz')).toHaveAttribute('data-value', tz)
        await expect(page.locator('#g-tz')).toContainText(tz)
        // the 일정 page's "today" line (narrow screens show it) is the day in that zone
        const ymd = dayIn(tz)
        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto('/events')
        await expect(page.getByText(`오늘 ${+ymd.slice(5, 7)}/${+ymd.slice(8, 10)}(`)).toBeVisible()
      }
    } finally {
      expect((await api(request, 'PUT', '/api/preferences', { ...before, timezone: before.timezone ?? 'Asia/Seoul' })).status).toBe(200)
    }
  })

  test('(V-19) an own monthly date: added, listed with this month\'s shifted date, on the calendar, edited, deleted; MCP get_schedule lists it', async ({ page, request, baseURL }) => {
    const s0 = await state(request)
    const tz = s0.preferences.timezone ?? 'Asia/Seoul'
    const today = dayIn(tz)
    const ym = today.slice(0, 7)
    const last = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate()
    // a Saturday of this month whose Monday is in this month too: with "after", it moves to that Monday
    let sat = 0
    for (let d = 1; d <= last - 2; d++) if (new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, d)).getUTCDay() === 6) { sat = d; break }
    expect(sat).toBeGreaterThan(0)
    const md = (d: number) => `${+ym.slice(5, 7)}/${d}(`
    const name = `${MARK}-own`
    const key = await api(request, 'POST', '/api/keys', { name: `${MARK}-sched-key`, expiresInDays: 30 })
    expect(key.status).toBe(201)
    expect((await api(request, 'PUT', '/api/settings', { ...s0.settings, dayShift: 'after' })).status).toBe(200)
    try {
      await page.goto('/settings/general')
      await page.getByRole('button', { name: '+ 일정 추가' }).click()
      const s = sheet(page, '기준 일정 추가')
      await s.getByLabel('이름').fill(name)
      await choose(s.locator('#si-day'), String(sat))
      await s.getByRole('button', { name: '들어오는 돈' }).click()
      await s.getByLabel('메모').fill('memo')
      await saveSheet(page, '기준 일정 추가')
      const saved = (await state(request)).schedules.find((x) => x.name === name)!
      expect(saved).toMatchObject({ name, day: sat, direction: 'in', accountId: null, note: 'memo' })
      // listed under the three fixed days: 매달 N일, no account, this month's date moved to the Monday
      const row = page.locator('li.own', { hasText: name })
      await expect(row).toContainText(`매달 ${sat}일`)
      await expect(row).toContainText('통장 없음')
      await expect(row).toContainText('들어옴')
      await expect(row.locator('.thism b.num')).toContainText(md(sat + 2))
      await expect(row.locator('.thism b.num')).toHaveClass(/moved/)
      // on the 일정 calendar and in the month's agenda (in = 들어옴)
      await page.goto('/events')
      const cal = page.getByRole('region', { name: '이번 달 일정 달력' })
      await expect(cal).toContainText(name)
      const ag = page.locator('section.agenda li[data-kind="in"]', { hasText: name })
      await expect(ag).toHaveCount(1)
      await expect(ag.locator('.dt b')).toHaveText(String(sat + 2))
      // MCP get_schedule (a read key): this month's ownDates has it with the shifted date
      const sch = await tool(baseURL!, key.json.key, 'get_schedule', { months: 1 }) as { months: { month: string; ownDates: { id: string; name: string; day: number; date: string; nominal?: string; shifted?: unknown; direction: string }[] }[] }
      const own = sch.months.find((m) => m.month === ym)!.ownDates.find((x) => x.id === saved.id)!
      expect(own).toMatchObject({ name, day: sat, direction: 'in', date: `${ym}-${String(sat + 2).padStart(2, '0')}` })
      // edited: name, day 31 (the month's last day), out
      await page.goto('/settings/general')
      await page.getByRole('button', { name: `${name} 수정` }).click()
      const e = sheet(page, '기준 일정 수정')
      await expect(e.getByLabel('이름')).toHaveValue(name)
      await e.getByLabel('이름').fill(`${name}-2`)
      await choose(e.locator('#si-day'), '31')
      await e.getByRole('button', { name: '나가는 돈' }).click()
      await saveSheet(page, '기준 일정 수정')
      expect((await state(request)).schedules.find((x) => x.id === saved.id)).toMatchObject({ name: `${name}-2`, day: 31, direction: 'out' })
      await expect(page.locator('li.own', { hasText: `${name}-2` })).toContainText('매달 31일')
      await expect(page.locator('li.own', { hasText: `${name}-2` })).toContainText('나감')
      // deleted
      await page.getByRole('button', { name: `${name}-2 수정` }).click()
      await deleteInSheet(page, '기준 일정 수정')
      expect((await state(request)).schedules.some((x) => x.id === saved.id)).toBe(false)
      await expect(page.locator('li.own', { hasText: name })).toHaveCount(0)
    } finally {
      for (const x of (await state(request)).schedules.filter((x) => x.name.startsWith(MARK))) await api(request, 'DELETE', `/api/schedules/${x.id}`)
      expect((await api(request, 'PUT', '/api/settings', s0.settings)).status).toBe(200)
      await api(request, 'DELETE', `/api/keys/${key.json.item.id}`)
    }
  })
})

// ───────────────────────── V-20: currencies ─────────────────────────
async function cleanCurrencies(request: APIRequestContext, s0: State) {
  const st = await state(request)
  for (const x of st.spendings.filter((x) => x.name.startsWith(MARK))) await api(request, 'DELETE', `/api/spendings/${x.id}`)
  for (const x of st.subscriptions.filter((x) => x.name.startsWith(MARK))) await api(request, 'DELETE', `/api/subscriptions/${x.id}`)
  for (const c of st.currencies.filter((c) => !s0.currencies.some((o) => o.id === c.id))) expect((await api(request, 'DELETE', `/api/currencies/${c.id}`)).status).toBe(204)
  const { fxRate, fxBuffer, fxAuto } = s0.settings
  expect((await api(request, 'PUT', '/api/settings', { ...(await state(request)).settings, fxRate, fxBuffer, fxAuto: !!fxAuto })).status).toBe(200)
}
async function addCurrency(page: Page, code: string, rate: string, buffer: string, auto = false) {
  await page.getByRole('button', { name: '+ 외화 추가' }).click()
  const s = sheet(page, '외화 추가')
  await s.locator('#fx-code').fill(code)
  await s.locator('#fx-code').blur()
  await expect(s.locator('#fx-code')).toHaveValue(code.trim().toUpperCase())
  if (auto) await s.getByRole('button', { name: '자동', exact: true }).click()
  await s.locator('#g-fx').fill(rate)
  await s.locator('#g-buf').fill(buffer)
  await saveSheet(page, '외화 추가')
}
const fxRow = (page: Page, code: string) => page.locator('ul.fxlist li').filter({ has: page.locator('span.code', { hasText: new RegExp(`^${code}$`) }) })

test.describe.serial('V-20 currencies', () => {
  test('(V-20) KRW fixed note; EUR added and used by a subscription and a spending; deleting it while used is refused; old KRW/USD values save as before', async ({ page, request }) => {
    const s0 = await state(request)
    const c = s0.settings
    try {
      await page.goto('/settings/general')
      await expect(page.getByText('KRW · 대한민국 원 (₩)')).toBeVisible()
      await expect(page.getByText('원화 고정 — 모든 금액·회차·분배가 원화예요.')).toBeVisible()
      await expect(fxRow(page, 'USD')).toContainText(`₩${c.fxRate.toLocaleString('en-US', { maximumFractionDigits: 2 })} / 1 USD`)
      await addCurrency(page, 'eur', '1500', '2')
      const eur = (await state(request)).currencies.find((x) => x.code === 'EUR')!
      expect(eur).toMatchObject({ code: 'EUR', rate: 1500, buffer: 2, auto: false })
      await expect(fxRow(page, 'EUR')).toContainText('₩1,500 / 1 EUR')
      await expect(fxRow(page, 'EUR')).toContainText('직접 입력')
      await expect(fxRow(page, 'EUR')).toContainText('버퍼 2%')

      // a subscription in EUR (10 a month, no VAT): ₩15,000 a month
      await page.goto('/spend/subs')
      await page.getByRole('tab', { name: '목록' }).click()
      const addSub = async (n: string, cur: 'KRW' | 'USD' | 'EUR', amount: string, vat?: string) => {
        await page.getByRole('button', { name: '구독 추가' }).click()
        const s = sheet(page, '구독 추가')
        await s.getByLabel('서비스 이름').fill(`${MARK}-${n}`)
        await s.getByRole('button', { name: '다음' }).click()
        await s.getByRole('button', { name: cur, exact: true }).click()
        await s.getByLabel('금액', { exact: true }).fill(amount)
        if (vat !== undefined) await s.getByLabel('VAT (%)').fill(vat)
        await fillDate(s.getByRole('group', { name: '다음 결제일' }), '2031-01-15')
        await saveSheet(page, '구독 추가')
      }
      await addSub('eur', 'EUR', '10')
      await addSub('usd', 'USD', '12.5', '10.5')
      await addSub('krw', 'KRW', '9,900')
      const subs = Object.fromEntries((await state(request)).subscriptions.filter((x) => x.name.startsWith(MARK)).map((x) => [x.name.replace(`${MARK}-`, ''), x]))
      expect(subs.eur).toMatchObject({ currency: 'EUR', amount: 10, vat: 0 })
      expect(subs.usd).toMatchObject({ currency: 'USD', amount: 12.5, vat: 10.5 })
      expect(subs.krw).toMatchObject({ currency: 'KRW', amount: 9900, vat: 0 })
      const eurRow = page.getByRole('row', { name: new RegExp(`${esc(MARK)}-eur`) })
      await expect(eurRow).toContainText('EUR 10.00')
      await expect(eurRow).toContainText('₩15,000')
      await expect(page.getByRole('row', { name: new RegExp(`${esc(MARK)}-usd`) })).toContainText('USD 12.50 +10.5%')
      // opened again: the picker shows the stored code (old values unchanged)
      await page.reload()
      await page.getByRole('tab', { name: '목록' }).click()
      for (const [k, cur, amount] of [['usd', 'USD', '12.5'], ['krw', 'KRW', '9,900'], ['eur', 'EUR', '10']] as const) {
        await page.getByRole('button', { name: `${MARK}-${k} 수정` }).click()
        const s = sheet(page, '구독 수정')
        await s.getByRole('button', { name: '다음' }).click()
        await expect(s.getByRole('button', { name: cur, exact: true }), k).toHaveAttribute('aria-pressed', 'true')
        await expect(s.getByLabel('금액', { exact: true }), k).toHaveValue(amount)
        if (k === 'usd') await expect(s.getByLabel('VAT (%)')).toHaveValue('10.5')
        await saveSheet(page, '구독 수정')
      }
      const subs2 = (await state(request)).subscriptions.filter((x) => x.name.startsWith(MARK))
      for (const x of subs2) expect(x, `${x.name} saved again unchanged`).toMatchObject({ currency: subs[x.name.replace(`${MARK}-`, '')]!.currency, amount: subs[x.name.replace(`${MARK}-`, '')]!.amount, vat: subs[x.name.replace(`${MARK}-`, '')]!.vat })

      // spendings in EUR and USD: KRW at the code's rate and buffer, kept with that rate
      const addSpend = async (n: string, cur: 'USD' | 'EUR', amount: string, krw: number) => {
        await page.goto('/spend/general')
        await page.getByRole('button', { name: '지출 추가', exact: true }).click()
        const s = sheet(page, '지출 추가')
        await s.getByLabel('내용', { exact: true }).fill(`${MARK}-${n}`)
        await s.getByRole('button', { name: cur, exact: true }).click()
        await s.getByLabel('금액', { exact: true }).fill(amount)
        await expect(s.getByTestId('sp-krw')).toHaveText(new RegExp(krw.toLocaleString('en-US')))
        await s.getByRole('radio', { name: '기타 · 직접 입력' }).click()
        await s.getByLabel('분류 직접 입력').fill('교육')
        await s.getByRole('button', { name: '다음', exact: true }).click()
        await choose(s.getByLabel('결제 수단', { exact: true }), { label: '구독 통장' })
        await s.getByRole('button', { name: '다음', exact: true }).click()
        await saveSheet(page, '지출 추가')
      }
      const eurKrw = Math.round(20 * 1500 * 1.02)
      const usdKrw = Math.round(49 * c.fxRate * (1 + c.fxBuffer / 100))
      await addSpend('sp-eur', 'EUR', '20', eurKrw)
      await addSpend('sp-usd', 'USD', '49', usdKrw)
      const sp = Object.fromEntries((await state(request)).spendings.filter((x) => x.name.startsWith(MARK)).map((x) => [x.name.replace(`${MARK}-`, ''), x]))
      expect(sp['sp-eur']).toMatchObject({ currency: 'EUR', amount: 20, fxRate: 1500, fxBuffer: 2 })
      expect(sp['sp-eur']!.rounds[0]!.amount).toBe(eurKrw)
      expect(sp['sp-usd']).toMatchObject({ currency: 'USD', amount: 49, fxRate: c.fxRate, fxBuffer: c.fxBuffer })
      expect(sp['sp-usd']!.rounds[0]!.amount).toBe(usdKrw)

      // EUR is in use: its delete is refused with the server's message, and it stays
      await page.goto('/settings/general')
      await expect(fxRow(page, 'EUR')).toContainText('구독 1건 · 지출 1건')
      await page.getByRole('button', { name: 'EUR 수정' }).click()
      const es = sheet(page, 'EUR 수정')
      await es.getByRole('button', { name: '삭제' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: '삭제', exact: true }).click()
      await expect(es).toContainText("'EUR'를 쓰는 구독이나 지출이 있어요. 그 항목을 먼저 바꾸거나 지우세요.")
      expect((await state(request)).currencies.some((x) => x.code === 'EUR')).toBe(true)
      await es.getByRole('button', { name: '취소', exact: true }).click()
    } finally {
      await cleanCurrencies(request, s0)
    }
  })

  test('(V-20) automatic refresh with the fake rate service: rates change, the system set is listed and reverted, an earlier settings change stays revertible, an unknown code fails, off fetches nothing', async ({ page, request }) => {
    const FAKE = process.env.FX_FAKE
    // both, so 지금 갱신 can only reach the fake service: the server was started with ALLOT_FX_URL pointing at it (the check
    // script exports both before up.sh); without them the test is skipped before any refresh (review rc3-5 R5-4)
    test.skip(!FAKE || !(process.env.ALLOT_FX_URL ?? '').startsWith('http://allot-fxfake'), 'FX_FAKE and ALLOT_FX_URL do not name the fake rate service')
    const fake = await pwRequest.newContext({ baseURL: FAKE })
    const seen = async () => (await (await fake.get('/_log')).json()) as { from: string; to: string }[]
    const s0 = await state(request)
    try {
      expect((await fake.put(`/_rate?code=EUR&rate=1512.34`)).ok()).toBe(true)
      // USD's fake rate is the one it has: the refresh writes no USD rate (no change set for the settings row)
      expect((await fake.put(`/_rate?code=USD&rate=${s0.settings.fxRate}`)).ok()).toBe(true)
      expect((await fake.put('/_rate?code=CHF&rate=none')).ok()).toBe(true)
      await page.goto('/settings/general')
      await expect(page.getByRole('button', { name: '지금 갱신' })).toHaveCount(0)
      await addCurrency(page, 'EUR', '1500', '2', true)
      await addCurrency(page, 'CHF', '1000', '0', true)
      await expect(fxRow(page, 'EUR')).toContainText('자동 · 아직 갱신 전')
      // the earlier settings change: USD to 자동 in the dialog (a change set of the settings row)
      await page.getByRole('button', { name: 'USD 수정' }).click()
      const us = sheet(page, 'USD 수정')
      await us.getByRole('button', { name: '자동', exact: true }).click()
      await saveSheet(page, 'USD 수정')
      expect((await state(request)).settings.fxAuto).toBe(true)
      const sets0 = (await api(request, 'GET', '/api/changes?limit=5')).json as { id: string; actorKind: string; items?: { tableName: string }[] }[]
      const usdSet = sets0[0]!
      expect(usdSet.actorKind).toBe('user')

      expect((await fake.delete('/_log')).ok()).toBe(true)
      await page.getByRole('button', { name: '지금 갱신' }).click()
      await expect(page.getByRole('status').filter({ hasText: '자동 환율을 갱신했어요' })).toBeVisible()
      await expect(fxRow(page, 'EUR')).toContainText('₩1,512.34 / 1 EUR')
      await expect(fxRow(page, 'EUR')).toContainText(/자동 · \d/)
      await expect(fxRow(page, 'CHF')).toContainText('₩1,000 / 1 CHF')
      await expect(fxRow(page, 'CHF')).toContainText('자동 · 마지막 갱신 실패')
      await expect(fxRow(page, 'CHF')).toContainText('마지막 갱신 실패: 공개 환율에 없는 통화예요')
      const st = await state(request)
      expect(st.currencies.find((x) => x.code === 'EUR')).toMatchObject({ rate: 1512.34, auto: true, autoError: null })
      expect(st.currencies.find((x) => x.code === 'CHF')).toMatchObject({ rate: 1000, auto: true, autoError: 'unknown_code' })
      expect(st.settings.fxRate).toBe(s0.settings.fxRate)
      expect(st.settings.fxAutoAt).toBeTruthy()
      // the server keeps an answer for a few minutes (review rc3-1 F-8): on a re-run some codes come from that memory,
      // so the fake service saw at most these three, each once, and nothing else (review rc3-5 R5-3)
      const asked = (await seen()).map((x) => `${x.from}>${x.to}`)
      expect(asked.filter((a) => !['CHF>KRW', 'EUR>KRW', 'USD>KRW'].includes(a))).toEqual([])
      expect(new Set(asked).size).toBe(asked.length)

      // 변경 내역: the refresh is one set by 자동 갱신; it is reverted from the screen
      await page.goto('/history')
      const list = page.getByRole('list', { name: '변경 목록' })
      const sys = list.getByRole('listitem').filter({ has: page.locator('.pill', { hasText: /^자동 갱신$/ }) })
      await expect(sys).toHaveCount(1)
      await expect(sys).toContainText('통화')
      await sys.getByRole('button', { name: '되돌리기', exact: true }).click()
      await sheet(page, '이 변경을 되돌릴까요?').getByRole('button', { name: '되돌리기', exact: true }).click()
      await expect(sheet(page, '이 변경을 되돌릴까요?')).toBeHidden()
      await expect.poll(async () => (await state(request)).currencies.find((x) => x.code === 'EUR')?.rate).toBe(1500)
      // the settings change made before the refresh can still be reverted
      const rv = await api(request, 'POST', `/api/changes/${usdSet.id}/revert`)
      expect(rv.status, JSON.stringify(rv.json)).toBe(200)
      expect((await state(request)).settings.fxAuto).toBe(false)

      // every switch off: the refresh asks the fake service nothing, and the button is gone
      for (const x of (await state(request)).currencies.filter((x) => x.auto)) expect((await api(request, 'PUT', `/api/currencies/${x.id}`, { code: x.code, rate: x.rate, buffer: x.buffer, auto: false })).status).toBe(200)
      expect((await fake.delete('/_log')).ok()).toBe(true)
      const r = await api(request, 'POST', '/api/currencies/refresh')
      expect(r.status).toBe(200)
      expect(r.json.off).toBe(false)
      expect(await seen()).toEqual([])
      await page.goto('/settings/general')
      await expect(fxRow(page, 'EUR')).toContainText('직접 입력')
      await expect(page.getByRole('button', { name: '지금 갱신' })).toHaveCount(0)
    } finally {
      await cleanCurrencies(request, s0)
      await fake.dispose()
    }
  })
})

// ───────────────────────── V-21: password policy, generator, API keys ─────────────────────────
// Sign-ins on the login screen keep under the per-address limit (5 a minute; Better Auth counts until a quiet minute
// has passed since the last try): at most 4 tries, then more than a minute without one. The first try waits too, since
// other files may have just signed in.
let lastTry = Date.now()
let batch = 4
const LOCK_MIN = 5
async function spaced() {
  const gap = batch >= 4 ? 62_000 - (Date.now() - lastTry) : 1_500 - (Date.now() - lastTry)
  if (batch >= 4) batch = 0
  if (gap > 0) await new Promise((r) => setTimeout(r, gap))
  batch++
  lastTry = Date.now()
}
async function loginScreen(page: Page, email: string, password: string) {
  await spaced()
  await page.goto('/')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
}
type Policy = { minLength: number; lockout: { enabled: boolean; attempts: number; minutes: number } }
const DEFAULT: Policy = { minLength: 8, lockout: { enabled: false, attempts: 5, minutes: 15 } }

test.describe.serial('V-21 password policy and API keys', () => {
  test('(V-21) default policy; the generator; minimum 12 refused on change and admin create/set; lockout locks and the admin unlocks', async ({ page, request, browser }) => {
    test.setTimeout(600_000)
    const p0 = (await api(request, 'GET', '/api/admin/password-policy')).json as { policy: Policy; stored: boolean }
    expect(p0.policy).toEqual(DEFAULT)
    const email = `${MARK.toLowerCase()}-pw@example.com`
    let uid: string | null = null
    const guest = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: 'ko-KR' })
    const g = await guest.newPage()
    try {
      // the admin screen shows the default policy; Account says the server's minimum (8) and 만들기 fills 20 characters
      await page.goto('/admin')
      await page.getByRole('tab', { name: '로그인 방식' }).click()
      await page.getByRole('button', { name: '비밀번호 설정' }).click()
      const ps = sheet(page, '비밀번호 로그인')
      await expect(ps.locator('#pp-min')).toHaveValue('8')
      await expect(ps.getByRole('switch', { name: '연속 실패 잠금' })).not.toBeChecked()
      if (!p0.stored) await expect(ps.getByText('아직 정한 정책이 없어요: 최소 8자, 잠금 꺼짐(기본).')).toBeVisible()
      await ps.getByRole('button', { name: '취소', exact: true }).click()
      await page.goto('/settings/security')
      await expect(page.getByText('이 서버의 비밀번호 최소 길이: 8자')).toBeVisible()
      await page.getByRole('button', { name: '만들기' }).click()
      const made = await page.getByLabel('만든 비밀번호').inputValue()
      expect(made).toHaveLength(20)
      expect(made).toMatch(/^[A-Za-z0-9!@#$%^&*\-_=+?]{20}$/)
      await expect(page.locator('#a-new')).toHaveValue(made)
      await expect(page.locator('#a-again')).toHaveValue(made)
      await page.getByRole('button', { name: '만들기' }).click()
      expect(await page.getByLabel('만든 비밀번호').inputValue()).not.toBe(made)

      // an account made by the admin with a generated temporary password (no policy stored: as before)
      await page.goto('/admin')
      await page.getByRole('button', { name: '계정 만들기' }).click()
      const cs = sheet(page, '새 계정')
      await cs.getByLabel('이메일').fill(email)
      await cs.getByLabel('이름').fill('E2E pw')
      await cs.getByRole('button', { name: '자동 생성' }).click()
      const temp = await cs.getByLabel('만든 비밀번호').inputValue()
      expect(temp).toHaveLength(20)
      await expect(cs.locator('#u-pw')).toHaveValue(temp)
      await cs.getByRole('button', { name: '저장' }).click()
      await expect(page.getByRole('status')).toContainText('계정을 만들었어요')
      const users = (await api(request, 'GET', '/api/auth/admin/list-users?limit=500')).json.users as { id: string; email: string }[]
      uid = users.find((u) => u.email === email)!.id
      await loginScreen(g, email, temp)
      await expect(g.getByRole('tab', { name: '이번 달' })).toBeVisible({ timeout: 15_000 })
      await guest.clearCookies()

      // the policy: minimum 12, through the admin sheet
      await page.getByRole('tab', { name: '로그인 방식' }).click()
      await page.getByRole('button', { name: '비밀번호 설정' }).click()
      await sheet(page, '비밀번호 로그인').locator('#pp-min').fill('12')
      await saveSheet(page, '비밀번호 로그인')
      expect(((await api(request, 'GET', '/api/admin/password-policy')).json as { policy: Policy }).policy).toEqual({ ...DEFAULT, minLength: 12 })
      // change-password: the screen says 12, and the server refuses 11
      await page.goto('/settings/security')
      await expect(page.getByText('이 서버의 비밀번호 최소 길이: 12자')).toBeVisible()
      await page.locator('#a-cur').fill('not-checked-here')
      await page.locator('#a-new').fill('eleven11111')
      await page.locator('#a-again').fill('eleven11111')
      // the field's minlength follows the policy, so the browser stops the form before it is sent
      await expect(page.locator('#a-new')).toHaveAttribute('minlength', '12')
      const sent: string[] = []
      page.on('request', (r) => { if (r.url().includes('/change-password')) sent.push(r.url()) })
      await page.locator('form.pwc').getByRole('button', { name: '바꾸기', exact: true }).click()
      expect(await page.locator('#a-new').evaluate((e) => (e as HTMLInputElement).validity.tooShort)).toBe(true)
      expect(sent).toEqual([])
      const cp = await api(request, 'POST', '/api/auth/change-password', { currentPassword: 'x', newPassword: 'eleven11111' })
      expect(cp.status).toBe(400)
      expect(cp.json.code).toBe('PASSWORD_TOO_SHORT')
      // admin create-user and set-password (A-42): the screen and the server refuse 11
      await page.goto('/admin')
      await page.getByRole('button', { name: '계정 만들기' }).click()
      const c2 = sheet(page, '새 계정')
      await c2.getByLabel('이메일').fill(`${MARK.toLowerCase()}-short@example.com`)
      await c2.getByLabel('이름').fill('E2E short')
      await c2.getByRole('button', { name: '직접 정하기' }).click()
      await c2.locator('#u-pw').fill('eleven11111')
      await c2.getByRole('button', { name: '저장' }).click()
      await expect(c2).toContainText('임시 비밀번호는 12자 이상이어야 해요.')
      await c2.getByRole('button', { name: '취소', exact: true }).click()
      expect((await api(request, 'POST', '/api/auth/admin/create-user', { email: `${MARK.toLowerCase()}-short@example.com`, password: 'eleven11111', name: 'x', role: 'user' })).json.code).toBe('PASSWORD_TOO_SHORT')
      expect((await api(request, 'POST', '/api/auth/admin/set-user-password', { userId: uid, newPassword: 'eleven11111' })).json.code).toBe('PASSWORD_TOO_SHORT')
      // the 20-character password made before the policy still signs in (checked below after the unlock)

      // lockout on: 3 attempts, LOCK_MIN minutes
      await page.getByRole('tab', { name: '로그인 방식' }).click()
      await page.getByRole('button', { name: '비밀번호 설정' }).click()
      const ls = sheet(page, '비밀번호 로그인')
      await ls.getByRole('switch', { name: '연속 실패 잠금' }).check()
      await ls.locator('#pp-att').fill('3')
      await ls.locator('#pp-min2').fill(String(LOCK_MIN))
      await saveSheet(page, '비밀번호 로그인')
      for (const n of [1, 2, 3]) {
        await loginScreen(g, email, `wrong-password-${n}`)
        await expect(g.getByRole('alert')).toContainText('이메일 또는 비밀번호')
      }
      await loginScreen(g, email, temp)
      await expect(g.getByRole('alert')).toHaveText(/^로그인 시도가 너무 많아요\. [1-5]분 뒤에 다시 시도하세요\.$/)
      // the admin sees the lock and unlocks it
      await page.reload()
      await page.getByRole('tab', { name: '로그인 방식' }).click()
      await page.getByRole('button', { name: '비밀번호 설정' }).click()
      const us = sheet(page, '비밀번호 로그인')
      await expect(us.locator('ul.locks')).toContainText(email)
      await us.getByRole('button', { name: `${email} 잠금 풀기` }).click()
      // the page's notice line is behind the open sheet (out of the accessibility tree while the sheet is modal)
      await expect(page.locator('p[role="status"]')).toContainText(`${email} 잠금을 풀었어요.`)
      await expect(us.locator('ul.locks')).toHaveCount(0)
      await us.getByRole('button', { name: '취소', exact: true }).click()
      await loginScreen(g, email, temp)
      await expect(g.getByRole('tab', { name: '이번 달' })).toBeVisible({ timeout: 15_000 })
      await guest.clearCookies()
      // lockout off: wrong tries are only wrong
      expect((await api(request, 'PUT', '/api/admin/password-policy', { minLength: 12, lockout: { enabled: false, attempts: 3, minutes: LOCK_MIN } })).status).toBe(200)
      for (const n of [1, 2, 3]) await loginScreen(g, email, `wrong-again-${n}`)
      await loginScreen(g, email, temp)
      await expect(g.getByRole('tab', { name: '이번 달' })).toBeVisible({ timeout: 15_000 })
    } finally {
      await guest.close()
      expect((await api(request, 'PUT', '/api/admin/password-policy', DEFAULT)).status).toBe(200)
      if (uid) expect((await api(request, 'DELETE', `/api/admin/users/${uid}`, { confirmEmail: email })).status).toBe(204)
    }
  })

  test('(V-21) API keys: rename, scope read ↔ write with its confirmation, extend 30 days, the usage line', async ({ page, request, baseURL }) => {
    const made = await api(request, 'POST', '/api/keys', { name: `${MARK}-k`, expiresInDays: 30 })
    expect(made.status).toBe(201)
    const id = made.json.item.id as string
    const keyOf = async () => ((await api(request, 'GET', '/api/keys')).json.keys as { id: string; name: string; permissions: { mcp?: string[] }; confirm: string | null; expiresAt: string; requestCount: number; lastUsedAt: string | null }[]).find((k) => k.id === id)!
    try {
      await page.goto('/settings/ai')
      await page.getByRole('button', { name: `${MARK}-k 키 관리` }).click()
      let s = sheet(page, `${MARK}-k 키`)
      await s.getByRole('button', { name: '이름 바꾸기' }).click()
      await s.getByLabel('이름', { exact: true }).fill(`  ${MARK}-renamed  `)
      await s.getByRole('button', { name: '이름 저장' }).click()
      await expect(page.getByText(`키 이름을 '${MARK}-renamed'(으)로 바꿨어요.`)).toBeVisible()
      expect((await keyOf()).name).toBe(`${MARK}-renamed`)
      s = sheet(page, `${MARK}-renamed 키`)
      // read → write, confirmed in the chat
      await s.getByRole('button', { name: '범위 바꾸기' }).click()
      await s.getByRole('radio', { name: /쓰기 제안 허용/ }).click()
      await s.getByLabel('대화 안에서 확인').check()
      await s.getByRole('button', { name: '범위 저장' }).click()
      await expect(page.getByText('키 범위를 바꿨어요.')).toBeVisible()
      let k = await keyOf()
      expect(k.permissions.mcp).toContain('write')
      expect(k.confirm).toBe('chat')
      await expect(page.locator('tr', { hasText: `${MARK}-renamed` })).toContainText('쓰기') // the table is behind the open sheet
      // write → read
      await s.getByRole('button', { name: '범위 바꾸기' }).click()
      await s.getByRole('radio', { name: /읽기 전용/ }).click()
      await s.getByRole('button', { name: '범위 저장' }).click()
      await expect.poll(async () => (await keyOf()).permissions.mcp).toEqual(['read'])
      expect((await keyOf()).confirm).toBe(null)
      // extend 30 days from now
      await s.getByRole('button', { name: '만료 연장' }).click()
      // the choice names the date it gives (review rc3-1 F-9): "30일 · YYYY-MM-DD까지"
      await s.getByRole('button', { name: /^30일 · / }).click()
      await expect(page.getByText('만료일을 바꿨어요.')).toBeVisible()
      k = await keyOf()
      expect(Math.abs(new Date(k.expiresAt).getTime() - (Date.now() + 30 * 86_400_000))).toBeLessThan(120_000)
      // the usage line: a request with the key shows up
      await tool(baseURL!, made.json.key, 'get_overview', {})
      await page.reload()
      await page.getByRole('button', { name: `${MARK}-renamed 키 관리` }).click()
      s = sheet(page, `${MARK}-renamed 키`)
      const usage = s.locator('dl.usage')
      await expect(usage).toContainText('마지막 사용')
      await expect(usage).not.toContainText('아직 안 씀')
      expect(sepDigits(await usage.locator('dd.num').innerText())).toBeGreaterThanOrEqual(1)
      await s.getByRole('button', { name: '닫기', exact: true }).last().click()
    } finally {
      await api(request, 'DELETE', `/api/keys/${id}`)
    }
  })
})
