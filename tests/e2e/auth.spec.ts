// spec 006 W-6 / V-5 (b), V-8 (UI): login methods, approval, the admin and account screens.
// Needs the dev stack with Dex (docker/compose.dev.yaml) and DEX_CLIENT_SECRET in the test's env.
// It sets the OIDC login method through the admin screen's API, so run it on a test database.
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test'

const DEX_USER = 'dex-alice@example.org'
const DEX_PASSWORD = 'dex-password'

async function adminApi(request: APIRequestContext, method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}

/** OIDC on through the admin API, with the given sign-up policy. */
async function setOidc(request: APIRequestContext, signup: 'closed' | 'approval' | 'rules') {
  const base = test.info().project.use.baseURL!
  const secret = process.env.DEX_CLIENT_SECRET
  test.skip(!secret, 'DEX_CLIENT_SECRET is not set')
  const current = (await adminApi(request, 'GET', '/api/admin/providers')).json.providers.find((p: { id: string }) => p.id === 'oidc')
  const body: Record<string, unknown> = { enabled: true, signup, options: { name: 'Dex', clientId: 'allot-dev', discoveryUrl: `${base}/dex/.well-known/openid-configuration`, scopes: ['openid', 'email', 'profile', 'groups'] } }
  if (!current.secretSet) body.clientSecret = secret
  const r = await adminApi(request, 'PUT', '/api/admin/providers/oidc', body)
  expect(r.status, JSON.stringify(r.json)).toBe(200)
}

async function dexLogin(page: Page, email: string) {
  await page.getByRole('button', { name: 'Dex(으)로 로그인' }).click()
  const byEmail = page.getByText('Log in with Email')
  await page.locator('#login').or(byEmail).first().waitFor()
  if (await byEmail.count()) await byEmail.click()
  await page.locator('#login').fill(email)
  await page.locator('#password').fill(DEX_PASSWORD)
  await page.locator('#submit-login').click()
}

test('approval: a new OIDC user waits, the admin approves, then the app opens', async ({ page, request, browser }) => {
  await setOidc(request, 'approval')
  // start clean: remove the Dex user's account if an earlier run left one
  const listed = (await adminApi(request, 'GET', '/api/auth/admin/list-users?limit=500')).json.users as { id: string; email: string }[]
  const old = listed.find((u) => u.email === DEX_USER)
  if (old) expect((await adminApi(request, 'DELETE', `/api/admin/users/${old.id}`, { confirmEmail: DEX_USER })).status).toBe(204)

  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const g = await guest.newPage()
  await g.goto('/')
  await dexLogin(g, DEX_USER)
  await expect(g.getByRole('alert')).toContainText('관리자 승인을 기다리고 있어요')

  await page.goto('/admin')
  // the account list says who waits; approving is choosing 활성 in the account's dialog and saving
  await expect(page.getByText(/승인 대기 \d+/).first()).toBeVisible()
  await page.getByRole('button', { name: `${DEX_USER} 관리` }).click()
  const manage = page.getByRole('form', { name: DEX_USER })
  await manage.getByRole('group', { name: '상태' }).getByRole('button', { name: '활성' }).click()
  await manage.getByRole('button', { name: '저장' }).click()
  await expect(page.getByRole('status')).toContainText('승인했어요')

  await g.goto('/')
  await dexLogin(g, DEX_USER)
  await g.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })
  await g.goto('/settings/security')
  await expect(g.getByText(DEX_USER, { exact: true })).toBeVisible()
  await expect(g.locator('.list li', { hasText: 'Dex' })).toBeVisible()
  await guest.close()
})

test('admin screen: create an account without a password, then delete it completely', async ({ page }) => {
  const email = `e2e-${Date.now().toString(36)}@example.com`
  await page.goto('/admin')
  await page.getByRole('button', { name: '계정 만들기' }).click()
  const sheet = page.getByRole('form', { name: '새 계정' })
  await sheet.getByLabel('이메일').fill(email)
  await sheet.getByLabel('이름').fill('E2E')
  // no password unless one is chosen: empty means external login only (spec 010 AD-9)
  await expect(sheet.getByText('비밀번호 없이 만들어요')).toBeVisible()
  await sheet.getByRole('button', { name: '직접 정하기' }).click()
  await expect(sheet.getByLabel('임시 비밀번호')).toHaveValue('')
  await sheet.getByRole('button', { name: '저장' }).click()
  await expect(page.getByRole('status')).toContainText('계정을 만들었어요')
  await page.getByRole('button', { name: `${email} 관리` }).click()
  const edit = page.getByRole('form', { name: email })
  await edit.getByRole('button', { name: '삭제', exact: true }).click()
  await edit.getByLabel(/완전 삭제/).fill('wrong@example.com')
  await edit.getByRole('button', { name: '계정과 데이터 완전 삭제' }).click()
  await expect(edit.getByRole('alert')).toContainText('이메일')
  await edit.getByLabel(/완전 삭제/).fill(email)
  await edit.getByRole('button', { name: '계정과 데이터 완전 삭제' }).click()
  await expect(page.getByRole('status')).toContainText('모두 지웠어요')
  await expect(page.getByRole('row', { name: new RegExp(email) })).toHaveCount(0)
})

test('login methods tab: env-free fields are editable, the secret is never shown', async ({ page }) => {
  await page.goto('/admin')
  await page.getByRole('tab', { name: '로그인 방식' }).click()
  await page.getByRole('button', { name: 'OIDC 설정' }).click()
  const s = page.getByRole('form', { name: 'OIDC 로그인' })
  await expect(s.getByLabel(/client secret/)).toHaveValue('')
  await expect(s.getByLabel(/client secret/)).toHaveAttribute('type', 'password')
  await s.getByRole('button', { name: '취소' }).click()
})

// V-12 (b), review 1 R7: the browser relay for a mobile app. Needs ALLOT_APP_RETURN_URLS=allot://auth
// on the api, and runs after the approval test (the Dex user is active by then).
test('app login relay: sign in through Dex, then a one-time token for the listed app URL only', async ({ browser }) => {
  for (const [ret, want] of [['allot://auth', 200], ['evil://x', 400]] as const) {
    const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const g = await guest.newPage()
    await g.goto(`/#app-login?return=${encodeURIComponent(ret)}`)
    await expect(g.getByText('로그인하면 앱으로 돌아가요.')).toBeVisible()
    const ticket = g.waitForResponse((r) => r.url().endsWith('/api/app-login/ticket'), { timeout: 20_000 })
    await dexLogin(g, DEX_USER)
    const res = await ticket
    expect(res.status()).toBe(want)
    if (want === 200) {
      const url = new URL((await res.json()).url)
      expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('allot://auth')
      const ott = url.searchParams.get('ott')
      expect(ott).toBeTruthy()
      // what the app does next: trade the token once for a bearer session (review 2)
      // like an app: no cookies at all (the test's own login cookie would make Better Auth ask for an Origin)
      const api = await playwrightRequest.newContext({ baseURL: test.info().project.use.baseURL, storageState: { cookies: [], origins: [] } })
      const first = await api.post('/api/auth/one-time-token/verify', { data: { token: ott } })
      expect(first.status(), await first.text()).toBe(200)
      const bearer = first.headers()['set-auth-token']
      expect(bearer).toBeTruthy()
      const state = await api.get('/api/state', { headers: { authorization: `Bearer ${bearer}` } })
      expect(state.status()).toBe(200)
      const again = await api.post('/api/auth/one-time-token/verify', { data: { token: ott } })
      expect(again.status()).toBeGreaterThanOrEqual(400)
      await api.dispose()
    } else {
      await expect(g.getByRole('alert')).toContainText('등록되지 않은 앱 주소')
    }
    await guest.close()
  }
})

// V-6 (c) on the account screen (audit 0.1.2 A-2): link Dex from 계정, unlink it; the last login cannot go.
test('account screen: link Dex, unlink it, the last login stays', async ({ request, browser }) => {
  await setOidc(request, 'closed') // explicit linking does not depend on the sign-up policy
  const DEX_LINK_USER = 'dex-bob@example.org'
  const listed = (await adminApi(request, 'GET', '/api/auth/admin/list-users?limit=500')).json.users as { id: string; email: string }[]
  const old = listed.find((u) => u.email === DEX_LINK_USER)
  if (old) expect((await adminApi(request, 'DELETE', `/api/admin/users/${old.id}`, { confirmEmail: DEX_LINK_USER })).status).toBe(204)
  const email = `e2e-link-${Date.now().toString(36)}@example.com`
  const made = await adminApi(request, 'POST', '/api/auth/admin/create-user', { email, name: 'E2E link', password: 'e2e-link-pass-1' })
  expect(made.status).toBe(200)

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const g = await ctx.newPage()
  await g.goto('/')
  await g.getByLabel('이메일').fill(email)
  await g.getByLabel('비밀번호').fill('e2e-link-pass-1')
  await g.getByRole('button', { name: '로그인', exact: true }).click()
  await g.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })
  await g.goto('/settings/security')
  const logins = g.locator('.list li')
  await expect(logins).toHaveCount(1)
  await g.getByRole('button', { name: 'Dex 연결' }).click()
  const byEmail = g.getByText('Log in with Email')
  await g.locator('#login').or(byEmail).first().waitFor()
  if (await byEmail.count()) await byEmail.click()
  await g.locator('#login').fill(DEX_LINK_USER)
  await g.locator('#password').fill(DEX_PASSWORD)
  await g.locator('#submit-login').click()
  await g.waitForURL(/\/settings\/security$/, { timeout: 20_000 })
  await expect(logins).toHaveCount(2)
  await expect(logins.filter({ hasText: 'Dex' })).toHaveCount(1)

  g.once('dialog', (d) => d.accept())
  await logins.filter({ hasText: 'Dex' }).getByRole('button', { name: '해제' }).click()
  await expect(g.getByRole('status')).toContainText('연결을 해제했어요')
  await expect(logins).toHaveCount(1)
  await expect(logins.first()).toContainText('비밀번호')
  await expect(logins.first().getByRole('button', { name: '해제' })).toBeDisabled()
  await ctx.close()

  const u = (await adminApi(request, 'GET', '/api/auth/admin/list-users?limit=500')).json.users.find((x: { email: string }) => x.email === email)
  expect((await adminApi(request, 'DELETE', `/api/admin/users/${u.id}`, { confirmEmail: email })).status).toBe(204)
})
