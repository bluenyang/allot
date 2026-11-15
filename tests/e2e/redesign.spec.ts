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
    await page.getByRole('button', { name: '파랑', exact: true }).click()
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
  // AI features stay hidden (the user's choice); controls drawn as in the design are tested in V-14 (c).
  const banned = ['명세서 분석', 'AI 어시스턴트', 'AI·연동', 'AI 분석', '명세서에서 채우기']
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
  test('(V-15) trend labels do not overlap; each subscription keeps its name and monthly amount on one line', async ({ page, request }) => {
    const sub = await api(request, 'POST', '/api/subscriptions', {
      name: `${MARK}-a-rather-long-service-name`, category: 'tool', plan: 'p', amount: 1234500, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false,
    })
    try {
      await page.goto('/#home')
      const labels = page.locator('.bars .bv-short')
      await expect(labels.first()).toBeVisible()
      await expect(page.locator('.bars .bv-full').first()).toBeHidden()
      const boxes = (await labels.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.right])))
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]![0], `label ${i} starts after label ${i - 1} ends`).toBeGreaterThanOrEqual(boxes[i - 1]![1])
      await page.goto('/#subs')
      const row = page.getByRole('row', { name: new RegExp(MARK) })
      const [name, monthly] = await Promise.all([row.locator('td').nth(0).boundingBox(), row.locator('td').nth(4).boundingBox()])
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
  await page.goto('/#home')
  const note = page.getByRole('status').filter({ hasText: '요청이 많아요' })
  await expect(note).toBeVisible()
  // the note holds, with no login form, through the whole wait (sampled every second)
  for (let i = 0; i < 5; i++) {
    await expect(page.getByLabel('비밀번호')).toHaveCount(0)
    await page.waitForTimeout(1000)
  }
  await expect(page.locator('header.ph h1')).toContainText('현황', { timeout: 30_000 })
  expect(times.length).toBeGreaterThanOrEqual(3)
  expect(times[1]! - times[0]!, 'the second check waits the 6 s the server gave').toBeGreaterThanOrEqual(5900)
  expect(times[2]! - times[1]!, 'and again').toBeGreaterThanOrEqual(5900)
})

test('(V-14 a, b) a new account starts light even on a dark OS; the header switch and 선호 테마 apply at once and stay', async ({ request, browser }) => {
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
    // the header switch: dark at once, a neutral grey (R, G, B within 4 of each other), kept after a reload
    await g.getByRole('button', { name: '다크 모드로 바꾸기' }).click()
    await expect.poll(bg).toBe('rgb(17, 19, 21)')
    const [r, gg, b] = (await bg()).match(/\d+/g)!.map(Number)
    expect(Math.max(r!, gg!, b!) - Math.min(r!, gg!, b!)).toBeLessThanOrEqual(4)
    await g.reload()
    await expect.poll(bg).toBe('rgb(17, 19, 21)')
    // 선호 테마 in settings applies without a save button
    await g.goto('/#settings/general')
    await g.getByRole('group', { name: '선호 테마' }).getByRole('button', { name: '라이트' }).click()
    await expect.poll(bg).toBe('rgb(245, 246, 245)')
    await g.reload()
    await expect.poll(bg).toBe('rgb(245, 246, 245)')
    // 시스템: follows the OS, also when the OS changes while the page is open (review 11)
    await g.goto('/#settings/general')
    await g.getByRole('group', { name: '선호 테마' }).getByRole('button', { name: '시스템' }).click()
    await expect.poll(bg).toBe('rgb(17, 19, 21)') // this context's OS is dark
    await g.emulateMedia({ colorScheme: 'light' })
    await expect.poll(bg).toBe('rgb(245, 246, 245)')
    await expect(g.getByRole('button', { name: '다크 모드로 바꾸기' })).toBeVisible()
    await g.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(bg).toBe('rgb(17, 19, 21)')
    await expect(g.getByRole('button', { name: '라이트 모드로 바꾸기' })).toBeVisible()
    await g.reload()
    await expect.poll(bg).toBe('rgb(17, 19, 21)')
    expect((await (await g.request.get('/api/state')).json()).preferences.themeMode).toBe('system')
  } finally {
    await ctx.close()
    const u = (await api(request, 'GET', '/api/auth/admin/list-users?limit=500')).json.users.find((x: { email: string }) => x.email === email)
    if (u) await api(request, 'DELETE', `/api/admin/users/${u.id}`, { confirmEmail: email })
  }
})

test('(V-14 c) every page has the header bar; controls drawn from the design say they are not ready', async ({ page }) => {
  for (const r of ROUTES) {
    await page.goto(`/#${r}`)
    await expect(page.locator('header.topbar'), `#${r}`).toBeVisible()
  }
  const notice = page.getByRole('status').filter({ hasText: '준비 중' })
  await page.goto('/#home')
  for (const [name, what] of [['알림', '알림'], ['내보내기', '내보내기'], ['기록 추가', '기록 추가']] as const) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(notice).toContainText(what)
  }
  await page.getByRole('button', { name: '마지막 동기화 —' }).click()
  await expect(notice).toContainText('마지막 동기화')
  await page.getByRole('searchbox', { name: '검색' }).click()
  await expect(notice).toContainText('검색')
  await page.goto('/#subs')
  await page.getByRole('button', { name: 'CSV 내보내기' }).click()
  await expect(notice).toContainText('CSV 내보내기')
})

test('(S-17) Saturdays blue and Sundays red: calendar headers and date numbers (also of the months around), payment dates, light and dark', async ({ page, request }) => {
  // A weekend payment inside the next 31 days for each of Saturday and Sunday.
  const ahead = (dow: number) => { const d = new Date(); d.setHours(12); do d.setDate(d.getDate() + 1); while (d.getDay() !== dow); return d }
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const made = await Promise.all([6, 0].map((dow) => api(request, 'POST', '/api/subscriptions', {
    name: `${MARK}-dow${dow}`, category: 'tool', plan: 'p', amount: 1000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: iso(ahead(dow)), path: 'direct', verified: false,
  })))
  // Every weekend date number and header in the calendar, and the weekend payment boxes: [kind, colour, out of month].
  const read = (root: string) => page.evaluate((sel) => {
    const out: [string, string, boolean][] = []
    for (const kind of ['sat', 'sun']) {
      for (const cell of document.querySelectorAll(`${sel} .is-${kind}`)) {
        const num = [...cell.querySelectorAll('*')].find((e) => /^\d+일$/.test(e.textContent!.trim()) && !e.children.length)
        const target = cell.getAttribute('role') === 'columnheader' ? cell : num
        if (target) out.push([kind, getComputedStyle(target).color, !!num && num.className.includes('taq')])
      }
      for (const box of document.querySelectorAll(`.dbox.${kind} b`)) out.push([kind, getComputedStyle(box).color, false])
    }
    return out
  }, root)
  const want = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`
  const vars = () => page.evaluate(() => { const c = getComputedStyle(document.documentElement); return { sat: c.getPropertyValue('--info-text').trim(), sun: c.getPropertyValue('--neg-text').trim() } })
  try {
    for (const theme of ['light', 'dark']) {
      await page.goto('/#events')
      await page.getByRole('region', { name: '이번 달 일정 달력' }).waitFor()
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      const v = await vars()
      const cal = await read('.cal')
      expect(cal.filter(([, , other]) => other).length, `${theme}: weekend dates of the next month are checked`).toBeGreaterThan(0)
      expect(cal.length, `${theme}: weekend headers and dates found`).toBeGreaterThanOrEqual(10)
      for (const [kind, colour] of cal) expect(colour, `${theme} calendar ${kind}`).toBe(want(kind === 'sat' ? v.sat : v.sun))
      await page.goto('/#home')
      await page.getByRole('heading', { level: 2, name: '결제 예정' }).waitFor()
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme)
      const boxes = (await read('.none')).filter(([, , other]) => !other)
      expect(new Set(boxes.map(([k]) => k)), `${theme}: a Saturday and a Sunday payment box`).toEqual(new Set(['sat', 'sun']))
      for (const [kind, colour] of boxes) expect(colour, `${theme} payment box ${kind}`).toBe(want(kind === 'sat' ? v.sat : v.sun))
    }
  } finally {
    for (const m of made) await api(request, 'DELETE', `/api/subscriptions/${m.json.id}`)
  }
})

test('(V-16) 이번 달 shows every card as the design does; 예정 and 확인할 것 show only theirs', async ({ page }) => {
  await page.goto('/#home')
  const h2 = (name: string | RegExp) => page.getByRole('heading', { level: 2, name, exact: typeof name === 'string' })
  const all = [/자동이체 분배$/, '고정 지출 추이', '결제 예정', '예약된 플랜 전환', '다가오는 일정', '확인할 것']
  for (const n of all) await expect(h2(n)).toBeVisible()
  await page.getByRole('tab', { name: /예정/ }).click()
  await expect(h2('예약된 플랜 전환')).toBeVisible()
  await expect(h2('다가오는 일정')).toBeVisible()
  for (const n of ['결제 예정', '확인할 것']) await expect(h2(n)).toHaveCount(0)
  await page.getByRole('tab', { name: /확인할 것/ }).click()
  await expect(h2('확인할 것')).toBeVisible()
  for (const n of ['결제 예정', '예약된 플랜 전환']) await expect(h2(n)).toHaveCount(0)
})
