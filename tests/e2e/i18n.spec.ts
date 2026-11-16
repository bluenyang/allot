// spec 008 V-8: the screen language. English from 설정 › 일반 (menus, titles, <html lang>, kept on the
// server), the sign-in screen follows the browser, the server's messages come in the screen language,
// and the three English amount units. The shared admin account is put back to "follow the browser".
// The sign-out test uses a throwaway account, so it does not end the shared session.
import { expect, request as playwrightRequest, test, type Browser, type Page } from '@playwright/test'

const MARK = `i18n-${Date.now().toString(36)}`
const PASSWORD = 'e2e-pass-12345'

/** Pick a language in 설정 › 일반 and wait until it is saved. */
async function pickLanguage(page: Page, value: 'browser' | 'ko' | 'en') {
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PUT' && r.ok())
  await page.locator('#g-lang').selectOption(value)
  await saved
}

async function openGeneral(page: Page) {
  await page.goto('/#settings/general')
  await expect(page.locator('#g-lang')).toBeVisible()
}

test.afterEach(async ({ page }) => {
  // whatever happened, the shared account follows the browser again
  await openGeneral(page)
  if ((await page.locator('#g-lang').inputValue()) !== 'browser') await pickLanguage(page, 'browser')
})

test('English from the settings: menus, titles, html lang, kept after a reload', async ({ page }) => {
  await openGeneral(page)
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()

  await pickLanguage(page, 'en')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Menu' })
  for (const name of ['Overview', 'Subscriptions', 'Pay split', 'Schedule', 'Change history']) await expect(nav.getByRole('link', { name })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'General' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeVisible()

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  // the other pages' titles
  await page.goto('/#history')
  await expect(page.getByRole('heading', { name: 'Change history', exact: true })).toBeVisible()
  await page.goto('/#subs')
  await expect(page.getByRole('heading', { name: 'Subscriptions', exact: true })).toBeVisible()

  await openGeneral(page)
  await pickLanguage(page, 'ko')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko')
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
})

test('the server answers an invalid save in English', async ({ page }) => {
  await openGeneral(page)
  await pickLanguage(page, 'en')
  await page.getByRole('button', { name: '+ Add set' }).click()
  const s = page.getByRole('form', { name: 'Add holiday set' })
  await s.getByLabel('Set name').fill(`${MARK} set`)
  await s.getByLabel('Name', { exact: true }).fill('Founding day')
  await s.getByLabel('Type').selectOption('rrule')
  await s.getByLabel('RRULE').fill('FREQ=MONTHLY')
  await s.getByRole('button', { name: 'Save' }).click()
  await expect(s.getByRole('alert')).toContainText('Holiday rules only support FREQ=YEARLY')
  await s.getByRole('button', { name: 'Cancel' }).click()
})

test('amount units in English: ₩1,234 · ₩1,234K · ₩123.4×10K', async ({ page }) => {
  await openGeneral(page)
  await pickLanguage(page, 'en')
  const total = page.locator('.pv tr.sum td.n')
  const unit = (name: string) => page.getByRole('group', { name: 'Amount unit' }).getByRole('button', { name, exact: true })
  await unit('Won').click()
  await expect(total).toHaveText(/^[−(]?₩[\d,]+\)?$/)
  await unit('Thousand').click()
  await expect(total).toHaveText(/^[−(]?₩[\d,]+K\)?$/)
  await unit('×10,000').click()
  await expect(total).toHaveText(/^[−(]?₩[\d,]+(\.\d)?×10K\)?$/)
  await page.getByRole('button', { name: 'Cancel' }).click() // drop the unsaved draft
})

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
