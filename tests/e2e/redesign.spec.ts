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
const ROUTES = ['home', 'spend/subs', 'pay', 'events', 'history', 'settings/general', 'settings/theme', 'settings/security', 'admin', 'dev']

test.describe.configure({ mode: 'serial' })

test('(V-6 a) general settings: date format and amount unit apply, survive a reload', async ({ page, request }) => {
  const s0 = await state(request)
  const sub = await api(request, 'POST', '/api/subscriptions', {
    name: MARK, category: 'tool', plan: 'p', amount: 9900, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false,
  })
  try {
    await page.goto('/settings/general')
    // 표시 형식 saves the moment a choice is made: no save button
    const saved = () => page.waitForResponse((r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PUT' && r.ok())
    let done = saved()
    await page.getByRole('group', { name: '날짜 형식' }).getByRole('button', { name: '2026. 11. 14.' }).click()
    await done
    done = saved()
    await page.getByRole('group', { name: '금액 단위' }).getByRole('button', { name: '만원' }).click()
    await done
    await expect(page.getByRole('status').filter({ hasText: '바로 저장했어요.' })).toBeVisible()
    await page.reload()
    await page.goto('/spend/subs')
    await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText(/\d{4}\. \d{2}\. 15\./)
    await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('1만원')
    await page.goto('/')
    await expect(page.getByRole('region', { name: '이번 달 여유' })).toContainText('만원')
  } finally {
    await api(request, 'PUT', '/api/preferences', s0.preferences)
    await api(request, 'DELETE', `/api/subscriptions/${sub.json.id}`)
  }
})

test('(W-8, A-21) two display formats picked while the first save is still on its way: both are kept', async ({ page, request }) => {
  const s0 = await state(request)
  try {
    await page.goto('/settings/general')
    await page.getByRole('group', { name: '날짜 형식' }).waitFor()
    let delayed = false
    await page.route('**/api/preferences', async (route) => {
      if (route.request().method() === 'PUT' && !delayed) { delayed = true; await new Promise((r) => setTimeout(r, 2000)) }
      await route.continue()
    })
    const puts: string[] = []
    page.on('request', (r) => { if (r.method() === 'PUT' && r.url().endsWith('/api/preferences')) puts.push(r.postData() ?? '') })
    await page.getByRole('group', { name: '날짜 형식' }).getByRole('button', { name: '2026. 11. 14.' }).click()
    await page.getByRole('group', { name: '금액 단위' }).getByRole('button', { name: '만원' }).click() // while the first is on its way
    await expect.poll(() => puts.length, { timeout: 15_000 }).toBe(2)
    await expect(page.getByRole('status').filter({ hasText: '바로 저장했어요.' })).toBeVisible()
    const saved = (await state(request)).preferences
    expect(saved.dateFormat, 'the first pick survives').toBe('dot')
    expect(saved.amountUnit).toBe('man')
    expect(JSON.parse(puts[1]!).dateFormat, 'the second save carries the first pick').toBe('dot')
  } finally {
    await api(request, 'PUT', '/api/preferences', s0.preferences)
  }
})

test('(V-6 b, c) theme: only the preview changes before saving; saved colour stays after reload, other users keep theirs', async ({ page, request, browser }) => {
  const s0 = await state(request)
  const email = `e2e-theme-${Date.now().toString(36)}@example.com`
  const made = await api(request, 'POST', '/api/auth/admin/create-user', { email, name: 'E2E theme', password: 'e2e-theme-pass-1' })
  expect(made.status).toBe(200)
  try {
    await page.goto('/settings/theme')
    const before = await cssVar(page, '--primary')
    await page.getByRole('radio', { name: '파랑', exact: true }).click()
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
      await page.goto('/')
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
    await page.goto('/events')
    const cal = page.getByRole('region', { name: '이번 달 일정 달력' })
    await expect(cal).toContainText('월급')
    await expect(cal).toContainText('분배')
    await expect(cal).toContainText(`${MARK}-day`)
    // Turn the set off in settings: the holiday leaves the calendar.
    await page.goto('/settings/general')
    await page.getByRole('switch', { name: `${MARK}-set 켜기` }).click()
    await expect(page.getByRole('switch', { name: `${MARK}-set 켜기` })).toHaveAttribute('aria-checked', 'false')
    await page.goto('/events')
    await expect(page.getByRole('region', { name: '이번 달 일정 달력' })).toContainText('월급')
    await expect(page.getByRole('region', { name: '이번 달 일정 달력' })).not.toContainText(`${MARK}-day`)
  } finally {
    await api(request, 'DELETE', `/api/holiday-sets/${set.json.id}`)
    expect((await state(request)).holidaySets.length).toBe(s0.holidaySets.length)
  }
})

test('(V-6 e) features that do not exist appear only as disabled "준비 중" entries', async ({ page }) => {
  // Spec 010 S-3 (user: "비활성화 해두고 '준비중' 표기해놓자") replaces spec 007's "stay hidden":
  // the names may be shown, but only inside an aria-disabled entry, never as a working control.
  // 설정 › AI·연동 is real since 0.1.3 (spec 008: API keys and the MCP connection), so it is not listed.
  const banned = ['명세서 분석', 'AI 어시스턴트', 'AI 분석', '명세서에서 채우기']
  for (const r of ROUTES) {
    await page.goto(`/${r}`)
    await page.locator('header.ph h1').waitFor()
    const text = await page.evaluate(() => {
      const copy = document.body.cloneNode(true) as HTMLElement
      copy.querySelectorAll('[aria-disabled="true"]').forEach((e) => e.remove())
      return copy.textContent ?? ''
    })
    for (const b of banned) expect(text, `/${r}`).not.toContain(b)
  }
})

test('(V-6 f) editor modal: focus inside, Tab stays inside, Esc closes and returns focus', async ({ page }) => {
  await page.goto('/spend/subs')
  const opener = page.getByRole('button', { name: '구독 추가' })
  await opener.click()
  const dlg = page.getByRole('dialog', { name: '구독 추가' })
  await expect(dlg).toBeVisible()
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('e-name')
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
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
  await page.goto('/')
  await page.locator('header.ph h1').waitFor()
  await page.waitForLoadState('networkidle')
  expect(calendarFetches, 'nothing of the calendar on the first screen').toEqual([])
  for (const r of ROUTES) {
    await page.goto(`/${r}`)
    await page.locator('header.ph h1').waitFor()
  }
  await page.goto('/events')
  await page.getByRole('region', { name: '이번 달 일정 달력' }).waitFor()
  await page.waitForLoadState('networkidle')
  expect(calendarFetches.length, 'the calendar tab fetched its code').toBeGreaterThan(0)
  expect([...hosts]).toEqual([base.host])
})

test.describe('(V-9 a) phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('no page scrolls sideways; the bottom bar reaches every main page', async ({ page }) => {
    for (const r of ROUTES) {
      await page.goto(`/${r}`)
      await page.locator('header.ph h1').waitFor()
      await page.waitForTimeout(300)
      const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
      expect(sw, `/${r} scrollWidth`).toBeLessThanOrEqual(iw)
    }
    // spec 010 S-4: the bar reaches 현황, 예산 (월급 분배), 일정; the rest is in the "더보기" sheet
    const bar = page.getByRole('navigation', { name: '메뉴' }).last()
    for (const [label, title] of [['현황', /^\d{4}년 \d{1,2}월$/], ['예산', '월급 분배'], ['일정', '일정']] as const) {
      await bar.getByRole('link', { name: label }).click()
      await expect(page.locator('header.ph h1')).toHaveText(title)
    }
    const sheet = page.getByRole('dialog', { name: '더보기' })
    for (const [label, title] of [['지출', '지출'], ['변경 내역', '변경 내역'], ['설정', '설정']] as const) {
      await bar.getByRole('button', { name: '더보기' }).click()
      await sheet.getByRole('link', { name: label }).click()
      await expect(page.locator('header.ph h1')).toHaveText(title)
      await expect(sheet).toBeHidden()
    }
  })
  test('(V-15) trend labels do not overlap; each subscription keeps its name and monthly amount on one line', async ({ page, request }) => {
    const sub = await api(request, 'POST', '/api/subscriptions', {
      name: `${MARK}-a-rather-long-service-name`, category: 'tool', plan: 'p', amount: 1234500, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false,
    })
    try {
      await page.goto('/')
      // the trend card is not drawn on a phone (spec 010 HM-21): look at it on a narrow desktop width
      await page.setViewportSize({ width: 800, height: 900 })
      const labels = page.locator('.bars .bv')
      await expect(labels.first()).toBeVisible()
      const boxes = (await labels.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.right])))
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]![0], `label ${i} starts after label ${i - 1} ends`).toBeGreaterThanOrEqual(boxes[i - 1]![1])
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/spend/subs')
      // a phone shows each subscription as a card (spec 010 SB-21): name and plan, monthly amount on the right
      const card = page.locator('.mcard', { hasText: MARK })
      const [name, monthly] = await Promise.all([card.locator('.m-name b').boundingBox(), card.locator('.m-amt').boundingBox()])
      expect(Math.abs(name!.y - monthly!.y), 'name and monthly amount share the first line').toBeLessThan(name!.height)
      expect(monthly!.x, 'monthly amount on the right').toBeGreaterThan(name!.x + 100)
    } finally {
      await api(request, 'DELETE', `/api/subscriptions/${sub.json.id}`)
    }
  })
})

test('(V-13 b) a 429 on the session check shows a wait note, not the login form, until the time the server gave; then the app', async ({ page }) => {
  const times: number[] = []
  let refusals = 2
  await page.route('**/api/auth/get-session*', (route) => {
    times.push(Date.now())
    if (refusals-- > 0) return route.fulfill({ status: 429, contentType: 'application/json', headers: { 'X-Retry-After': '6' }, body: '{"message":"Too many requests. Please try again later."}' })
    return route.continue()
  })
  await page.goto('/')
  const note = page.getByRole('status').filter({ hasText: '요청이 많아요' })
  await expect(note).toBeVisible()
  // the note holds, with no login form, through the whole wait (sampled every second)
  for (let i = 0; i < 5; i++) {
    await expect(page.getByLabel('비밀번호')).toHaveCount(0)
    await page.waitForTimeout(1000)
  }
  await expect(page.locator('header.ph h1')).toHaveText(/^\d{4}년 \d{1,2}월$/, { timeout: 30_000 })
  expect(times.length).toBeGreaterThanOrEqual(3)
  expect(times[1]! - times[0]!, 'the second check waits the 6 s the server gave').toBeGreaterThanOrEqual(5900)
  expect(times[2]! - times[1]!, 'and again').toBeGreaterThanOrEqual(5900)
})

test('(V-14 a, b) a new account starts light even on a dark OS; 선호 테마 applies at once and stays; the header has no theme switch (spec 010 D-10)', async ({ request, browser }) => {
  const email = `e2e-light-${Date.now().toString(36)}@example.com`
  expect((await api(request, 'POST', '/api/auth/admin/create-user', { email, name: 'E2E light', password: 'e2e-light-pass-1' })).status).toBe(200)
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, colorScheme: 'dark' })
  try {
    const g = await ctx.newPage()
    await g.goto('/')
    await g.getByLabel('이메일').fill(email)
    await g.getByLabel('비밀번호').fill('e2e-light-pass-1')
    await g.getByRole('button', { name: '로그인', exact: true }).click()
    await g.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })
    const bg = () => g.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await expect.poll(bg).toBe('rgb(245, 246, 245)')
    // the theme is chosen in Settings only: no light/dark button in the header or the phone bar
    await expect(g.getByRole('button', { name: /(라이트|다크) 모드로/ })).toHaveCount(0)
    // dark at once, a neutral grey (R, G, B within 4 of each other), kept after a reload
    await g.goto('/settings/general')
    await g.getByRole('radiogroup', { name: '선호 테마' }).getByRole('radio', { name: '다크' }).click()
    await expect.poll(bg).toBe('rgb(15, 16, 17)')
    const [r, gg, b] = (await bg()).match(/\d+/g)!.map(Number)
    expect(Math.max(r!, gg!, b!) - Math.min(r!, gg!, b!)).toBeLessThanOrEqual(4)
    await g.reload()
    await expect.poll(bg).toBe('rgb(15, 16, 17)')
    // 선호 테마 in settings applies without a save button
    await g.goto('/settings/general')
    await g.getByRole('radiogroup', { name: '선호 테마' }).getByRole('radio', { name: '라이트' }).click()
    await expect.poll(bg).toBe('rgb(245, 246, 245)')
    await g.reload()
    await expect.poll(bg).toBe('rgb(245, 246, 245)')
    // 시스템: follows the OS, also when the OS changes while the page is open (review 11)
    await g.goto('/settings/general')
    await g.getByRole('radiogroup', { name: '선호 테마' }).getByRole('radio', { name: '시스템' }).click()
    await expect.poll(bg).toBe('rgb(15, 16, 17)') // this context's OS is dark
    await g.emulateMedia({ colorScheme: 'light' })
    await expect.poll(bg).toBe('rgb(245, 246, 245)')
    await g.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(bg).toBe('rgb(15, 16, 17)')
    await g.reload()
    await expect.poll(bg).toBe('rgb(15, 16, 17)')
    expect((await (await g.request.get('/api/state')).json()).preferences.themeMode).toBe('system')
  } finally {
    await ctx.close()
    const u = (await api(request, 'GET', '/api/auth/admin/list-users?limit=500')).json.users.find((x: { email: string }) => x.email === email)
    if (u) await api(request, 'DELETE', `/api/admin/users/${u.id}`, { confirmEmail: email })
  }
})

test('(V-14 c; spec 013 S-17, S-19, S-20) every page has the header bar; 마지막 동기화 is still 준비 중; 내보내기, search, the bell and CSV 내보내기 work now', async ({ page }) => {
  for (const r of ROUTES) {
    await page.goto(`/${r}`)
    await expect(page.locator('header.topbar'), `/${r}`).toBeVisible()
  }
  const notice = page.getByRole('status').filter({ hasText: '준비 중' })
  await page.goto('/')
  // 내보내기 was 준비 중 (spec 010 S-3) until rc.1; since spec 013 S-17 it saves the month as CSV (tests/e2e/rc2.spec.ts)
  await expect(page.getByRole('button', { name: '내보내기 (준비 중)' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '내보내기', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
  await page.getByRole('button', { name: '기록 추가', exact: true }).click()
  await expect(page.getByRole('form', { name: '기록 추가' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '마지막 동기화 —' }).click()
  await expect(notice).toContainText('마지막 동기화')
  // the header's search box and bell were `Soon` until rc.1; since spec 013 S-19, S-20 they open the search and the list
  await page.reload()
  await page.locator('header.ph h1').waitFor()
  const head = page.locator('header.topbar')
  for (const name of ['검색 (준비 중)', '알림 (준비 중)']) await expect(head.getByRole('button', { name })).toHaveCount(0)
  await head.getByRole('button', { name: '검색 열기 (Ctrl+K)' }).click()
  await expect(page.getByRole('combobox', { name: '검색어' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('combobox', { name: '검색어' })).toBeHidden()
  await head.getByRole('button', { name: /^알림 · 읽지 않음 \d+건$/ }).click()
  await expect(page.getByRole('dialog', { name: '알림' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '알림' })).toBeHidden()
  await page.goto('/spend/subs')
  // CSV 내보내기 was 준비 중 (spec 010 S-3, S-7) until rc.1; since spec 013 S-17 it downloads the list
  await expect(page.getByRole('button', { name: 'CSV 내보내기 (준비 중)' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'CSV 내보내기', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
})

// spec 010 V-8, V-9: the shell. Menu entries for features that do not exist yet are inert and have no route.
test.describe('(V-8, V-9) shell', () => {
  const SOON = ['명세서 분석', 'AI 어시스턴트'] // 생활, 저축, 투자 open in spec 013 S-1
  test.use({ viewport: { width: 1440, height: 900 } })

  test('(a) sidebar groups; the unfinished entries are visible, disabled, and do nothing; no 개발 entry; #dev still opens', async ({ page }) => {
    const calls: string[] = []
    await page.goto('/')
    const side = page.locator('aside.side')
    await expect(side.locator('.glabel')).toHaveText(['개요', '예산', '관리', 'AI'])
    await expect(side.getByRole('link')).toContainText(['현황', '월급 분배', '생활', '지출', '저축', '투자', '일정', '대기 중인 변경', '변경 내역', '설정'])
    await expect(side.getByRole('link', { name: '개발' })).toHaveCount(0)
    page.on('request', (req) => { if (req.url().includes('/api/')) calls.push(req.url()) })
    const before = page.url()
    for (const name of SOON) {
      const item = side.getByRole('button', { name: new RegExp(name) })
      await expect(item, name).toHaveAttribute('aria-disabled', 'true')
      await expect(item.locator('.soon-pill'), name).toHaveText('준비 중')
      await item.click({ force: true })
      await item.focus()
      await page.keyboard.press('Enter')
      await page.keyboard.press(' ')
    }
    expect(page.url(), 'no navigation').toBe(before)
    expect(calls, 'no request').toEqual([])
    await page.goto('/dev')
    await expect(page.locator('header.ph h1')).toBeVisible()
    await expect(page.locator('header.topbar')).toContainText('시스템')
  })

  test('(b) the header has no theme button; the content column is in the middle at 1600', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 })
    await page.goto('/')
    await page.locator('.hero').waitFor()
    await expect(page.locator('header.topbar').getByRole('button', { name: /모드/ })).toHaveCount(0)
    const m = await page.evaluate(() => {
      const r = (e: Element) => e.getBoundingClientRect()
      const col = r(document.querySelector('.col')!), main = r(document.querySelector('main.main')!)
      return { left: main.left - col.left, right: col.right - main.right }
    })
    expect(Math.abs(m.left - m.right), `left ${m.left} / right ${m.right}`).toBeLessThanOrEqual(2)
    // the settings and account group sits at the bottom of a tall sidebar, not right under the AI group (A-33)
    for (const h of [900, 1300]) {
      await page.setViewportSize({ width: 1600, height: h })
      const gap = await page.evaluate(() => {
        const s = document.querySelector('aside.side')!.getBoundingClientRect()
        const l = document.querySelector('aside.side .lower')!.getBoundingClientRect()
        return Math.round(s.bottom - l.bottom)
      })
      expect(gap, `space under the account row at height ${h}`).toBeLessThanOrEqual(24)
    }
  })

  test('(d) on a phone with no proposal waiting, 대기 중인 변경 is still reachable from the "더보기" sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.route('**/api/state', async (route) => {
      const res = await route.fetch()
      await route.fulfill({ response: res, json: { ...(await res.json()), pendingProposals: 0 } })
    })
    await page.goto('/')
    await page.locator('header.ph h1').waitFor()
    const bar = page.getByRole('navigation', { name: '메뉴' }).last()
    await expect(bar.getByRole('link', { name: /AI 제안/ })).toHaveCount(0)
    await bar.getByRole('button', { name: '더보기' }).click()
    await page.getByRole('dialog', { name: '더보기' }).getByRole('link', { name: /대기 중인 변경/ }).click()
    await expect(page.locator('header.ph h1')).toHaveText('대기 중인 변경')
  })

  test('(c) on a phone: top bar, a bar of the entries that exist, and the "더보기" sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.locator('header.ph h1').waitFor()
    await expect(page.locator('header.topbar')).toBeHidden()
    await expect(page.locator('.mbar')).toBeVisible()
    // the phone bar's search button opens the search since spec 013 S-19 (it was inert until rc.1)
    await expect(page.locator('.mbar').getByRole('button', { name: '검색', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
    await expect(page.locator('.mbar').getByRole('button', { name: '검색', exact: true })).toHaveAttribute('aria-haspopup', 'dialog')
    const bar = page.getByRole('navigation', { name: '메뉴' }).last()
    await expect(bar.getByRole('link')).toContainText(['현황', '예산', '일정'])
    const more = bar.getByRole('button', { name: '더보기' })
    await more.click()
    const sheet = page.getByRole('dialog', { name: '더보기' })
    await expect(sheet).toBeVisible()
    for (const name of ['명세서 분석', 'AI 어시스턴트']) await expect(sheet.getByRole('button', { name: new RegExp(name) })).toHaveAttribute('aria-disabled', 'true')
    for (const name of ['생활', '지출', '저축', '투자', '변경 내역', '설정']) await expect(sheet.getByRole('link', { name })).toBeVisible()
    await expect(sheet.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
    await more.click()
    await page.mouse.click(195, 40) // outside the sheet
    await expect(sheet).toBeHidden()
    await more.click()
    await sheet.getByRole('link', { name: '설정' }).click()
    await expect(page.locator('header.ph h1')).toHaveText('설정')
    await expect(more).toHaveClass(/on/)
  })
})

test('(S-17) Saturdays blue and Sundays red: calendar headers and date numbers (also of the months around, faded), phone agenda, payment dates, light and dark', async ({ page, request }) => {
  // A weekend payment on a Saturday and the Sunday after it, both in one month and inside the next 31 days.
  const sat = new Date(); sat.setHours(12)
  do sat.setDate(sat.getDate() + 1); while (sat.getDay() !== 6 || new Date(sat.getTime() + 864e5).getMonth() !== sat.getMonth())
  const sun = new Date(sat.getTime() + 864e5)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const nextMonth = sat.getMonth() !== new Date().getMonth()
  const made = await Promise.all([sat, sun].map((d) => api(request, 'POST', '/api/subscriptions', {
    name: `${MARK}-dow${d.getDay()}`, category: 'tool', plan: 'p', amount: 1000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: iso(d), path: 'direct', verified: false,
  })))
  // Every weekend date number and header in the calendar, and the weekend payment boxes: [kind, colour, out of month, opacity].
  const read = (root: string) => page.evaluate((sel) => {
    const out: [string, string, boolean, number][] = []
    for (const kind of ['sat', 'sun']) {
      for (const cell of document.querySelectorAll(`${sel} .is-${kind}`)) {
        const num = cell.querySelector('.cal-num')
        const target = cell.getAttribute('role') === 'columnheader' ? cell : num
        if (target) out.push([kind, getComputedStyle(target).color, !!num && num.classList.contains('cal-other'), Number(getComputedStyle(target).opacity)])
      }
      for (const box of document.querySelectorAll(`.dbox b.${kind}`)) out.push([kind, getComputedStyle(box).color, false, 1])
    }
    return out
  }, root)
  const want = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
  const vars = () => page.evaluate(() => { const c = getComputedStyle(document.documentElement); return { sat: c.getPropertyValue('--sat').trim(), sun: c.getPropertyValue('--sun').trim(), boxSat: c.getPropertyValue('--sat').trim(), boxSun: c.getPropertyValue('--sun').trim() } })
  try {
    for (const theme of ['light', 'dark']) {
      await page.goto('/events')
      await page.getByRole('region', { name: '이번 달 일정 달력' }).waitFor()
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      const v = await vars()
      const cal = await read('.cal')
      expect(cal.filter(([, , other]) => other).length, `${theme}: weekend dates of the next month are checked`).toBeGreaterThan(0)
      expect(cal.length, `${theme}: weekend headers and dates found`).toBeGreaterThanOrEqual(10)
      // (D-2) the weekend colour stays on a neighbouring month's Saturday and Sunday, a little faded; in the month it is full
      for (const [kind, colour, other, opacity] of cal) {
        expect(colour, `${theme} calendar ${kind}`).toBe(want(kind === 'sat' ? v.sat : v.sun))
        if (other) { expect(opacity, `${theme} ${kind} out of month is faded`).toBeLessThan(1); expect(opacity).toBeGreaterThan(0.4) } else expect(opacity).toBe(1)
      }
      await page.goto('/')
      await page.getByRole('heading', { level: 2, name: '결제 예정' }).waitFor()
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      const boxes = (await read('.none')).filter(([, , other]) => !other)
      expect(new Set(boxes.map(([k]) => k)), `${theme}: a Saturday and a Sunday payment box`).toEqual(new Set(['sat', 'sun']))
      for (const [kind, colour] of boxes) expect(colour, `${theme} payment box ${kind} (the --sat / --sun tokens, as the canvas draws them)`).toBe(want(kind === 'sat' ? v.boxSat : v.boxSun))
    }
    // Phone: no grid, the month's agenda; each weekend day takes the colour (D-3: month buttons, see the next test).
    await page.setViewportSize({ width: 390, height: 844 })
    for (const theme of ['light', 'dark']) {
      await page.goto('/events')
        const bar = page.getByRole('group', { name: '달 선택' })
      await bar.waitFor()
      if (nextMonth) await bar.getByRole('button', { name: '다음 달' }).click()
      await expect(page.locator('.agenda .dt.sun').first()).toBeVisible()
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      const v = await vars()
      const heads = await page.evaluate(() => [...document.querySelectorAll('.agenda .dt.sat, .agenda .dt.sun')].map((e) => [e.classList.contains('sat') ? 'sat' : 'sun', getComputedStyle(e).color] as [string, string]))
      expect(new Set(heads.map(([k]) => k)), `${theme}: Saturday and Sunday agenda dates`).toEqual(new Set(['sat', 'sun']))
      for (const [kind, colour] of heads) expect(colour, `${theme} agenda ${kind}`).toBe(want(kind === 'sat' ? v.sat : v.sun))
    }
  } finally {
    for (const m of made) await api(request, 'DELETE', `/api/subscriptions/${m.json.id}`)
  }
})

test('(V-16) 이번 달 shows the split, the trend and the payments; 예약된 플랜 전환, 다가오는 일정 and 확인할 것 are on their own tabs (spec 010 D-1)', async ({ page }) => {
  await page.goto('/')
  const h2 = (name: string | RegExp) => page.getByRole('heading', { level: 2, name, exact: typeof name === 'string' })
  for (const n of [/자동이체 분배$/, '고정 지출 추이', '결제 예정']) await expect(h2(n)).toBeVisible()
  for (const n of ['예약된 플랜 전환', '다가오는 일정', '확인할 것']) await expect(h2(n)).toHaveCount(0)
  await page.getByRole('tab', { name: /예정/ }).click()
  await expect(h2('예약된 플랜 전환')).toBeVisible()
  await expect(h2('다가오는 일정')).toBeVisible()
  for (const n of ['결제 예정', '확인할 것']) await expect(h2(n)).toHaveCount(0)
  await page.getByRole('tab', { name: /확인할 것/ }).click()
  await expect(h2('확인할 것')).toBeVisible()
  for (const n of ['결제 예정', '예약된 플랜 전환']) await expect(h2(n)).toHaveCount(0)
  await page.getByRole('tab', { name: /AI 제안/ }).click()
  await expect(page.getByText('AI가 올린 변경 제안이에요')).toBeVisible()
  for (const n of ['결제 예정', '예약된 플랜 전환', '확인할 것']) await expect(h2(n)).toHaveCount(0)
})

test.describe('(V-17) sidebar and content on a wide screen', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  const sideW = (page: Page) => page.locator('aside.side').evaluate((e) => Math.round(e.getBoundingClientRect().width))

  test('(a) the edge resizes the sidebar by drag and keys, within 200–360, kept after a reload; double-click resets', async ({ page }) => {
    await page.goto('/')
    const grip = page.getByRole('separator', { name: '사이드바 너비' })
    await expect(grip).toHaveAttribute('aria-valuenow', '272')
    expect(await sideW(page)).toBe(272)
    await grip.focus()
    await page.keyboard.press('End')
    expect(await sideW(page)).toBe(360)
    await page.keyboard.press('ArrowLeft')
    expect(await sideW(page)).toBe(344)
    await expect(grip).toHaveAttribute('aria-valuenow', '344')
    const box = (await grip.boundingBox())!
    await page.mouse.move(box.x + 3, 400)
    await page.mouse.down()
    await page.mouse.move(40, 400, { steps: 6 })
    await page.mouse.up()
    expect(await sideW(page), 'never under 200').toBe(200)
    const box2 = (await grip.boundingBox())!
    await page.mouse.move(box2.x + 3, 400)
    await page.mouse.down()
    await page.mouse.move(300, 400, { steps: 6 })
    await page.mouse.up()
    const dragged = await sideW(page)
    expect(dragged).toBeGreaterThan(280)
    expect(dragged).toBeLessThanOrEqual(305)
    await page.reload()
    await page.locator('aside.side').waitFor()
    expect(await sideW(page), 'kept after a reload').toBe(dragged)
    await page.getByRole('separator', { name: '사이드바 너비' }).dblclick()
    expect(await sideW(page)).toBe(272)
  })

  test('(b) folding leaves icons only; links keep their names and work; kept after a reload; unfolding brings the width back', async ({ page }) => {
    await page.goto('/')
    const grip = page.getByRole('separator', { name: '사이드바 너비' })
    await grip.focus()
    await page.keyboard.press('ArrowRight')
    const open = await sideW(page)
    expect(open).toBe(288)
    // folding in the middle of a drag ends the drag (review 22): no resize cursor left on the page
    const gb = (await grip.boundingBox())!
    await page.mouse.move(gb.x + 3, 400)
    await page.mouse.down()
    await page.mouse.move(gb.x + 10, 400)
    await expect(page.locator('body')).toHaveClass(/resizing/)
    await page.getByRole('button', { name: '사이드바 접기' }).focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('body')).not.toHaveClass(/resizing/)
    await page.mouse.up()
    expect(await sideW(page)).toBe(64)
    const kept = await page.evaluate(() => Number(localStorage.getItem('allot.side.width')))
    expect(kept, 'the width at the moment of folding is kept').toBeGreaterThan(open)
    await expect(page.getByRole('button', { name: '사이드바 펼치기' })).toHaveAttribute('aria-expanded', 'false')
    const subs = page.locator('aside.side').getByRole('link', { name: '지출' })
    await expect(subs.locator('.lbl')).toHaveCSS('clip-path', 'inset(50%)')
    await expect(page.locator('aside.side .glabel').first()).toBeHidden()
    await subs.click()
    await expect(page.locator('header.ph h1')).toHaveText('지출')
    await page.reload()
    await page.locator('aside.side').waitFor()
    expect(await sideW(page), 'still folded after a reload').toBe(64)
    await page.getByRole('button', { name: '사이드바 펼치기' }).click()
    expect(await sideW(page), 'the width it had').toBe(kept)
    await expect(subs).toContainText('지출')
  })

  test('(d) a visible handle on the sidebar edge; dragging it changes nothing else on the page, light and dark', async ({ page }) => {
    await page.goto('/spend/subs')
    await page.locator('header.ph h1').waitFor()
    // the handle shows: a knob on the border line, at least 24px tall (the user, after rc.2)
    const knob = page.getByRole('separator', { name: '사이드바 너비' }).locator('.knob')
    await expect(knob).toBeVisible()
    const kb = (await knob.boundingBox())!, edge = await page.locator('aside.side').evaluate((e) => e.getBoundingClientRect().right)
    expect(kb.height).toBeGreaterThanOrEqual(24)
    expect(kb.x < edge && kb.x + kb.width > edge, `knob ${kb.x}–${kb.x + kb.width} straddles the edge ${edge}`).toBe(true)
    const look = () => page.evaluate(() => {
      const c = (e: Element) => { const s = getComputedStyle(e); return `${s.backgroundColor}/${s.color}` }
      return [c(document.body), c(document.querySelector('main.main')!), c(document.querySelector('header.ph h1')!), c(document.querySelector('header.topbar')!)].join(' | ')
    })
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      const before = await look()
      const box = (await page.getByRole('separator', { name: '사이드바 너비' }).boundingBox())!
      await page.mouse.move(box.x + box.width / 2, 500)
      await page.mouse.down()
      await page.mouse.move(box.x + 40, 500, { steps: 4 })
      await expect(page.locator('body')).toHaveClass(/resizing/)
      expect(await look(), `${theme}: colours while dragging`).toBe(before)
      await page.mouse.up()
      expect(await look(), `${theme}: colours after the drag`).toBe(before)
    }
  })

  test('(d) no handle when folded or on a phone', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '사이드바 접기' }).click()
    await expect(page.getByRole('separator', { name: '사이드바 너비' })).toHaveCount(0)
    await page.getByRole('button', { name: '사이드바 펼치기' }).click()
    await expect(page.getByRole('separator', { name: '사이드바 너비' })).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('separator', { name: '사이드바 너비' })).toBeHidden()
  })

  test('(c) the content column sits in the middle at 1920; the header lines up with it; the header holds at 761–1000 with either sidebar width', async ({ page }) => {
    for (const width of [1920, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/')
      await page.locator('.hero').waitFor()
      const m = await page.evaluate(() => {
        const r = (e: Element) => e.getBoundingClientRect()
        const col = r(document.querySelector('.col')!), strip = r(document.querySelector('.hero')!)
        const nav = r(document.querySelector('header.topbar .monthnav')!), last = r([...document.querySelectorAll('header.topbar .tb')].at(-1)!)
        return { left: strip.left - col.left, right: col.right - strip.right, headL: nav.left - strip.left, headR: last.right - strip.right }
      })
      expect(Math.abs(m.left - m.right), `${width}: left ${m.left} / right ${m.right}`).toBeLessThanOrEqual(2)
      expect(Math.abs(m.headL), `${width}: header starts with the content`).toBeLessThanOrEqual(1)
      expect(Math.abs(m.headR), `${width}: header ends with the content`).toBeLessThanOrEqual(1)
      if (width === 1920) expect(m.left, 'there is room on both sides at 1920').toBeGreaterThan(100)
    }
    // The header at narrow desktop widths, with the default and the widest sidebar: one line, nothing overflows or overlaps (review 22).
    for (const sidebar of ['default', 'End'] as const) {
      for (const width of [761, 800, 1000]) {
        await page.setViewportSize({ width, height: 800 })
        await page.goto('/')
        await page.locator('header.topbar').waitFor()
        if (sidebar === 'End') { await page.getByRole('separator', { name: '사이드바 너비' }).focus(); await page.keyboard.press('End') }
        const h = await page.locator('header.topbar').evaluate((bar) => {
          const box = bar.getBoundingClientRect(), cs = getComputedStyle(bar)
          const inner = { left: box.left + parseFloat(cs.paddingLeft) - 0.5, right: box.right - parseFloat(cs.paddingRight) + 0.5 }
          const kids = [...bar.children].filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0).map((e) => e.getBoundingClientRect())
          const search = bar.querySelector('.search') as HTMLElement
          return {
            overflow: bar.scrollWidth - bar.clientWidth,
            rows: Math.max(...kids.map((r) => r.top + r.height / 2)) - Math.min(...kids.map((r) => r.top + r.height / 2)),
            outside: kids.filter((r) => r.left < inner.left || r.right > inner.right).length,
            overlaps: kids.slice(1).filter((r, i) => r.left < kids[i]!.right - 0.5).length,
            searchOverflow: search.scrollWidth - search.clientWidth,
          }
        })
        const at = `${width}px, sidebar ${sidebar === 'End' ? 360 : 272}`
        expect(h.overflow, `${at}: header scrolls sideways`).toBeLessThanOrEqual(0)
        expect(h.rows, `${at}: one line`).toBeLessThanOrEqual(4)
        expect(h.outside, `${at}: items inside the header`).toBe(0)
        expect(h.overlaps, `${at}: items do not overlap`).toBe(0)
        expect(h.searchOverflow, `${at}: the search box holds its contents`).toBeLessThanOrEqual(0)
      }
    }
  })
})

test('(spec 010 D-3) phone: month buttons move the agenda, there is no 오늘 button, the grid is not drawn', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/events')
  const bar = page.getByRole('group', { name: '달 선택' })
  await bar.waitFor()
  await expect(page.getByRole('region', { name: '이번 달 일정 달력' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '오늘', exact: true })).toHaveCount(0)
  const title = bar.locator('b')
  const t0 = await title.innerText()
  await bar.getByRole('button', { name: '다음 달' }).click()
  const t1 = await title.innerText()
  expect(t1).not.toBe(t0)
  await expect(page.locator('.agenda h2')).toContainText(`${Number(t1.match(/(\d+)월/)![1])}월 일정`)
  await bar.getByRole('button', { name: '이전 달' }).click()
  await expect(title).toHaveText(t0)
  await expect(bar).toContainText(/오늘 \d+\/\d+\(.\)/)
})

test.describe('(spec 010 EV-5..8) desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test('the month strip moves the grid and the agenda together; 오늘 is disabled on this month', async ({ page }) => {
    await page.goto('/events')
    const cal = page.getByRole('region', { name: '이번 달 일정 달력' })
    await cal.waitFor()
    const title = page.locator('[data-cal-title]')
    const t0 = await title.innerText()
    await expect(page.getByRole('button', { name: '오늘', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: '다음 달' }).click()
    const t1 = await title.innerText()
    expect(t1).not.toBe(t0)
    await expect(page.getByRole('button', { name: '오늘', exact: true })).toBeEnabled()
    await expect(page.locator('.agenda h2')).toContainText(`${Number(t1.match(/(\d+)월/)![1])}월 일정`)
    expect(await cal.locator('[data-date]').count()).toBeGreaterThanOrEqual(28)
    await page.getByRole('button', { name: '오늘', exact: true }).click()
    await expect(title).toHaveText(t0)
  })
})

test('(V-8, W-8) 설정 and 관리: what does not exist yet is a visible, inert 준비 중 entry that makes no request', async ({ page }) => {
  const notice = page.getByRole('status').filter({ hasText: '준비 중' })
  // 0.1.7-rc.3 (spec 013 S-22..S-24) made the time zone, the base currency note, 외화 추가, 일정 추가, the password policy
  // and the generator real: they are no longer 준비 중 entries (checked below); the AI tab's two stay.
  for (const [route, names] of [['settings/general', ['Asia/Seoul', 'KRW', '외화 추가', '일정 추가']], ['settings/security', ['비밀번호 정책', '자동 생성', '만들기']]] as const) {
    await page.goto(`/${route}`)
    await page.locator('header.ph h1').waitFor()
    await page.waitForLoadState('networkidle')
    for (const n of names) await expect(page.locator('[aria-disabled="true"]').filter({ hasText: n }), `${route} ${n} is not 준비 중`).toHaveCount(0)
  }
  // …and the real controls are there (review rc3-5 R5-6)
  await page.goto('/settings/general')
  await expect(page.getByLabel('시간대')).toBeVisible()
  await expect(page.getByRole('button', { name: /외화 추가/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /일정 추가/ })).toBeVisible()
  await expect(page.getByText('원화 고정', { exact: false }).first()).toBeVisible()
  const cases: [string, string[]][] = [
    ['settings/ai', ['+ 모델 연결', '연결된 앱 관리']],
  ]
  for (const [route, names] of cases) {
    await page.goto(`/${route}`)
    await page.locator('header.ph h1').waitFor()
    // the entries are there once the page's own loading (keys, proposal count, sign-in methods) is done
    await page.locator('[aria-disabled="true"]').filter({ hasText: names[0]!.startsWith('+') ? names[0]!.slice(2) : names[0]! }).first().waitFor()
    await page.waitForLoadState('networkidle')
    if (route === 'settings/ai') await page.getByText('쓰기 제안', { exact: false }).first().waitFor({ timeout: 60_000 }) // the proposal count has finished paging
    const calls: string[] = []
    const on = (r: { url(): string }) => { if (r.url().includes('/api/')) calls.push(r.url()) }
    page.on('request', on)
    const url = page.url()
    for (const n of names) {
      const el = page.locator('[aria-disabled="true"]').filter({ hasText: n.startsWith('+') ? n.slice(2) : n }).first()
      await expect(el, `${route} ${n}`).toBeVisible()
      await expect(el).toContainText('준비 중')
      await el.click({ force: true })
      await el.focus()
      await page.keyboard.press('Enter')
    }
    page.off('request', on)
    expect(page.url(), `${route} no navigation`).toBe(url)
    expect(calls, `${route} no request`).toEqual([])
    await expect(notice).toHaveCount(0)
  }
})

test.describe('(W-8) phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('설정 opens with the account card and its sign-out; the key list is whole-row buttons', async ({ page }) => {
    await page.goto('/settings/general')
    const card = page.getByRole('region', { name: '내 계정' })
    await expect(card).toBeVisible()
    await expect(card.getByRole('button', { name: '로그아웃' })).toBeVisible()
    await expect(card).toContainText('·')
    const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
    expect(sw).toBeLessThanOrEqual(iw)
  })
})

test('(W-8) desktop has no account card on the settings page', async ({ page }) => {
  await page.goto('/settings/general')
  await page.locator('header.ph h1').waitFor()
  await expect(page.getByRole('region', { name: '내 계정' })).toHaveCount(0)
})

test('(A-25) a page whose code cannot be downloaded says so and offers a reload', async ({ page }) => {
  await page.route(/\/(pages\/Subscriptions\.vue|assets\/Subscriptions-[^/]*\.js)/, (r) => r.abort())
  await page.goto('/')
  await page.locator('header.ph h1').waitFor()
  await page.goto('/spend/subs')
  const alert = page.getByRole('alert').filter({ hasText: '이 화면을 불러오지 못했어요' })
  await expect(alert).toBeVisible()
  await expect(alert.getByRole('button', { name: '새로고침' })).toBeVisible()
  await page.unroute(/\/(pages\/Subscriptions\.vue|assets\/Subscriptions-[^/]*\.js)/)
})
