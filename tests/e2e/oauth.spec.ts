// spec 015 V-7: the OAuth screens. The consent screen (three permissions, the ones not asked for greyed, deny, the
// localhost warning, phone width), sign-in that continues to the consent screen (password; OIDC with Dex when
// DEX_CLIENT_SECRET is set), the connected apps in 설정 › AI·연동 with disconnect, the MCP address /mcp, and the switch
// in 관리 › 로그인 방식. Run on the test server (:15174): it turns external app connections on and registers fake apps.
// With ALLOT_OAUTH_ENABLED set on the server the switch is locked: the switch test then only checks that it is.
import { createHash, randomBytes } from 'node:crypto'
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK } from './helpers'

const CALLBACK = 'http://127.0.0.1:7777/callback'
type Switch = { enabled: boolean; locked: boolean; possible: boolean }

async function oauthOn(request: APIRequestContext) {
  const cur = (await (await request.get('/api/admin/oauth')).json()) as Switch
  if (!cur.locked && !cur.enabled) expect((await request.put('/api/admin/oauth', { data: { enabled: true } })).ok()).toBe(true)
  const now = (await (await request.get('/api/admin/oauth')).json()) as Switch
  test.skip(!now.enabled || !now.possible, 'external app connections cannot be on here (env off, or BETTER_AUTH_URL not https/loopback)')
}

/** A fake app registered the way an MCP client does (DCR, no session). */
async function register(name: string): Promise<string> {
  const base = test.info().project.use.baseURL!
  const anon = await playwrightRequest.newContext({ baseURL: base, storageState: { cookies: [], origins: [] } })
  try {
    const r = await anon.post('/api/auth/oauth2/register', {
      headers: { origin: base },
      data: { client_name: name, redirect_uris: [CALLBACK], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] },
    })
    expect(r.status(), await r.text()).toBe(201)
    return ((await r.json()) as { client_id: string }).client_id
  } finally {
    await anon.dispose()
  }
}

function authorizeUrl(clientId: string, scope = 'openid offline_access allot:read allot:propose allot:apply') {
  const verifier = randomBytes(32).toString('base64url')
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, scope, state: 'e2e',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    resource: `${test.info().project.use.baseURL!}/mcp`,
  })
  return `/api/auth/oauth2/authorize?${q}`
}

/** The fake app's callback answers, so the browser's last stop can be read. */
async function catchCallback(page: Page) {
  await page.route('http://127.0.0.1:7777/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: 'callback' }))
}

async function disconnectAll(request: APIRequestContext) {
  const r = (await (await request.get('/api/oauth-apps')).json()) as { apps: { clientId: string; name: string }[] }
  for (const a of r.apps.filter((x) => x.name.startsWith(MARK))) expect((await request.delete(`/api/oauth-apps/${encodeURIComponent(a.clientId)}`)).ok()).toBe(true)
}

test.afterAll(async ({ request }) => { await disconnectAll(request) })

test('consent: the app and where it goes back, three permissions, the localhost warning; allow goes back with a code', async ({ page, request }) => {
  await oauthOn(request)
  const app = `${MARK}-app`
  const id = await register(app)
  await catchCallback(page)
  await page.goto(authorizeUrl(id))
  await expect(page).toHaveURL(/\/oauth\/consent\?/)
  await expect(page.getByRole('heading', { name: `${app} 앱이 내 Allot에 연결하려고 해요.` })).toBeVisible()
  await expect(page.getByText('127.0.0.1:7777', { exact: true })).toBeVisible()
  await expect(page.getByRole('note').filter({ hasText: 'localhost' })).toBeVisible()
  const group = page.getByRole('radiogroup', { name: '이 앱에 줄 권한' })
  await expect(group.getByRole('radio')).toHaveCount(3)
  // the narrowest permission is chosen first
  await expect(group.getByRole('radio', { name: /^읽기/ })).toHaveAttribute('aria-checked', 'true')
  await group.getByRole('radio', { name: /화면에서 확인/ }).click()
  const back = page.waitForRequest((r) => r.url().startsWith(CALLBACK))
  await page.getByRole('button', { name: '허락' }).click()
  const url = new URL((await back).url())
  expect(url.searchParams.get('code')).toBeTruthy()
  expect(url.searchParams.get('state')).toBe('e2e')

  // the connection is in 설정 › AI·연동 with its permission; the MCP address is the root /mcp
  await page.goto('/settings/ai')
  const base = test.info().project.use.baseURL!
  await expect(page.getByText(`${base}/mcp`, { exact: true })).toBeVisible()
  const row = page.getByRole('listitem').filter({ hasText: app })
  await expect(row).toContainText('쓰기 제안 · 화면에서 확인')
  await row.getByRole('button', { name: `${app} 연결 끊기` }).click()
  const dlg = page.getByRole('alertdialog')
  await expect(dlg).toContainText(`${app} 연결을 끊을까요?`)
  await dlg.getByRole('button', { name: '끊기' }).click()
  await expect(page.getByRole('status')).toContainText(`${app} 연결을 끊었어요.`)
  await expect(page.getByRole('listitem').filter({ hasText: app })).toHaveCount(0)
})

test('consent: a permission the app did not ask for cannot be chosen; deny goes back with access_denied', async ({ page, request }) => {
  await oauthOn(request)
  const id = await register(`${MARK}-readonly`)
  await catchCallback(page)
  await page.goto(authorizeUrl(id, 'openid allot:read'))
  const group = page.getByRole('radiogroup', { name: '이 앱에 줄 권한' })
  await expect(group.getByRole('radio', { name: /^읽기/ })).toBeEnabled()
  await expect(group.getByRole('radio', { name: /화면에서 확인/ })).toBeDisabled()
  await expect(group.getByRole('radio', { name: /대화에서 확인/ })).toBeDisabled()
  await expect(group.getByText('앱이 요청하지 않은 권한이에요.')).toHaveCount(2)
  const back = page.waitForRequest((r) => r.url().startsWith(CALLBACK))
  await page.getByRole('button', { name: '거절' }).click()
  expect(new URL((await back).url()).searchParams.get('error')).toBe('access_denied')
})

test('consent at phone width: no horizontal scroll', async ({ page, request }) => {
  await oauthOn(request)
  const id = await register(`${MARK}-phone-${'x'.repeat(40)}`)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(authorizeUrl(id))
  await expect(page.getByRole('radiogroup', { name: '이 앱에 줄 권한' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('signed out: the sign-in screen, then straight to the consent screen (password)', async ({ browser, request }) => {
  await oauthOn(request)
  const id = await register(`${MARK}-signin`)
  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: 'ko-KR' })
  const g = await guest.newPage()
  try {
    await g.goto(authorizeUrl(id))
    await expect(g).toHaveURL(/\/oauth\/login\?/)
    await g.getByLabel('이메일').fill(process.env.ADMIN_EMAIL!)
    await g.getByLabel('비밀번호').fill(process.env.ADMIN_PASSWORD!)
    await g.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(g).toHaveURL(/\/oauth\/consent\?/, { timeout: 15_000 })
    await expect(g.getByRole('radiogroup', { name: '이 앱에 줄 권한' })).toBeVisible()
  } finally {
    await guest.close()
  }
})

test('signed out: the sign-in screen, then the consent screen (OIDC with Dex)', async ({ browser, request }) => {
  test.skip(!process.env.DEX_CLIENT_SECRET, 'DEX_CLIENT_SECRET is not set: no Dex on this server')
  await oauthOn(request)
  const id = await register(`${MARK}-dex`)
  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: 'ko-KR' })
  const g = await guest.newPage()
  try {
    await g.goto(authorizeUrl(id))
    await expect(g).toHaveURL(/\/oauth\/login\?/)
    await g.getByRole('button', { name: /\(으\)로 로그인/ }).first().click()
    const byEmail = g.getByText('Log in with Email')
    await g.locator('#login').or(byEmail).first().waitFor()
    if (await byEmail.count()) await byEmail.click()
    await g.locator('#login').fill('dex-alice@example.org')
    await g.locator('#password').fill('dex-password')
    await g.locator('#submit-login').click()
    await expect(g).toHaveURL(/\/oauth\/consent\?/, { timeout: 20_000 })
  } finally {
    await guest.close()
  }
})

test('관리 › 로그인 방식: the external app connection switch (locked when env sets it)', async ({ page, request }) => {
  const cur = (await (await request.get('/api/admin/oauth')).json()) as Switch
  await page.goto('/admin')
  await page.getByRole('tab', { name: '로그인 방식' }).click()
  const sw = page.getByRole('switch', { name: '외부 앱이 OAuth로 연결하게 허용' })
  await expect(sw).toBeVisible()
  if (cur.locked) {
    await expect(sw).toBeDisabled()
    await expect(page.getByText('ALLOT_OAUTH_ENABLED')).toBeVisible()
    return
  }
  if (!cur.enabled) {
    await sw.check()
    await expect(page.getByRole('status')).toContainText('외부 앱 연결을 켰어요.')
  }
  page.once('dialog', (d) => d.accept())
  await sw.uncheck()
  await expect(page.getByRole('status')).toContainText('외부 앱 연결을 껐어요.')
  expect(((await (await request.get('/api/admin/oauth')).json()) as Switch).enabled).toBe(false)
  expect((await request.get('/.well-known/oauth-authorization-server')).status()).toBe(404)
  await sw.check()
  await expect(page.getByRole('status')).toContainText('외부 앱 연결을 켰어요.')
  if (!cur.enabled) {
    expect((await request.put('/api/admin/oauth', { data: { enabled: false } })).ok()).toBe(true)
  }
})
