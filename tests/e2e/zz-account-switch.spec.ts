// spec 010 A-10: what one account decided on the proposal screens is not shown to the next account that signs in on
// the same tab. Runs late (alphabetical) with its own pacing: it signs in twice, and the login limit is 5 a minute.
import { expect, test } from '@playwright/test'
import { MARK } from './helpers'
import { KEY_NAME, makeKey, propose } from './proposal-helpers'

test.afterEach(async ({ request }) => {
  const props = (await (await request.get('/api/proposals?status=pending')).json()) as { id: string; keyName: string }[]
  for (const p of props.filter((x) => x.keyName.startsWith(MARK))) await request.post(`/api/proposals/${p.id}/reject`)
  const keys = (await (await request.get('/api/keys')).json()) as { keys: { id: string; name: string }[] }
  for (const k of keys.keys.filter((x) => x.name.startsWith(MARK))) await request.delete(`/api/keys/${k.id}`)
})

test('pending: a decided proposal of one account is not shown to the next account signed in on the same tab (A-10)', async ({ browser, request, baseURL }) => {
  test.setTimeout(120_000)
  const key = await makeKey(request, 'ui')
  const made = await propose(baseURL!, key)
  const email = `e2e-prop-${Date.now().toString(36)}@example.com`
  const pass = 'e2e-prop-pass-1'
  const created = await request.fetch('/api/auth/admin/create-user', { method: 'POST', data: { email, name: 'E2E prop', password: pass }, headers: { origin: baseURL! } })
  expect(created.status()).toBe(200)
  const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, locale: 'ko-KR' })
  try {
    const page = await ctx.newPage()
    const login = async (e: string, p: string) => {
      await page.goto('/')
      await page.getByLabel('이메일').fill(e)
      await page.getByLabel('비밀번호').fill(p)
      await page.getByRole('button', { name: '로그인', exact: true }).click()
      await page.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })
    }
    await login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!)
    await page.goto('/#pending')
    const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
    await card.getByRole('button', { name: '거절', exact: true }).click()
    await expect(card.locator('.pill', { hasText: '거절됨' })).toBeVisible()
    // sign out and sign in as another account, with no page reload in between
    await page.getByRole('button', { name: '로그아웃' }).first().click()
    await page.getByLabel('이메일').waitFor()
    await page.getByLabel('이메일').fill(email)
    await page.getByLabel('비밀번호').fill(pass)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    // still on the 대기 중인 변경 route: the next account sees that page, not the previous one's cards
    await expect(page.getByRole('heading', { name: '대기 중인 변경', exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('확인할 제안이 없어요')).toBeVisible()
    await expect(page.locator('[data-proposal]')).toHaveCount(0)
    await page.getByRole('button', { name: '처리함', exact: true }).click()
    await expect(page.locator('[data-proposal]')).toHaveCount(0)
    await expect(page.getByText(`${MARK} note`)).toHaveCount(0)
  } finally {
    await ctx.close()
    // two sign-ins of its own: let the login rate window (5/min) pass before the next spec signs in (zz-i18n-signout)
    await new Promise((r) => setTimeout(r, 65_000))
    const users = (await (await request.fetch('/api/auth/admin/list-users?limit=500', { headers: { origin: baseURL! } })).json()).users as { id: string; email: string }[]
    const u = users.find((x) => x.email === email)
    if (u) await request.fetch(`/api/admin/users/${u.id}`, { method: 'DELETE', data: { confirmEmail: email }, headers: { origin: baseURL! } })
  }
})

