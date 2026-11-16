// spec 008 V-8: the sign-in screen and sign-out. It signs in once (a throwaway account, so the shared
// session stays), and the login rate limit is 5 a minute: the file is named to run first, so its
// sign-in is far from the other specs' sign-ins (knowledge 2026-11-16_login-rate-limit-in-tests).
import { expect, request as playwrightRequest, test, type Browser, type Page } from '@playwright/test'

const MARK = `i18n-${Date.now().toString(36)}`
const PASSWORD = 'e2e-pass-12345'

/** Pick a language in 설정 › 일반 and wait until it is saved. */
async function pickLanguage(page: Page, value: 'browser' | 'ko' | 'en') {
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PUT' && r.ok())
  await page.locator('#g-lang').selectOption(value)
  await saved
}

async function guestLogin(browser: Browser, email: string, locale: string) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale })
  const page = await ctx.newPage()
  await page.goto('/')
  return { ctx, page }
}

test('sign-in screen follows the browser language; sign-out after choosing English shows English', async ({ browser, baseURL }) => {
  // browser language alone
  const en = await guestLogin(browser, '', 'en-US')
  await expect(en.page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(en.page.locator('html')).toHaveAttribute('lang', 'en')
  await en.ctx.close()
  const ko = await guestLogin(browser, '', 'ko-KR')
  await expect(ko.page.getByRole('button', { name: '로그인', exact: true })).toBeVisible()
  await expect(ko.page.locator('html')).toHaveAttribute('lang', 'ko')
  await ko.ctx.close()

  // a throwaway account chooses English, signs out, and the sign-in screen is English even in a Korean browser
  const email = `${MARK}@example.com`
  const admin = await playwrightRequest.newContext({ baseURL, storageState: 'tests/e2e/.auth.json' })
  const origin = { origin: baseURL! }
  const made = await admin.post('/api/auth/admin/create-user', { data: { email, name: 'E2E', password: PASSWORD, role: 'user' }, headers: origin })
  expect(made.status()).toBe(200)
  const id = ((await made.json()) as { user: { id: string } }).user.id
  try {
    const g = await guestLogin(browser, email, 'ko-KR')
    await g.page.getByLabel('이메일').fill(email)
    await g.page.getByLabel('비밀번호').fill(PASSWORD)
    await g.page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(g.page.getByRole('tab', { name: '이번 달' })).toBeVisible({ timeout: 15_000 })
    await g.page.goto('/#settings/general')
    await pickLanguage(g.page, 'en')
    await g.page.getByRole('button', { name: 'Sign out' }).first().click()
    await expect(g.page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await expect(g.page.locator('html')).toHaveAttribute('lang', 'en')
    await g.ctx.close()
  } finally {
    await admin.delete(`/api/admin/users/${id}`, { data: { confirmEmail: email }, headers: origin })
    await admin.dispose()
  }
})
