// spec 017 V-5: 설정 › AI·연동 › 앱 연결 — nine apps, each dialog fills in this server's MCP address, copies, links to
// the official help in a new tab and closes with Esc back to its tile; with OAuth off (the oauth-apps answer is mocked)
// the OAuth-only apps are dimmed and say why; the skills download gives a ZIP; phone width has no horizontal scroll;
// what the card showed before (the MCP address, the old address, the connected apps) is still there (S-6).
// Run on the test server (:15174). Nothing is written.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const APPS = [
  'Claude Code · 플러그인(OAuth)', 'Claude Code · 플러그인(API 키)', 'claude.ai · 데스크톱 · 휴대폰', 'ChatGPT', 'Codex',
  'Gemini CLI', 'Antigravity CLI', 'API 키로 직접(Claude Code)', '그 밖의 에이전트(수동)',
]
const tile = (page: Page, name: string) => page.getByRole('button', { name: `${name} 연결 방법` })

test('nine apps; each dialog has this server\'s address, copy and the official help', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const url = `${new URL(baseURL!).origin}/mcp`
  await page.goto('/settings/ai')
  await expect(page.getByRole('heading', { name: /^앱 연결/ })).toBeVisible()
  for (const name of APPS) await expect(tile(page, name)).toBeVisible()

  for (const name of APPS) {
    await tile(page, name).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg.getByRole('heading', { name })).toBeVisible()
    // the address is in a code box of every app (as the value or inside a command)
    await expect(dlg.locator('code', { hasText: url }).first()).toBeVisible()
    const links = dlg.locator('.ca-help').getByRole('link')
    expect(await links.count()).toBeGreaterThan(0)
    for (const a of await links.all()) {
      expect(await a.getAttribute('href')).toMatch(/^https:\/\//)
      expect(await a.getAttribute('target')).toBe('_blank')
    }
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(tile(page, name)).toBeFocused()
  }

  // copy puts the code on the clipboard
  await tile(page, 'Claude Code · 플러그인(OAuth)').click()
  await page.getByRole('dialog').getByRole('button', { name: '복사' }).first().click()
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('복사했어요')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/plugin marketplace add bluenyang/allot')
})

test('with OAuth off, the OAuth-only apps are dimmed and say why; the others are not', async ({ page }) => {
  await page.route('**/api/oauth-apps', (r) => r.fulfill({ json: { enabled: false, apps: [] } }))
  await page.goto('/settings/ai')
  await expect(page.getByText('관리자가 외부 앱 연결(OAuth)을 켜야 해요', { exact: false }).first()).toBeVisible()
  for (const name of ['Claude Code · 플러그인(OAuth)', 'claude.ai · 데스크톱 · 휴대폰', 'ChatGPT']) {
    await expect(tile(page, name)).toHaveClass(/dim/)
    await expect(tile(page, name)).toContainText('외부 앱 연결이 꺼져 있어요')
  }
  for (const name of ['Claude Code · 플러그인(API 키)', 'Codex', 'API 키로 직접(Claude Code)']) await expect(tile(page, name)).not.toHaveClass(/dim/)
  // a dimmed app still opens, with the reason on top; an app that takes either marks its OAuth steps
  await tile(page, 'ChatGPT').click()
  await expect(page.getByRole('dialog').getByRole('note')).toContainText('관리자가 외부 앱 연결(OAuth)을 켜야 해요')
  await page.keyboard.press('Escape')
  await tile(page, 'Codex').click()
  // an app that also takes a key gets no note on top, only beside its OAuth steps (review rc.3-1 R1-1)
  await expect(page.getByRole('dialog').getByRole('note')).toHaveCount(0)
  await expect(page.getByRole('dialog').getByText('이 단계는 외부 앱 연결(OAuth)이 켜져 있어야 돼요', { exact: false }).first()).toBeVisible()
})

test('the skills download gives each skill as a ZIP', async ({ page }) => {
  await page.goto('/settings/ai')
  await tile(page, 'claude.ai · 데스크톱 · 휴대폰').click()
  const skills = page.getByRole('dialog').getByRole('region', { name: '스킬 받기' })
  await expect(skills.getByRole('link', { name: '받기' })).toHaveCount(7)
  await expect(skills).toContainText('급여 정산')
  const [download] = await Promise.all([page.waitForEvent('download'), skills.getByRole('listitem').filter({ hasText: '급여 정산' }).getByRole('link', { name: '받기' }).click()])
  expect(download.suggestedFilename()).toBe('allot-payday.zip')
  const head = readFileSync(await download.path()).subarray(0, 2).toString('latin1')
  expect(head).toBe('PK')
})

test('what the card showed before is still there (S-6)', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await page.goto('/settings/ai')
  await expect(page.getByText(`${origin}/mcp`, { exact: true })).toBeVisible()
  await expect(page.getByText(`${origin}/api/mcp`).first()).toBeVisible()
  await expect(page.getByText('연결된 앱', { exact: true })).toBeVisible()
  await expect(page.getByText('앱별 연결 방법은 위 \'앱 연결\'에 있어요.')).toBeVisible()
})

test('앱 연결 at phone width: one column, the dialog fits, no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/settings/ai')
  await expect(tile(page, 'Codex')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await tile(page, 'Codex').click()
  const box = await page.getByRole('dialog').boundingBox()
  expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
