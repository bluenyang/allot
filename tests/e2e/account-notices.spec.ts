// spec 016 V-6: the bell's marks follow the account (two browser contexts of the same account), this browser's old
// marks go up once, and the 로그인·보안 tab's add-password form (its server answers are mocked here: the test account has a
// password, and an account without one needs an external sign-in this server does not have; tests/api/notice-marks.mjs
// checks the real route). Run on the test server (:15174). The marks this run adds are dropped again at the end.
import { expect, test, type Browser, type Page } from '@playwright/test'
import { MARK } from './helpers'

const marks = async (page: Page) => (await (await page.request.get('/api/notices/marks')).json()) as { read: string[]; maturityKept: string[] }
let added: string[] = []
test.afterEach(async ({ request }) => {
  if (added.length) await request.post('/api/notices/marks', { data: { read: { drop: added } } })
  added = []
})

test('a notice read in one browser is read in another', async ({ page, browser, request }) => {
  // a subscription charged tomorrow makes sure the bell has a notice (removed at the end)
  const d = new Date(Date.now() + 86_400_000)
  const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const sub = await (await request.post('/api/subscriptions', {
    data: { name: `${MARK}-bell`, category: 'tool', plan: 'p', amount: 1000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: tomorrow, path: 'direct', verified: false },
  })).json() as { id: string }
  try {
    await readInOneSeenInAnother(page, browser)
  } finally {
    await request.delete(`/api/subscriptions/${sub.id}`)
  }
})

async function readInOneSeenInAnother(page: Page, browser: Browser) {
  await page.goto('/')
  const bell = page.getByRole('button', { name: /^알림 · 읽지 않음 \d+건$/ })
  await expect(bell).toBeVisible()
  const label = (await bell.getAttribute('aria-label')) ?? ''
  const unread = Number(/(\d+)건/.exec(label)?.[1] ?? 0)
  expect(unread).toBeGreaterThan(0)
  const before = await marks(page)
  await bell.click()
  await page.getByRole('button', { name: '모두 읽음' }).click()
  await expect(page.getByRole('button', { name: '알림 · 읽지 않음 0건' })).toBeVisible()
  // the screen shows them at once; the save goes after the read the bell started when it opened (review rc.2-1 R1-1, R1-2)
  await expect.poll(async () => {
    added = (await marks(page)).read.filter((id) => !before.read.includes(id))
    return added.length
  }, { timeout: 15_000 }).toBeGreaterThan(0)

  // the same account in another browser context (its own storage): the marks come from the account
  const other = await browser.newContext({ storageState: 'tests/e2e/.auth.json', locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  const p2 = await other.newPage()
  try {
    await p2.goto('/')
    await expect(p2.getByRole('button', { name: '알림 · 읽지 않음 0건' })).toBeVisible()
    expect(await p2.evaluate(() => localStorage.getItem('allot.notices.read'))).toBeNull()
  } finally {
    await other.close()
  }
}

test("this browser's old read marks go to the account once, then leave the browser", async ({ browser, page }) => {
  const mark = `e2e-old-${Date.now()}`
  const ctx = await browser.newContext({ storageState: 'tests/e2e/.auth.json', locale: 'ko-KR', timezoneId: 'Asia/Seoul' })
  await ctx.addInitScript((m) => {
    if (!sessionStorage.getItem('e2e-seeded')) {
      localStorage.setItem('allot.notices.read', JSON.stringify([m]))
      localStorage.setItem('allot.maturityKept', JSON.stringify([`${m}@2026-01`]))
      sessionStorage.setItem('e2e-seeded', '1')
    }
  }, mark)
  const p = await ctx.newPage()
  try {
    await p.goto('/')
    // the read marks and the kept maturities go up in two requests, one after the other
    await expect.poll(async () => { const m = await marks(p); return m.read.includes(mark) && m.maturityKept.includes(`${mark}@2026-01`) }, { timeout: 15_000 }).toBe(true)
    await expect.poll(() => p.evaluate(() => [localStorage.getItem('allot.notices.read'), localStorage.getItem('allot.maturityKept')])).toEqual([null, null])
    added = [mark]
  } finally {
    await ctx.close()
  }
  // the kept-maturity mark stays (there is no route to drop one); it names no real account, so it never hides a card
  expect((await marks(page)).maturityKept).toContain(`${mark}@2026-01`)
})

test('로그인·보안: an account without a password gets the add form; a stale session is asked to sign in again', async ({ page }) => {
  // the test account has a password: answer list-accounts as for an account that signs in with GitHub only
  await page.route('**/api/auth/list-accounts', (r) => r.fulfill({ json: [{ id: 'gh1', providerId: 'github', accountId: '1', createdAt: '2026-11-01T00:00:00.000Z' }] }))
  let answer: { status: number; json: unknown } = { status: 403, json: { error: '보안을 위해 다시 로그인한 뒤 비밀번호를 만들 수 있어요(로그인한 지 하루가 지났어요).', code: 'REAUTH' } }
  const sent: unknown[] = []
  await page.route('**/api/account/password', (r) => { sent.push(r.request().postDataJSON()); return r.fulfill({ status: answer.status, json: answer.json }) })
  await page.goto('/settings/security')
  const form = page.getByRole('form', { name: '비밀번호 추가' })
  await expect(form).toBeVisible()
  await expect(form).toContainText('이메일')
  await expect(page.getByRole('form', { name: '비밀번호 바꾸기' })).toHaveCount(0)

  await form.getByLabel('새 비밀번호', { exact: true }).fill('short')
  await form.getByLabel('새 비밀번호 확인').fill('short')
  await form.getByRole('button', { name: '추가' }).click()
  // below the minimum the field itself refuses (minlength): nothing is sent
  expect(await form.getByLabel('새 비밀번호', { exact: true }).evaluate((e) => (e as HTMLInputElement).validity.tooShort)).toBe(true)
  expect(sent).toHaveLength(0)

  await form.getByRole('button', { name: '만들기' }).click()
  await form.getByRole('button', { name: '추가' }).click()
  await expect(page.getByRole('alert')).toContainText('다시 로그인')
  await expect(form.getByRole('button', { name: '로그아웃하고 다시 로그인' })).toBeVisible()
  expect((sent[0] as { newPassword: string }).newPassword.length).toBeGreaterThanOrEqual(8)

  answer = { status: 200, json: { ok: true } }
  await form.getByRole('button', { name: '만들기' }).click()
  await form.getByRole('button', { name: '추가' }).click()
  await expect(page.getByRole('status')).toContainText('비밀번호를 추가했어요')
})

test('로그인·보안 at phone width: no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/auth/list-accounts', (r) => r.fulfill({ json: [{ id: 'gh1', providerId: 'github', accountId: '1', createdAt: '2026-11-01T00:00:00.000Z' }] }))
  await page.goto('/settings/security')
  await expect(page.getByRole('form', { name: '비밀번호 추가' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
