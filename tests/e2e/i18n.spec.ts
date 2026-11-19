// spec 008 V-8: the screen language. English from 설정 › 일반 (menus, titles, <html lang>, kept on the
// server), the server's messages come in the screen language,
// and the three English amount units. The shared admin account is put back to "follow the browser".
// The sign-in screen and sign-out are in 00-i18n-signout.spec.ts (they sign in; the login rate limit is 5 a minute).
import { expect, test, type Page } from '@playwright/test'

const MARK = `i18n-${Date.now().toString(36)}`

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
  await s.getByRole('button', { name: 'Next' }).click()
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
  await unit('Won').click() // the unit is saved at once: put the shared account back
  await expect(page.getByRole('status').filter({ hasText: 'Saved right away.' })).toBeVisible()
})
