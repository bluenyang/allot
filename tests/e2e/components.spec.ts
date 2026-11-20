// spec 010 V-13 (W-10): the Reka-based components. Select by keyboard, a stored value outside the list,
// Select and Tip on a phone, and the role / aria state of Switch, Seg and Tabs.
import { expect, test, type APIRequestContext } from '@playwright/test'
import { MARK, go, sheet } from './helpers'

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

test('(V-13) on a phone a tap on the help "?" opens its bubble inside the screen; Escape and a tap outside close it, the editor stays', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, 'subs', '목록')
  await page.getByRole('button', { name: '구독 추가' }).click()
  const s = sheet(page, '구독 추가')
  await s.getByLabel('서비스 이름').fill(`${MARK}-tap`)
  await s.getByRole('button', { name: '다음' }).click()
  await s.getByRole('button', { name: 'USD', exact: true }).click()
  const tips = s.getByRole('img', { name: /^도움말/ })
  const count = await tips.count()
  expect(count).toBeGreaterThan(0)
  for (let i = 0; i < count; i++) {
    const bub = tips.nth(i).getByRole('tooltip', { includeHidden: true })
    await tips.nth(i).click()
    await expect(bub).toBeVisible()
    const box = (await bub.boundingBox())!
    expect(box.x, `tip ${i} left`).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, `tip ${i} right`).toBeLessThanOrEqual(390)
    expect(box.y, `tip ${i} top`).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height, `tip ${i} bottom`).toBeLessThanOrEqual(844)
    await page.keyboard.press('Escape')
    await expect(bub).toBeHidden()
    await expect(s).toBeVisible()
    await tips.nth(i).click() // open again, then tap outside (the editor's title)
    await expect(bub).toBeVisible()
    await s.getByRole('heading').first().click()
    await page.mouse.move(0, 0)
    await expect(bub).toBeHidden()
    await expect(s).toBeVisible()
  }
})

// W-11 (S-13): the dialogs on Reka. Outside click, focus in and back, Escape order.
test('(V-13) editor: a click outside does not close it; Escape does and the focus goes back to the opener', async ({ page }) => {
  await go(page, 'subs', '목록')
  const opener = page.getByRole('button', { name: '구독 추가' })
  await opener.click()
  const dlg = page.getByRole('dialog', { name: '구독 추가' })
  await expect(dlg).toBeVisible()
  await expect(page.locator('#e-name')).toBeFocused()
  await page.mouse.click(4, 4) // the dimmed layer
  await expect(dlg).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dlg).toBeHidden()
  await expect(opener).toBeFocused()
})

test('(V-13) confirmation over an editor: focus starts on the cancel button; the backdrop and Escape close only the confirmation; focus goes back', async ({ page, request }) => {
  const mk = await request.post('/api/subscriptions', { data: { name: `${MARK}-cf`, category: 'tool', plan: 'p', amount: 1000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false } })
  expect(mk.ok()).toBe(true)
  const id = ((await mk.json()) as { id: string }).id
  try {
    await go(page, 'subs', '목록')
    await page.getByRole('button', { name: `${MARK}-cf 수정` }).click()
    const s = sheet(page, '구독 수정')
    await s.getByRole('button', { name: '다음' }).click()
    const del = s.getByRole('button', { name: '삭제' })
    for (const how of ['backdrop', 'escape'] as const) {
      await del.focus()
      await page.keyboard.press('Enter')
      const alert = page.getByRole('alertdialog')
      await expect(alert).toBeVisible()
      await expect(alert.getByRole('button', { name: '취소' })).toBeFocused()
      if (how === 'backdrop') await page.mouse.click(4, 4)
      else await page.keyboard.press('Escape')
      await expect(alert).toHaveCount(0)
      await expect(s).toBeVisible()
      await expect(del).toBeFocused()
    }
    await page.keyboard.press('Escape')
    await expect(s).toBeHidden()
  } finally {
    expect((await request.delete(`/api/subscriptions/${id}`)).ok()).toBe(true)
  }
})

test('(V-13) the phone sheet opens with the focus inside; Escape and the backdrop close it and the focus goes back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, 'home')
  const more = page.getByRole('button', { name: '더보기' })
  for (const how of ['escape', 'backdrop', 'close'] as const) {
    await more.click()
    const sh = page.getByRole('dialog', { name: '더보기' })
    await expect(sh).toBeVisible()
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true)
    if (how === 'escape') await page.keyboard.press('Escape')
    else if (how === 'backdrop') await page.mouse.click(195, 20)
    else await sh.getByRole('button', { name: '닫기' }).click()
    await expect(sh).toBeHidden()
    await expect(more).toBeFocused()
  }
})
