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

/** Delete in the open sheet: the delete button asks in a confirmation dialog (spec 010 S-14); confirm it. */
export async function deleteInSheet(page: Page, title: string | RegExp) {
  const s = sheet(page, title)
  await s.getByRole('button', { name: '삭제' }).click()
  const ask = page.getByRole('alertdialog')
  await ask.getByRole('button', { name: '삭제', exact: true }).click()
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

/**
 * Type a day into a DateInput (spec 010 S-14): click its first part and type year, month and day in the order the
 * field shows them (the language decides it); each part moves on by itself.
 * `field` is the input's group (`page.getByRole('group', { name: '다음 결제일' })`).
 */
export async function fillDate(field: Locator, ymd: string) {
  const [y, m, d] = ymd.split('-')
  const order = await field.locator('[data-reka-date-field-segment]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.rekaDateFieldSegment))
  await field.getByRole('spinbutton').first().click()
  await field.page().keyboard.type(order.filter((p) => p === 'year' || p === 'month' || p === 'day').map((p) => (p === 'year' ? y : p === 'month' ? m : d)).join(''))
}

/** The `YYYY-MM-DD` a DateInput shows, from its parts (year, month, day by their names). */
export async function readDate(field: Locator) {
  const parts = await field.locator('[data-reka-date-field-segment]').evaluateAll((els) => els.map((e) => [(e as HTMLElement).dataset.rekaDateFieldSegment, (e as HTMLElement).innerText.trim()]))
  const get = (n: string) => parts.find(([k]) => k === n)?.[1] ?? ''
  return `${get('year').padStart(4, '0')}-${get('month').padStart(2, '0')}-${get('day').padStart(2, '0')}`
}
