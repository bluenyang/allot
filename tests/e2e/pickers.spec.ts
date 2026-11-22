// spec 010 V-14 (S-14, W-12): the date and month fields, content-width segments in modals, the delete
// confirmation and the instant-save toast. Every test puts back what it made, also when it fails.
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { MARK as RUN, fillDate, go, readDate, saveSheet, sheet } from './helpers'

const MARK = `${RUN}-pk`
async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
type Phase = { id: string; label: string; name: string; from: string; to: string | null; amounts: Record<string, number>; note?: string }
type State = { phases: Phase[]; subscriptions: { id: string; name: string; nextDate: string }[]; events: { id: string; title: string; when: string }[]; preferences: Record<string, unknown> }
const state = async (request: APIRequestContext) => (await api(request, 'GET', '/api/state')).json as State

test.afterEach(async ({ request }) => {
  const s = await state(request)
  for (const x of s.subscriptions.filter((x) => x.name.startsWith(MARK))) await api(request, 'DELETE', `/api/subscriptions/${x.id}`)
  for (const e of s.events.filter((x) => x.title.startsWith(MARK))) await api(request, 'DELETE', `/api/events/${e.id}`)
})

/** The 구독 추가 sheet on its second step, named. */
async function openSub(page: Page, name: string) {
  await go(page, 'subs', '목록')
  await page.getByRole('button', { name: '구독 추가' }).click()
  const s = sheet(page, '구독 추가')
  await s.getByLabel('서비스 이름').fill(name)
  await s.getByRole('button', { name: '다음' }).click()
  await s.getByLabel('금액', { exact: true }).fill('1000')
  return s
}

test('(V-14 a) DateInput: typed from the keyboard, picked in the calendar, Escape closes the calendar first; the stored string is YYYY-MM-DD', async ({ page, request }) => {
  const s = await openSub(page, `${MARK}-date`)
  const field = s.getByRole('group', { name: '다음 결제일' })
  await fillDate(field, '2031-01-15')
  expect(await readDate(field)).toBe('2031-01-15')
  // the calendar shows the typed day selected; pick another one
  await field.getByRole('button', { name: '달력 열기' }).click()
  const card = page.locator('.dp-pop')
  await expect(card).toBeVisible()
  await expect(card.locator('[data-reka-calendar-cell-trigger][data-selected]')).toHaveAttribute('data-value', '2031-01-15')
  await card.locator('[data-reka-calendar-cell-trigger][data-value="2031-01-20"]').click()
  await expect(card).toBeHidden()
  expect(await readDate(field)).toBe('2031-01-20')
  // next month, then Escape: the calendar closes, the sheet stays
  await field.getByRole('button', { name: '달력 열기' }).click()
  await card.getByRole('button', { name: '다음 달' }).click()
  await card.locator('[data-reka-calendar-cell-trigger][data-value="2031-02-10"]').click()
  expect(await readDate(field)).toBe('2031-02-10')
  await field.getByRole('button', { name: '달력 열기' }).click()
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  await expect(s).toBeVisible()
  // a half-typed date is not a date: the sheet refuses to save until the last part is typed
  await field.getByRole('spinbutton').last().click()
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace') // the day part is empty now
  await s.getByRole('button', { name: '저장', exact: true }).click()
  await expect(s.getByRole('alert')).toContainText('다음 결제일')
  await field.getByRole('spinbutton').last().click()
  await page.keyboard.type('11')
  expect(await readDate(field)).toBe('2031-02-11')
  await saveSheet(page, '구독 추가')
  expect((await state(request)).subscriptions.find((x) => x.name === `${MARK}-date`)?.nextDate).toBe('2031-02-11')
  // reopened: the field shows the stored day
  await page.getByRole('button', { name: `${MARK}-date 수정` }).click()
  const e = sheet(page, '구독 수정')
  await e.getByRole('button', { name: '다음' }).click()
  expect(await readDate(e.getByRole('group', { name: '다음 결제일' }))).toBe('2031-02-11')
})

test('(V-14 b) MonthInput: typed, picked in the card, cleared; the end month card is limited to the start month\'s year; the stored string is YYYY-MM', async ({ page, request }) => {
  await go(page, 'events', '타임라인')
  await page.getByRole('button', { name: '이벤트 추가', exact: true }).click()
  const s = sheet(page, '이벤트 추가')
  await s.getByLabel('내용').fill(`${MARK}-ev`)
  await s.getByRole('button', { name: '기간', exact: true }).click()
  const from = s.getByLabel('시작 월')
  const to = s.getByLabel('끝 월')
  // keyboard: a full month is taken as typed; a loose one on leaving the field
  await from.fill('2031-01')
  await expect(from).toHaveValue('2031-01')
  await to.fill('2031-2')
  await to.blur()
  await expect(to).toHaveValue('2031-02')
  // the card of the end month: year 2031 only (the year arrows are limited), the chosen month selected
  await s.getByRole('button', { name: '달력 열기' }).nth(1).click()
  const card = page.locator('.dp-pop.mp')
  await expect(card).toBeVisible()
  await expect(card.locator('[data-reka-month-picker-cell-trigger][data-selected]')).toHaveAttribute('data-value', /^2031-02/)
  await expect(card.getByRole('button', { name: '이전 해' })).toBeDisabled()
  await expect(card.getByRole('button', { name: '다음 해' })).toBeDisabled()
  await expect(card.locator('[data-reka-month-picker-cell-trigger]')).toHaveCount(12)
  await card.locator('[data-reka-month-picker-cell-trigger][data-value^="2031-06"]').click()
  await expect(card).toBeHidden()
  await expect(to).toHaveValue('2031-06')
  // Escape closes the card first, then the sheet
  await s.getByRole('button', { name: '달력 열기' }).first().click()
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  await expect(s).toBeVisible()
  // a month typed outside the limits is still taken (the native field took it)
  await to.fill('2032-02')
  await expect(to).toHaveValue('2032-02')
  // clearing: the clear button empties the field and goes away
  await s.getByRole('button', { name: '지우기' }).last().click()
  await expect(to).toHaveValue('')
  await expect(s.getByRole('button', { name: '지우기' })).toHaveCount(1) // the start month's own
  await to.fill('2031-06')
  await saveSheet(page, '이벤트 추가')
  expect((await state(request)).events.find((e) => e.title === `${MARK}-ev`)?.when).toBe('2031-01~06')
})

test('(V-14 b) MonthInput without clear (the filter months of 구독): emptying keeps the old month; a typed month moves the table', async ({ page }) => {
  await go(page, 'subs', '목록')
  const base = page.getByLabel('기준 월')
  const before = await base.inputValue()
  expect(before).toMatch(/^\d{4}-\d{2}$/)
  await base.fill('')
  await base.blur()
  await expect(base).toHaveValue(before)
  await base.fill('2031-03')
  await expect(base).toHaveValue('2031-03')
  await base.fill(before)
  await expect(base).toHaveValue(before)
})

for (const [name, size] of [['desktop', { width: 1200, height: 900 }], ['phone', { width: 390, height: 800 }]] as const) {
  test(`(V-14 c) segments in a modal are content width, not the field's (${name})`, async ({ page }) => {
    await page.setViewportSize(size)
    await go(page, 'subs', '목록')
    await page.getByRole('button', { name: '구독 추가' }).click()
    const s = sheet(page, '구독 추가')
    const check = async (group: string, fieldLabel: string) => {
      const seg = s.getByRole('group', { name: group })
      const w = (await seg.boundingBox())!.width
      const buttons = await seg.getByRole('button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
      const field = (await s.getByLabel(fieldLabel, { exact: true }).boundingBox())!.width
      expect(w, `${group}: the group is its buttons plus the track padding`).toBeLessThanOrEqual(buttons.reduce((a, b) => a + b, 0) + 12)
      expect(w, `${group}: narrower than a field`).toBeLessThan(field * 0.8)
    }
    await check('상태', '서비스 이름')
    await s.getByLabel('서비스 이름').fill(`${MARK}-w`)
    await s.getByRole('button', { name: '다음' }).click()
    await check('결제 주기', '금액')
  })
}

test('(V-14 d) delete asks in a dialog: cancel and Escape keep the item, confirm deletes it (API)', async ({ page, request }) => {
  const made = await api(request, 'POST', '/api/events', { when: '2031-04', kind: '저축', title: `${MARK}-del`, state: 'todo' })
  expect(made.status).toBeLessThan(300)
  const exists = async () => (await state(request)).events.some((e) => e.title === `${MARK}-del`)
  await go(page, 'events', '타임라인')
  await page.getByRole('button', { name: `${MARK}-del 수정` }).click()
  const s = sheet(page, '이벤트 수정')
  const ask = page.getByRole('alertdialog')
  await s.getByRole('button', { name: '삭제' }).click()
  await expect(ask).toContainText(`${MARK}-del을(를) 삭제할까요?`)
  await expect(ask.getByRole('button', { name: '취소' })).toBeFocused()
  await ask.getByRole('button', { name: '취소' }).click()
  await expect(ask).toBeHidden()
  await expect(s).toBeVisible()
  expect(await exists()).toBe(true)
  // Escape closes the question, not the sheet
  await s.getByRole('button', { name: '삭제' }).click()
  await expect(ask).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ask).toBeHidden()
  await expect(s).toBeVisible()
  expect(await exists()).toBe(true)
  // one press no longer deletes; the confirm does
  await s.getByRole('button', { name: '삭제' }).click()
  await ask.getByRole('button', { name: '삭제', exact: true }).click()
  await expect(s).toBeHidden()
  await expect.poll(exists).toBe(false)
})

test('(V-14 e) an instant save is told in a toast, there is no line in the card, and no card changes height', async ({ page, request }) => {
  const s0 = await state(request)
  try {
    await page.goto('/settings/general')
    const group = page.getByRole('group', { name: '날짜 형식' })
    await group.waitFor()
    const heights = () => page.locator('.set').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))
    const before = await heights()
    expect(before.length).toBeGreaterThan(2)
    // every instant choice of the screen: a toast tells it, nothing in the cards changes height
    const picks = [
      page.getByRole('group', { name: '날짜 형식' }).getByRole('button'),
      page.getByRole('group', { name: '금액 단위' }).getByRole('button'),
      page.getByRole('group', { name: '음수 표기' }).getByRole('button'),
      page.getByRole('radiogroup', { name: '선호 테마' }).getByRole('radio'),
    ]
    for (const options of picks) {
      for (let i = 0; i < (await options.count()); i++) {
        const target = options.nth(i)
        if ((await target.getAttribute('aria-pressed')) === 'true' || (await target.getAttribute('aria-checked')) === 'true') continue
        const saved = page.waitForResponse((r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PUT' && r.ok())
        await target.click()
        await saved
        await expect(page.locator('.toast')).toContainText(/바로 (저장|적용)했어요\./)
        await expect(page.locator('.set [role="status"]')).toHaveCount(0)
        expect(await heights(), 'while the toast is up').toEqual(before)
      }
    }
    await expect(page.locator('.toast')).toBeHidden({ timeout: 8000 })
    expect(await heights(), 'after the toast has gone').toEqual(before)
  } finally {
    // put the account's display preferences back and check that they are back
    const back = await api(request, 'PUT', '/api/preferences', s0.preferences)
    expect(back.status, 'restoring the preferences').toBeLessThan(300)
    expect((await state(request)).preferences).toEqual(s0.preferences)
  }
})

test('(V-14 b, A-41) a half-erased month is "empty", as the native field gave: event range end, required phase start', async ({ page, request }) => {
  await go(page, 'events', '타임라인')
  await page.getByRole('button', { name: '이벤트 추가', exact: true }).click()
  const s = sheet(page, '이벤트 추가')
  await s.getByLabel('내용').fill(`${MARK}-half`)
  await s.getByRole('button', { name: '기간', exact: true }).click()
  await s.getByLabel('시작 월').fill('2031-01')
  await s.getByLabel('끝 월').fill('2031-06')
  await s.getByLabel('끝 월').fill('2031-') // the month part erased: no end month, not the old 2031-06
  await expect(s.getByLabel('끝 월')).toHaveValue('2031-')
  await s.getByLabel('끝 월').blur()
  await expect(s.getByLabel('끝 월')).toHaveValue('2031-')
  await saveSheet(page, '이벤트 추가')
  expect((await state(request)).events.find((e) => e.title === `${MARK}-half`)?.when).toBe('2031-01')

  await go(page, 'pay', '구간')
  await page.getByRole('button', { name: '+ 구간 추가' }).click()
  const add = sheet(page, '구간 추가')
  await add.getByLabel('이름').fill(`${MARK}-ph`)
  await add.getByLabel('시작 월').fill('2090-01')
  await add.getByLabel('시작 월').fill('2090-') // required field half erased: its own error, not a silent 2090-01
  await add.getByRole('button', { name: '저장' }).click()
  await expect(add.getByRole('alert')).toContainText('시작')
  await add.getByRole('button', { name: '취소' }).click()
})

test('(V-14 b, A-41) a Payroll phase end month erased to "2095-" saves no end (null), not the old end (temporary account)', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000)
  // The owner's data is never written: a temporary account holds the phases. Earlier specs sign in too: start with an empty login window.
  await new Promise((r) => setTimeout(r, 60_000))
  const email = `e2e-pk-end-${Date.now().toString(36)}@example.com`
  const pass = 'e2e-pk-end-pass-1'
  const created = await api(request, 'POST', '/api/auth/admin/create-user', { email, name: 'E2E pk', password: pass })
  expect(created.status).toBe(200)
  const userId = (created.json as { user: { id: string } }).user.id
  let ctx: BrowserContext | undefined
  try {
    ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, locale: 'ko-KR' })
    const c = ctx
    const mine = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) => {
      const r = await c.request.fetch(path, { method, data, headers: { origin: baseURL! } })
      return { status: r.status(), json: await r.json().catch(() => null) }
    }
    const page = await c.newPage()
    await page.goto('/')
    await page.getByLabel('이메일').fill(email)
    await page.getByLabel('비밀번호').fill(pass)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await page.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })
    // an open-ended phase would overlap 2095: close any of this account's own
    for (const ph of ((await mine('GET', '/api/state')).json as State).phases.filter((x) => x.to === null)) expect((await mine('PUT', `/api/phases/${ph.id}`, { ...ph, to: '2089-12' })).status).toBeLessThan(300)
    const made = await mine('POST', '/api/phases', { label: '', name: `${MARK}-ph2`, from: '2095-01', to: '2095-06', amounts: {}, note: MARK })
    expect(made.status).toBeLessThan(300)
    const id = (made.json as { id: string }).id
    await page.goto('/pay')
    await page.reload() // the phase was made after the sign-in loaded the state
    await page.getByRole('tablist').first().waitFor()
    await page.getByRole('tab', { name: '구간' }).click()
    await page.getByRole('button', { name: `${MARK}-ph2 구간 수정` }).click()
    const s = sheet(page, '구간 수정')
    const end = s.getByLabel('끝 월 (비우면 계속)')
    await expect(end).toHaveValue('2095-06')
    await end.fill('2095-') // the month part erased
    await saveSheet(page, '구간 수정')
    expect(((await mine('GET', '/api/state')).json as State).phases.find((p) => p.id === id)?.to).toBeNull()
  } finally {
    try {
      await ctx?.close()
    } catch { /* the account is deleted below whatever the context did */ }
    const del = await api(request, 'DELETE', `/api/admin/users/${userId}`, { confirmEmail: email })
    expect(del.status, 'the temporary account is deleted').toBeLessThan(300)
    const left = (await api(request, 'GET', '/api/auth/admin/list-users?limit=500')).json.users as { email: string }[]
    expect(left.some((x) => x.email === email), 'the temporary account is gone').toBe(false)
  }
})
