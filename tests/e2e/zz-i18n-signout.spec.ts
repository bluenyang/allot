// spec 008 V-8: the sign-in screen follows the browser's language, and after signing out it speaks the
// language the user chose. No sign-in happens here (the login rate limit is 5 a minute): the browser-
// language checks have no session, and the sign-out test ends the shared session, so this file is
// named to run last. The next run signs in again in global-setup.
import { choose } from './helpers'
import { expect, test, type Browser } from '@playwright/test'

async function guest(browser: Browser, locale: string) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale })
  const page = await ctx.newPage()
  await page.goto('/')
  return { ctx, page }
}

test('the sign-in screen follows the browser language: English for en-US, Korean for ko-KR', async ({ browser }) => {
  const en = await guest(browser, 'en-US')
  await expect(en.page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(en.page.getByLabel('Email')).toBeVisible()
  await expect(en.page.locator('html')).toHaveAttribute('lang', 'en')
  await en.ctx.close()
  const ko = await guest(browser, 'ko-KR')
  await expect(ko.page.getByRole('button', { name: '로그인', exact: true })).toBeVisible()
  await expect(ko.page.locator('html')).toHaveAttribute('lang', 'ko')
  await ko.ctx.close()
})

test('after signing out, the sign-in screen is in the language the user chose (English in a Korean browser)', async ({ page }) => {
  await page.goto('/#settings/general')
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PUT' && r.ok())
  await choose(page.locator('#g-lang'), 'en')
  await saved
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
  // put the account back to "follow the browser" on the server; the open page keeps English, as the choice is kept in this browser
  const state = (await (await page.request.get('/api/state')).json()) as { preferences: Record<string, unknown> }
  const reset = await page.request.put('/api/preferences', { data: { ...state.preferences, language: null }, headers: { origin: new URL(page.url()).origin } })
  expect(reset.ok()).toBe(true)
  await page.getByRole('button', { name: 'Sign out' }).first().click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
})
