// spec 010 A-10, A-12, A-14: what one account decided on the proposal screens, and what a request still on its
// way brings back, is not shown to the next account that signs in on the same tab. The first account's answer
// is fetched while it is signed in, held until the next account's screen has loaded, then delivered; nothing
// of it (its state, its toast) may show. Once for apply, once for undo. Runs late (alphabetical) with its own
// pacing: it signs in four times, and the login limit is 5 a minute (nothing after it signs in, zz-i18n-signout
// uses the shared session).
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { MARK, choose } from './helpers'
import { KEY_NAME, SUB, makeKey, propose } from './proposal-helpers'

test.afterEach(async ({ request }) => {
  const props = (await (await request.get('/api/proposals?status=pending')).json()) as { id: string; keyName: string }[]
  for (const p of props.filter((x) => x.keyName.startsWith(MARK))) expect((await request.post(`/api/proposals/${p.id}/reject`)).ok()).toBe(true)
  const keys = (await (await request.get('/api/keys')).json()) as { keys: { id: string; name: string }[] }
  for (const k of keys.keys.filter((x) => x.name.startsWith(MARK))) expect((await request.delete(`/api/keys/${k.id}`)).ok()).toBe(true)
  const st = (await (await request.get('/api/state')).json()) as { subscriptions: { id: string; name: string }[]; checks: { id: string; text: string }[] }
  for (const x of st.subscriptions.filter((x) => x.name.startsWith(MARK))) await request.delete(`/api/subscriptions/${x.id}`)
  for (const x of st.checks.filter((x) => x.text.startsWith(MARK))) await request.delete(`/api/checks/${x.id}`)
})

/** Hold the next /api/state answer: fetched now (while the page's account is signed in), delivered when `release()` is called. */
function holdState(ctx: BrowserContext) {
  let seen!: () => void
  let release!: () => void
  let finished!: () => void
  const captured: { status: number; body: string } = { status: 0, body: '' }
  const intercepted = new Promise<void>((r) => { seen = r })
  const gate = new Promise<void>((r) => { release = r })
  const done = new Promise<void>((r) => { finished = r })
  let armed = true
  void ctx.route('**/api/state', async (route) => {
    if (!armed) return route.continue()
    armed = false
    const res = await route.fetch()
    captured.status = res.status()
    captured.body = await res.text()
    seen()
    await gate
    await route.fulfill({ response: res })
    finished()
  })
  return { intercepted, captured, release: () => release(), done }
}

test('pending: nothing of the first account reaches the next one signed in on the same tab (A-10, A-14)', async ({ browser, request, baseURL }) => {
  test.setTimeout(420_000)
  // the specs before this one sign in too: start with an empty login window (5 a minute)
  await new Promise((r) => setTimeout(r, 60_000))
  const email = `e2e-prop-${Date.now().toString(36)}@example.com`
  const pass = 'e2e-prop-pass-1'
  const created = await request.fetch('/api/auth/admin/create-user', { method: 'POST', data: { email, name: 'E2E prop', password: pass }, headers: { origin: baseURL! } })
  expect(created.status()).toBe(200)
  // a sentinel only the first account has: the held answer must carry it, the next account must never show it
  const sentinel = `${MARK}-A-only`
  const made0 = await request.fetch('/api/subscriptions', { method: 'POST', headers: { origin: baseURL! }, data: { name: sentinel, category: 'tool', plan: 'p', amount: 1000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false } })
  expect(made0.status()).toBe(201)

  const login = async (page: Page, e: string, p: string, ready: () => Promise<void>) => {
    await page.getByLabel('이메일').fill(e)
    await page.getByLabel('비밀번호').fill(p)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await ready()
  }

  for (const round of ['apply', 'undo'] as const) {
    if (round === 'undo') await new Promise((r) => setTimeout(r, 60_000)) // an empty login window again
    const key = await makeKey(request, 'ui', `${KEY_NAME}-${round}`)
    const made = await propose(baseURL!, key)
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, locale: 'ko-KR' })
    try {
      const page = await ctx.newPage()
      await page.goto('/')
      await login(page, process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!, () => page.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 }))
      await page.goto('/#pending')
      const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
      let hold: ReturnType<typeof holdState>
      if (round === 'apply') {
        hold = holdState(ctx)
        await card.getByRole('button', { name: '확인하고 적용', exact: true }).click()
        await expect(card.locator('.pill', { hasText: '적용됨' })).toBeVisible()
      } else {
        await card.getByRole('button', { name: '확인하고 적용', exact: true }).click()
        await expect(card.getByRole('button', { name: '되돌리기' })).toBeVisible()
        await expect(page.getByRole('status').filter({ hasText: '제안을 적용했어요' })).toBeVisible()
        hold = holdState(ctx)
        await card.getByRole('button', { name: '되돌리기' }).click()
        await expect(card.locator('.pill', { hasText: '되돌림' })).toBeVisible()
      }
      await hold.intercepted // the first account's state answer is in hand and held back
      expect(hold.captured.status, 'the held answer is a real 200').toBe(200)
      expect(hold.captured.body, "the held answer is the first account's state").toContain(sentinel)
      // sign out and sign in as another account, with no page reload in between
      await page.getByRole('button', { name: '로그아웃' }).first().click()
      await page.getByLabel('이메일').waitFor()
      // still on the 대기 중인 변경 route: the next account sees that page, not the previous one's cards
      await login(page, email, pass, () => expect(page.getByRole('heading', { name: '대기 중인 변경', exact: true })).toBeVisible({ timeout: 15_000 }))
      await expect(page.getByText('확인할 제안이 없어요')).toBeVisible()
      await expect(page.locator('[data-proposal]')).toHaveCount(0)
      // only now is the held answer delivered
      hold.release()
      await hold.done
      await page.waitForTimeout(1000)
      const toast = page.getByRole('status').filter({ hasText: /제안을 (적용|되돌렸)/ })
      await expect(toast).toHaveCount(0)
      await page.goto('/#subs')
      await expect(page.getByRole('heading', { name: '지출', exact: true })).toBeVisible()
      await expect(page.getByText(SUB)).toHaveCount(0)
      await expect(page.getByText(sentinel)).toHaveCount(0)
      await page.goto('/#pending')
      await page.getByRole('button', { name: '처리함', exact: true }).click()
      await expect(page.locator('[data-proposal]')).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  }
  const users = (await (await request.fetch('/api/auth/admin/list-users?limit=500', { headers: { origin: baseURL! } })).json()).users as { id: string; email: string }[]
  const u = users.find((x) => x.email === email)
  if (u) await request.fetch(`/api/admin/users/${u.id}`, { method: 'DELETE', data: { confirmEmail: email }, headers: { origin: baseURL! } })
})

// spec 010 A-20: a save that has more than one step (the language is saved, then applied) belongs to the session it
// started in. The first account picks English; its answer is held until another account has signed in on the
// same tab; the held answer must not switch the next account's screen to English.
test('settings: a language pick of the first account does not reach the next account (A-20)', async ({ browser, request, baseURL }) => {
  test.setTimeout(240_000)
  await new Promise((r) => setTimeout(r, 60_000)) // an empty login window
  const email = `e2e-lang-${Date.now().toString(36)}@example.com`
  const pass = 'e2e-lang-pass-1'
  expect((await request.fetch('/api/auth/admin/create-user', { method: 'POST', data: { email, name: 'E2E lang', password: pass }, headers: { origin: baseURL! } })).status()).toBe(200)
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, locale: 'ko-KR' })
  try {
    const page = await ctx.newPage()
    await page.goto('/')
    await page.getByLabel('이메일').fill(process.env.ADMIN_EMAIL!)
    await page.getByLabel('비밀번호').fill(process.env.ADMIN_PASSWORD!)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await page.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })
    await page.goto('/#settings/general')
    await page.locator('#g-lang').waitFor()
    // hold the answer of the preferences save: it is sent (the server has it), not yet delivered
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let sent!: () => void
    const wasSent = new Promise<void>((r) => { sent = r })
    let armed = true
    await ctx.route('**/api/preferences', async (route) => {
      if (!armed || route.request().method() !== 'PUT') return route.continue()
      armed = false
      const res = await route.fetch()
      sent()
      await gate
      await route.fulfill({ response: res })
    })
    await choose(page.locator('#g-lang'), 'en')
    await wasSent
    await page.getByRole('button', { name: '로그아웃' }).first().click()
    await page.getByLabel('이메일').waitFor()
    await page.getByLabel('이메일').fill(email)
    await page.getByLabel('비밀번호').fill(pass)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible({ timeout: 15_000 })
    release()
    await page.waitForTimeout(1500)
    // the next account still follows its own choice (the browser: Korean)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
    await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
    await expect(page.locator('#g-lang')).toHaveAttribute('data-value', 'browser')
  } finally {
    await ctx.close()
    const st = (await (await request.get('/api/state')).json()) as { preferences: Record<string, unknown> }
    await request.put('/api/preferences', { data: { ...st.preferences, language: null }, headers: { origin: baseURL! } })
    const users = (await (await request.fetch('/api/auth/admin/list-users?limit=500', { headers: { origin: baseURL! } })).json()).users as { id: string; email: string }[]
    const u = users.find((x) => x.email === email)
    if (u) await request.fetch(`/api/admin/users/${u.id}`, { method: 'DELETE', data: { confirmEmail: email }, headers: { origin: baseURL! } })
  }
})

// spec 010 A-21: an admin save is several requests (name, role, status, password). The first admin starts it, the
// answer to its first request is held, another admin signs in on the tab; nothing more is sent under the new
// session and nothing of the first save is shown.
test('admin: a save of the first admin sends no later request under the next admin (A-21)', async ({ browser, request, baseURL }) => {
  test.setTimeout(240_000)
  await new Promise((r) => setTimeout(r, 60_000))
  const stamp = Date.now().toString(36)
  const second = { email: `e2e-adm-${stamp}@example.com`, pass: 'e2e-adm-pass-1' }
  const target = { email: `e2e-tgt-${stamp}@example.com` }
  const hdr = { origin: baseURL! }
  expect((await request.fetch('/api/auth/admin/create-user', { method: 'POST', data: { email: second.email, name: 'E2E adm', role: 'admin', password: second.pass }, headers: hdr })).status()).toBe(200)
  expect((await request.fetch('/api/auth/admin/create-user', { method: 'POST', data: { email: target.email, name: 'E2E tgt', password: 'e2e-tgt-pass-1' }, headers: hdr })).status()).toBe(200)
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, locale: 'ko-KR' })
  try {
    const page = await ctx.newPage()
    await page.goto('/')
    await page.getByLabel('이메일').fill(process.env.ADMIN_EMAIL!)
    await page.getByLabel('비밀번호').fill(process.env.ADMIN_PASSWORD!)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await page.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })
    await page.goto('/#admin')
    await page.getByRole('button', { name: `${target.email} 관리` }).click()
    const dlg = page.getByRole('form', { name: target.email })
    await dlg.getByLabel('이름').fill('E2E renamed')
    await dlg.getByRole('group', { name: '역할' }).getByRole('button', { name: '관리자' }).click()
    // hold the answer to the first request (the name); it has reached the server
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    let sent!: () => void
    const wasSent = new Promise<void>((r) => { sent = r })
    let armed = true
    await ctx.route('**/api/auth/admin/update-user', async (route) => {
      if (!armed) return route.continue()
      armed = false
      const res = await route.fetch()
      sent()
      await gate
      await route.fulfill({ response: res })
    })
    await dlg.getByRole('button', { name: '저장' }).click()
    await wasSent
    await page.keyboard.press('Escape') // the open dialog makes the rest of the page inert
    await page.getByRole('button', { name: '로그아웃' }).first().click()
    await page.getByLabel('이메일').waitFor()
    await page.getByLabel('이메일').fill(second.email)
    await page.getByLabel('비밀번호').fill(second.pass)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page.getByRole('heading', { name: '관리', exact: true })).toBeVisible({ timeout: 15_000 })
    const later: string[] = []
    page.on('request', (r) => { if (r.method() !== 'GET') later.push(`${r.method()} ${new URL(r.url()).pathname}`) })
    release()
    await page.waitForTimeout(2000)
    expect(later.filter((x) => /\/admin\/users\/|set-user-password|ban-user|update-user/.test(x)), 'nothing more of the first save is sent').toEqual([])
    await expect(page.getByRole('status').filter({ hasText: '저장했어요' })).toHaveCount(0)
    // the target's role was never changed
    const users = (await (await request.fetch('/api/auth/admin/list-users?limit=500', { headers: hdr })).json()).users as { email: string; role: string }[]
    expect(users.find((u) => u.email === target.email)?.role).toBe('user')
  } finally {
    await ctx.close()
    const users = (await (await request.fetch('/api/auth/admin/list-users?limit=500', { headers: hdr })).json()).users as { id: string; email: string }[]
    for (const e of [second.email, target.email]) {
      const u = users.find((x) => x.email === e)
      if (u) await request.fetch(`/api/admin/users/${u.id}`, { method: 'DELETE', data: { confirmEmail: e }, headers: hdr })
    }
  }
})
