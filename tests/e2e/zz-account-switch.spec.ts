// spec 010 A-10, A-12, A-14: what one account decided on the proposal screens, and what a request still on its
// way brings back, is not shown to the next account that signs in on the same tab. The first account's answer
// is fetched while it is signed in, held until the next account's screen has loaded, then delivered; nothing
// of it (its state, its toast) may show. Once for apply, once for undo. Runs late (alphabetical) with its own
// pacing: it signs in four times, and the login limit is 5 a minute (nothing after it signs in, zz-i18n-signout
// uses the shared session).
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { MARK } from './helpers'
import { KEY_NAME, SUB, makeKey, propose } from './proposal-helpers'

test.afterEach(async ({ request }) => {
  const props = (await (await request.get('/api/proposals?status=pending')).json()) as { id: string; keyName: string }[]
  for (const p of props.filter((x) => x.keyName.startsWith(MARK))) await request.post(`/api/proposals/${p.id}/reject`)
  const keys = (await (await request.get('/api/keys')).json()) as { keys: { id: string; name: string }[] }
  for (const k of keys.keys.filter((x) => x.name.startsWith(MARK))) await request.delete(`/api/keys/${k.id}`)
  const st = (await (await request.get('/api/state')).json()) as { subscriptions: { id: string; name: string }[]; checks: { id: string; text: string }[] }
  for (const x of st.subscriptions.filter((x) => x.name.startsWith(MARK))) await request.delete(`/api/subscriptions/${x.id}`)
  for (const x of st.checks.filter((x) => x.text.startsWith(MARK))) await request.delete(`/api/checks/${x.id}`)
})

/** Hold the next /api/state answer: fetched now (while the page's account is signed in), delivered when `release()` is called. */
function holdState(ctx: BrowserContext) {
  let seen!: () => void
  let release!: () => void
  let finished!: () => void
  const intercepted = new Promise<void>((r) => { seen = r })
  const gate = new Promise<void>((r) => { release = r })
  const done = new Promise<void>((r) => { finished = r })
  let armed = true
  void ctx.route('**/api/state', async (route) => {
    if (!armed) return route.continue()
    armed = false
    const res = await route.fetch()
    seen()
    await gate
    await route.fulfill({ response: res })
    finished()
  })
  return { intercepted, release: () => release(), done }
}

test('pending: nothing of the first account reaches the next one signed in on the same tab (A-10, A-14)', async ({ browser, request, baseURL }) => {
  test.setTimeout(420_000)
  // the specs before this one sign in too: start with an empty login window (5 a minute)
  await new Promise((r) => setTimeout(r, 60_000))
  const email = `e2e-prop-${Date.now().toString(36)}@example.com`
  const pass = 'e2e-prop-pass-1'
  const created = await request.fetch('/api/auth/admin/create-user', { method: 'POST', data: { email, name: 'E2E prop', password: pass }, headers: { origin: baseURL! } })
  expect(created.status()).toBe(200)
  const aState = (await (await request.get('/api/state')).json()) as { subscriptions: { name: string }[] }
  const aOwn = aState.subscriptions[0]?.name

  const login = async (page: Page, e: string, p: string, ready: () => Promise<void>) => {
    await page.getByLabel('이메일').fill(e)
    await page.getByLabel('비밀번호').fill(p)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await ready()
  }

  for (const round of ['apply', 'undo'] as const) {
    if (round === 'undo') await new Promise((r) => setTimeout(r, 60_000)) // an empty login window again
    const key = await makeKey(request, 'ui', `${KEY_NAME}-${round}`)
    const made = await propose(baseURL!, key)
    const ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, locale: 'ko-KR' })
    try {
      const page = await ctx.newPage()
      await page.goto('/')
      await login(page, process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!, () => page.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 }))
      await page.goto('/#pending')
      const card = page.locator(`[data-proposal="${made.proposalId as string}"]`)
      let hold: ReturnType<typeof holdState>
      if (round === 'apply') {
        hold = holdState(ctx)
        await card.getByRole('button', { name: '확인하고 적용', exact: true }).click()
        await expect(card.locator('.pill', { hasText: '적용됨' })).toBeVisible()
      } else {
        await card.getByRole('button', { name: '확인하고 적용', exact: true }).click()
        await expect(card.getByRole('button', { name: '되돌리기' })).toBeVisible()
        await expect(page.getByRole('status').filter({ hasText: '제안을 적용했어요' })).toBeVisible()
        hold = holdState(ctx)
        await card.getByRole('button', { name: '되돌리기' }).click()
        await expect(card.locator('.pill', { hasText: '되돌림' })).toBeVisible()
      }
      await hold.intercepted // the first account's state answer is in hand and held back
      // sign out and sign in as another account, with no page reload in between
      await page.getByRole('button', { name: '로그아웃' }).first().click()
      await page.getByLabel('이메일').waitFor()
      // still on the 대기 중인 변경 route: the next account sees that page, not the previous one's cards
      await login(page, email, pass, () => expect(page.getByRole('heading', { name: '대기 중인 변경', exact: true })).toBeVisible({ timeout: 15_000 }))
      await expect(page.getByText('확인할 제안이 없어요')).toBeVisible()
      await expect(page.locator('[data-proposal]')).toHaveCount(0)
      // only now is the held answer delivered
      hold.release()
      await hold.done
      await page.waitForTimeout(1000)
      const toast = page.getByRole('status').filter({ hasText: /제안을 (적용|되돌렸)/ })
      await expect(toast).toHaveCount(0)
      await page.goto('/#subs')
      await expect(page.getByRole('heading', { name: '구독', exact: true })).toBeVisible()
      await expect(page.getByText(SUB)).toHaveCount(0)
      if (aOwn) await expect(page.getByText(aOwn, { exact: true })).toHaveCount(0)
      await page.goto('/#pending')
      await page.getByRole('button', { name: '처리함', exact: true }).click()
      await expect(page.locator('[data-proposal]')).toHaveCount(0)
    } finally {
      await ctx.close()
    }
  }
  const users = (await (await request.fetch('/api/auth/admin/list-users?limit=500', { headers: { origin: baseURL! } })).json()).users as { id: string; email: string }[]
  const u = users.find((x) => x.email === email)
  if (u) await request.fetch(`/api/admin/users/${u.id}`, { method: 'DELETE', data: { confirmEmail: email }, headers: { origin: baseURL! } })
})
