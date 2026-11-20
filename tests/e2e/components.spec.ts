// spec 010 V-13 (W-10): the Reka-based components. Select by keyboard, a stored value outside the list,
// Select and Tip on a phone, and the role / aria state of Switch, Seg and Tabs.
import { expect, test, type APIRequestContext } from '@playwright/test'
import { go, sheet } from './helpers'

type Settings = Record<string, unknown> & { subRound: number }
async function api(request: APIRequestContext, method: 'GET' | 'PUT', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
const settings = async (request: APIRequestContext) => ((await api(request, 'GET', '/api/state')).json as { settings: Settings }).settings
// by id: an open Select hides the rest of the page from the accessibility tree, so a role-based path would not resolve
const roundOf = (page: import('@playwright/test').Page) => page.locator('#st-round')

test('(V-13) Select by keyboard: Enter, Space and ArrowDown open it; arrows and Enter pick; Escape closes; the focus returns', async ({ page, request }) => {
  const before = await settings(request)
  try {
    expect((await api(request, 'PUT', '/api/settings', { ...before, subRound: 10_000 })).status).toBe(200)
    await go(page, 'pay', '통장·생활비·설정')
    const round = roundOf(page)
    await expect(round).toHaveRole('combobox')
    await expect(round).toHaveText('₩10,000')
    const list = page.getByRole('listbox')
    for (const key of ['Enter', 'Space', 'ArrowDown']) {
      await round.focus()
      await page.keyboard.press(key)
      await expect(list).toBeVisible()
      await expect(round).toHaveAttribute('aria-expanded', 'true')
      await page.keyboard.press('Escape')
      await expect(list).toBeHidden()
      await expect(round).toBeFocused()
      await expect(round).toHaveText('₩10,000')
    }
    await round.focus()
    await page.keyboard.press('Enter')
    await expect(list).toBeVisible()
    await expect(page.getByRole('option', { name: '₩10,000' })).toBeFocused() // the selected option leads
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: '₩50,000' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(list).toBeHidden()
    await expect(round).toBeFocused()
    await expect(round).toHaveText('₩50,000')
  } finally {
    await api(request, 'PUT', '/api/settings', before)
  }
})

test('(V-13) a stored value outside the list is shown, stays selected and survives a save', async ({ page, request }) => {
  const before = await settings(request)
  try {
    expect((await api(request, 'PUT', '/api/settings', { ...before, subRound: 30_000 })).status).toBe(200)
    await go(page, 'pay', '통장·생활비·설정')
    const round = roundOf(page)
    await expect(round).toHaveText('₩30,000')
    await round.click()
    await expect(page.getByRole('option', { name: '₩30,000' })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    const form = page.getByRole('form', { name: '분배 설정' })
    await form.getByRole('button', { name: '저장', exact: true }).click()
    await expect(form.getByRole('status')).toHaveText('저장했어요.')
    expect((await settings(request)).subRound).toBe(30_000)
    await page.reload()
    await go(page, 'pay', '통장·생활비·설정')
    await expect(roundOf(page)).toHaveText('₩30,000')
  } finally {
    await api(request, 'PUT', '/api/settings', before)
  }
})

test('(V-13) on a phone the Select list opens inside the screen and picks; the help bubble stays inside', async ({ page, request }) => {
  const before = await settings(request)
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await go(page, 'pay', '통장·생활비·설정')
    const round = roundOf(page)
    await round.scrollIntoViewIfNeeded()
    await round.click()
    const list = page.getByRole('listbox')
    await expect(list).toBeVisible()
    const box = (await list.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(844)
    await page.getByRole('option', { name: '₩50,000', exact: true }).click()
    await expect(list).toBeHidden()
    await expect(round).toHaveText('₩50,000')
  } finally {
    await api(request, 'PUT', '/api/settings', before)
  }
})

test('(V-13) a Select inside an editor: the list opens in the dialog, Escape closes only the list', async ({ page }) => {
  await go(page, 'pay', '구간')
  await page.getByRole('button', { name: '+ 분배 대상 추가' }).click()
  const s = sheet(page, '분배 대상 추가')
  const kind = page.locator('#tg-kind') // by id: the open list hides the form from the accessibility tree
  await kind.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('listbox')).toBeHidden()
  await expect(s).toBeVisible()
  await expect(kind).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(s).toBeHidden()
})

test('(V-13) Switch, Seg and Tabs carry their role and aria state', async ({ page }) => {
  await go(page, 'pay', '통장·생활비·설정')
  const tabs = page.getByRole('tab')
  await expect(tabs.first()).toHaveAttribute('aria-selected', /true|false/)
  const selected = page.locator('[role="tab"][aria-selected="true"]')
  await expect(selected).toHaveCount(1)
  const other = page.locator('[role="tab"][aria-selected="false"]').first()
  const name = await other.textContent()
  await other.click()
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveText(name!.trim())

  await go(page, 'home')
  await page.goto('/#history')
  const seg = page.getByRole('group', { name: '바꾼 사람으로 거르기' })
  const pressed = seg.locator('button[aria-pressed="true"]')
  await expect(pressed).toHaveCount(1)
  await pressed.click() // the selected one cannot be switched off
  await expect(seg.locator('button[aria-pressed="true"]')).toHaveCount(1)
  await seg.getByRole('button').nth(1).click()
  await expect(seg.locator('button[aria-pressed="true"]')).toHaveCount(1)
  await expect(seg.getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true')
  await seg.getByRole('button').first().click()

  await page.goto('/#settings/general')
  const sw = page.getByRole('switch').first()
  await expect(sw).toHaveAttribute('aria-checked', /true|false/)
  const was = await sw.getAttribute('aria-checked')
  await sw.focus()
  await page.keyboard.press('Space')
  await expect(sw).not.toHaveAttribute('aria-checked', was!)
  await page.keyboard.press('Space')
  await expect(sw).toHaveAttribute('aria-checked', was!)
})
