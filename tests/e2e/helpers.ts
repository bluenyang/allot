import { expect, type Locator, type Page } from '@playwright/test'

export const MARK = `E2E-${Date.now().toString(36)}`

/** Open a page by its hash route and wait for the data to be on screen. */
export async function go(page: Page, hash: 'home' | 'subs' | 'pay' | 'events' | 'dev', tab?: string) {
  await page.goto(`/#${hash}`)
  await page.getByRole('tablist').first().waitFor()
  if (tab) await page.getByRole('tab', { name: tab }).click()
}

/** Reload and come back to the same page/tab: proves the value came from the server. */
export async function reload(page: Page, hash: Parameters<typeof go>[1], tab?: string) {
  await page.reload()
  await go(page, hash, tab)
}

export const sheet = (page: Page, title: string | RegExp) => page.getByRole('form', { name: title })

/** Save the open sheet and wait until it has closed (the API answered). */
export async function saveSheet(page: Page, title: string | RegExp, button = '저장') {
  const s = sheet(page, title)
  await s.getByRole('button', { name: button, exact: true }).click()
  await expect(s).toBeHidden()
}

/** Press-twice delete in the open sheet. */
export async function deleteInSheet(page: Page, title: string | RegExp) {
  const s = sheet(page, title)
  await s.getByRole('button', { name: '삭제' }).click()
  await s.getByRole('button', { name: '한 번 더 누르면 삭제' }).click()
  await expect(s).toBeHidden()
}

export async function noSaveError(page: Page) {
  await expect(page.locator('.save-err')).toHaveCount(0)
}

/** Pick an option of a Select (spec 010 S-13) by label, or by stored value as a string. */
export async function choose(trigger: Locator, pick: string | { label: string }) {
  const page = trigger.page()
  await trigger.click()
  const list = page.getByRole('listbox')
  const o = typeof pick === 'string' ? list.locator(`[role="option"][data-value="${pick}"]`) : list.getByRole('option', { name: pick.label, exact: true })
  await o.click()
  await expect(list).toBeHidden()
}

/** The labels of a Select's options (opens the list and closes it again). */
export async function optionTexts(trigger: Locator) {
  const page = trigger.page()
  await trigger.click()
  const list = page.getByRole('listbox')
  await expect(list).toBeVisible()
  const texts = (await list.getByRole('option').allTextContents()).map((x) => x.trim())
  await page.keyboard.press('Escape')
  await expect(list).toBeHidden()
  return texts
}
