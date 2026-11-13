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

  await page.goto('/#admin')
  await expect(page.getByRole('heading', { name: /승인 대기 \d+명/ })).toBeVisible()
  const row = page.locator('.warnbox li', { hasText: DEX_USER })
  await row.getByRole('button', { name: '승인' }).click()
  await expect(page.getByRole('status')).toContainText('승인했어요')

  await g.goto('/')
  await dexLogin(g, DEX_USER)
  await g.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })
  await g.goto('/#account')
  await expect(g.getByText(DEX_USER)).toBeVisible()
  await expect(g.locator('.list li', { hasText: 'Dex' })).toBeVisible()
  await guest.close()
})

test('admin screen: create an account without a password, then delete it completely', async ({ page }) => {
  const email = `e2e-${Date.now().toString(36)}@example.com`
  await page.goto('/#admin')
  await page.getByRole('button', { name: '+ 계정 만들기' }).click()
  const sheet = page.getByRole('form', { name: '새 계정' })
  await sheet.getByLabel('이메일').fill(email)
  await sheet.getByLabel('이름').fill('E2E')
  await sheet.getByRole('button', { name: '저장' }).click()
  await expect(page.getByRole('status')).toContainText('계정을 만들었어요')
  await page.getByRole('row', { name: new RegExp(email) }).click()
  const edit = page.getByRole('form', { name: email })
  await edit.getByLabel(/완전 삭제/).fill('wrong@example.com')
  await edit.getByRole('button', { name: '계정과 데이터 완전 삭제' }).click()
  await expect(edit.getByRole('alert')).toContainText('이메일')
  await edit.getByLabel(/완전 삭제/).fill(email)
  await edit.getByRole('button', { name: '계정과 데이터 완전 삭제' }).click()
  await expect(page.getByRole('status')).toContainText('모두 지웠어요')
  await expect(page.getByRole('row', { name: new RegExp(email) })).toHaveCount(0)
})

test('login methods tab: env-free fields are editable, the secret is never shown', async ({ page }) => {
  await page.goto('/#admin')
  await page.getByRole('tab', { name: '로그인 방식' }).click()
  await page.locator('.cards .panel', { hasText: 'OIDC' }).click()
  const s = page.getByRole('form', { name: 'OIDC 설정' })
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
