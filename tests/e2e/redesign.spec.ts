// spec 007 V-4 (d), V-6, V-8, V-9 (a): the redesign in the browser.
// Changes the signed-in user's display settings, settings and holiday sets, and puts every value
// back at the end of each test (also when it fails). Creates and deletes one extra account (V-6 b).
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK } from './helpers'

async function api(request: APIRequestContext, method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
const state = async (request: APIRequestContext) => (await api(request, 'GET', '/api/state')).json
const cssVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toUpperCase(), name)
const ROUTES = ['home', 'subs', 'pay', 'events', 'history', 'settings/general', 'settings/theme', 'settings/security', 'admin', 'dev']

test.describe.configure({ mode: 'serial' })

test('(V-6 a) general settings: date format and amount unit apply, survive a reload', async ({ page, request }) => {
  const s0 = await state(request)
  const sub = await api(request, 'POST', '/api/subscriptions', {
    name: MARK, category: 'tool', plan: 'p', amount: 9900, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false,
  })
  try {
    await page.goto('/#settings/general')
    const form = page.getByRole('form', { name: '일반 설정' })
    await form.getByRole('group', { name: '날짜 형식' }).getByRole('button', { name: '2026. 11. 14.' }).click()
    await form.getByRole('group', { name: '금액 단위' }).getByRole('button', { name: '만원' }).click()
    await form.getByRole('button', { name: '저장' }).click()
    await expect(form.getByRole('status').last()).toHaveText('저장했어요.')
    await page.reload()
    await page.goto('/#subs')
    await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText(/\d{4}\. \d{2}\. 15\./)
    await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('1만원')
    await page.goto('/#home')
    await expect(page.getByRole('region', { name: '이번 달 요약' }).or(page.locator('section[aria-label="이번 달 요약"]'))).toContainText('만원')
  } finally {
    await api(request, 'PUT', '/api/preferences', s0.preferences)
    await api(request, 'DELETE', `/api/subscriptions/${sub.json.id}`)
  }
})

test('(V-6 b, c) theme: only the preview changes before saving; saved colour stays after reload, other users keep theirs', async ({ page, request, browser }) => {
  const s0 = await state(request)
  const email = `e2e-theme-${Date.now().toString(36)}@example.com`
  const made = await api(request, 'POST', '/api/auth/admin/create-user', { email, name: 'E2E theme', password: 'e2e-theme-pass-1' })
  expect(made.status).toBe(200)
  try {
    await page.goto('/#settings/theme')
    const before = await cssVar(page, '--primary')
    await page.getByRole('radio', { name: '파랑' }).click()
    // (c) the preview box takes the colour, the page does not
    await expect.poll(() => page.locator('.box').evaluate((e) => getComputedStyle(e).getPropertyValue('--primary').trim().toUpperCase())).toBe('#1F5F8B')
    expect(await cssVar(page, '--primary')).toBe(before)
    await page.getByRole('form', { name: '테마 설정' }).getByRole('button', { name: '저장' }).click()
    await expect.poll(() => cssVar(page, '--primary')).toBe('#1F5F8B')
    await page.reload()
    await expect.poll(() => cssVar(page, '--primary')).toBe('#1F5F8B')

    // (b) another account, same moment: the default colour
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const g = await ctx.newPage()
    await g.goto('/')
    await g.getByLabel('이메일').fill(email)
    await g.getByLabel('비밀번호').fill('e2e-theme-pass-1')
    await g.getByRole('button', { name: '로그인', exact: true }).click()
    await g.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })
    expect(await cssVar(g, '--primary')).toBe('#14705A')
    await ctx.close()
  } finally {
    await api(request, 'PUT', '/api/preferences', s0.preferences)
    const u = (await api(request, 'GET', '/api/auth/admin/list-users?limit=500')).json.users.find((x: { email: string }) => x.email === email)
    if (u) await api(request, 'DELETE', `/api/admin/users/${u.id}`, { confirmEmail: email })
  }
})

test('(V-4 d) the pay day moves to the business day the rules give: month end, year end, after a substitute holiday', async ({ page, request }) => {
  const s0 = await state(request)
  // The built-in Korean set must be on for these cases; put it back as it was afterwards.
  const kr = s0.holidaySets.find((h: { builtin: string | null }) => h.builtin === 'kr')
  if (kr && !kr.enabled) await api(request, 'PUT', `/api/holiday-sets/${kr.id}`, { name: kr.name, enabled: true, builtin: 'kr', rules: [] })
  // Expected days written by hand from the calendar and the public-holiday rules (not computed by the app's code):
  const cases = [
    { now: '2026-08-10T12:00:00+09:00', payDay: 1, shift: 'before', want: '월급 7/31(금) (앞당김)' }, // 8/1 Saturday → Friday in July
    { now: '2027-01-10T12:00:00+09:00', payDay: 1, shift: 'before', want: '월급 12/31(목) (앞당김)' }, // 1/1 신정 → last year
    { now: '2026-10-10T12:00:00+09:00', payDay: 3, shift: 'after', want: '월급 10/6(화) (미룸)' }, // 10/3 Sat 개천절, 10/5 substitute
    { now: '2026-08-10T12:00:00+09:00', payDay: 1, shift: 'none', want: '월급 8/1(토)' },
  ] as const
  try {
    for (const c of cases) {
      expect((await api(request, 'PUT', '/api/settings', { ...s0.settings, payDay: c.payDay, dayShift: c.shift })).status).toBe(200)
      await page.clock.setFixedTime(new Date(c.now))
      await page.goto('/#home')
      await page.reload()
      const header = page.locator('header.ph')
      await expect(header, `${c.now} ${c.shift}`).toContainText(c.want)
      if (c.shift === 'none') await expect(header).not.toContainText('(앞당김)')
    }
  } finally {
    await api(request, 'PUT', '/api/settings', s0.settings)
    if (kr && !kr.enabled) await api(request, 'PUT', `/api/holiday-sets/${kr.id}`, { name: kr.name, enabled: false, builtin: 'kr', rules: [] })
  }
})

test('(V-6 d) the calendar shows the monthly dates and the holidays of the sets that are on', async ({ page, request }) => {
  const s0 = await state(request)
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const set = await api(request, 'POST', '/api/holiday-sets', { name: `${MARK}-set`, enabled: true, builtin: null, rules: [{ name: `${MARK}-day`, rdate: [today] }] })
  expect(set.status).toBe(201)
  try {
    await page.goto('/#events')
    const cal = page.getByRole('region', { name: '이번 달 일정 달력' })
    await expect(cal).toContainText('월급')
    await expect(cal).toContainText('분배')
    await expect(cal).toContainText(`${MARK}-day`)
    // Turn the set off in settings: the holiday leaves the calendar.
    await page.goto('/#settings/general')
    await page.getByRole('button', { name: `${MARK}-set 끄기` }).click()
    await expect(page.getByRole('button', { name: `${MARK}-set 켜기` })).toBeVisible()
    await page.goto('/#events')
    await expect(page.getByRole('region', { name: '이번 달 일정 달력' })).toContainText('월급')
    await expect(page.getByRole('region', { name: '이번 달 일정 달력' })).not.toContainText(`${MARK}-day`)
  } finally {
    await api(request, 'DELETE', `/api/holiday-sets/${set.json.id}`)
    expect((await state(request)).holidaySets.length).toBe(s0.holidaySets.length)
  }
})

test('(V-6 e) no menu, button or text for features that do not exist', async ({ page }) => {
  const banned = ['명세서 분석', 'AI 어시스턴트', 'AI·연동', 'AI 분석', 'CSV 내보내기', 'API 문서', '마지막 동기화', '명세서에서 채우기']
  for (const r of ROUTES) {
    await page.goto(`/#${r}`)
    await page.locator('header.ph h1').waitFor()
    const text = await page.locator('body').innerText()
    for (const b of banned) expect(text, `#${r}`).not.toContain(b)
  }
})

test('(V-6 f) editor modal: focus inside, Tab stays inside, Esc closes and returns focus', async ({ page }) => {
  await page.goto('/#subs')
  const opener = page.getByRole('button', { name: '구독 추가' })
  await opener.click()
  const dlg = page.getByRole('dialog', { name: '구독 추가' })
  await expect(dlg).toBeVisible()
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('e-name')
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
  await expect(opener).toBeFocused()
})

test('(V-6 g) /#account opens 설정 › 로그인·보안', async ({ page }) => {
  await page.goto('/#account')
  await expect(page.getByRole('tab', { name: '로그인·보안' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: '로그인 방식' })).toBeVisible()
})

test('(V-8) every request goes to the app; the calendar code loads only with a calendar', async ({ page }) => {
  const base = new URL(test.info().project.use.baseURL!)
  const hosts = new Set<string>()
  const calendarFetches: string[] = []
  page.on('request', (r) => {
    const u = new URL(r.url())
    hosts.add(u.host)
    if (/fullcalendar|CalendarView|rrule-temporal/.test(u.pathname)) calendarFetches.push(u.pathname)
  })
  await page.goto('/#home')
  await page.locator('header.ph h1').waitFor()
  await page.waitForLoadState('networkidle')
  expect(calendarFetches, 'nothing of the calendar on the first screen').toEqual([])
  for (const r of ROUTES) {
    await page.goto(`/#${r}`)
    await page.locator('header.ph h1').waitFor()
  }
  await page.goto('/#events')
  await page.getByRole('region', { name: '이번 달 일정 달력' }).waitFor()
  await page.waitForLoadState('networkidle')
  expect(calendarFetches.length, 'the calendar tab fetched its code').toBeGreaterThan(0)
  expect([...hosts]).toEqual([base.host])
})

test.describe('(V-9 a) phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('no page scrolls sideways; the bottom bar reaches every main page', async ({ page }) => {
    for (const r of ROUTES) {
      await page.goto(`/#${r}`)
      await page.locator('header.ph h1').waitFor()
      await page.waitForTimeout(300)
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
      expect(sw, `#${r} scrollWidth`).toBeLessThanOrEqual(iw)
    }
    const bar = page.getByRole('navigation', { name: '메뉴' }).last()
    for (const [label, title] of [['현황', /현황$/], ['구독', '구독'], ['월급 분배', '월급 분배'], ['일정', '일정'], ['변경 내역', '변경 내역'], ['설정', '설정']] as const) {
      await bar.getByRole('link', { name: label }).click()
      await expect(page.locator('header.ph h1')).toHaveText(title)
    }
  })
})

test('(V-13 b) a 429 on the session check shows a wait note, not the login form; retries follow X-Retry-After; the app comes back', async ({ page }) => {
  const times: number[] = []
  let refusals = 3
  await page.route('**/api/auth/get-session*', (route) => {
    times.push(Date.now())
    if (refusals-- > 0) return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'X-Retry-After': '2' }, body: '{"message":"Too many requests. Please try again later."}' })
    return route.continue()
  })
  await page.goto('/#home')
  await expect(page.getByRole('status').filter({ hasText: '요청이 많아요' })).toBeVisible()
  await expect(page.getByLabel('비밀번호')).toHaveCount(0)
  await expect(page.locator('header.ph h1')).toContainText('현황', { timeout: 30_000 })
  // first refusal, then one retry per X-Retry-After (2 s) — never a burst of retries
  const gaps = times.slice(1, 4).map((t, i) => t - times[i]!)
  expect(gaps.length).toBe(3)
  for (const g of gaps.slice(1)) expect(g).toBeGreaterThanOrEqual(1900)
})
