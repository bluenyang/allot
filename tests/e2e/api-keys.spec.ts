// spec 008 W-5 / V-2 (screen), V-3 (screen): 설정 › AI·연동 makes, lists and revokes API keys, and
// 관리 › API 키 switches the "no expiry" policy. Run on the dev stack; it leaves no key behind and
// puts the policy back. When ALLOT_API_KEY_NO_EXPIRY locks the policy the switch tests are skipped.
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK, saveSheet, sheet } from './helpers'
import { makeKey, propose } from './proposal-helpers'

const NAME = `${MARK}-key`

async function policy(request: APIRequestContext) {
  const r = await request.get('/api/admin/api-keys')
  return (await r.json()) as { noExpiry: boolean; source: string; locked: boolean }
}

/** Reject every proposal and revoke every key this run made (whatever the test got to), and check each call. */
async function cleanUp(request: APIRequestContext) {
  const props = (await (await request.get('/api/proposals?status=pending')).json()) as { id: string; keyName: string }[]
  for (const p of props.filter((x) => x.keyName.startsWith(MARK))) expect((await request.post(`/api/proposals/${p.id}/reject`)).ok()).toBe(true)
  const list = (await (await request.get('/api/keys')).json()) as { keys: { id: string; name: string }[] }
  for (const k of list.keys.filter((x) => x.name.startsWith(MARK))) expect((await request.delete(`/api/keys/${k.id}`)).ok()).toBe(true)
}

/** An MCP call with a key and no session. */
async function mcp(baseURL: string, key: string) {
  const ctx = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  try {
    const r = await ctx.post('/api/mcp', {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream' },
      data: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    })
    return { status: r.status(), body: await r.text() }
  } finally {
    await ctx.dispose()
  }
}

async function openAi(page: Page) {
  await page.goto('/settings/ai')
  await expect(page.getByRole('heading', { name: 'API 키', exact: true })).toBeVisible()
}

test.afterEach(async ({ request }) => {
  await cleanUp(request)
})

test('keys: make one, see it once, use it, see when it was used, revoke it', async ({ page, request, baseURL }) => {
  await openAi(page)
  await expect(page.getByRole('tab', { name: 'AI·연동' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('button', { name: '+ 키 만들기' }).click()
  const s = sheet(page, '새 API 키')
  await s.getByLabel('이름').fill(NAME)
  await s.getByRole('group', { name: '만료' }).getByRole('button', { name: '30일' }).click()
  await saveSheet(page, '새 API 키', '키 만들기')

  // the key is on screen once, in the box
  const box = page.getByLabel('API 키', { exact: true })
  await expect(box).toBeVisible()
  const key = await box.inputValue()
  expect(key).toMatch(/^allot_[A-Za-z]{64}$/)
  await expect(page.getByText('다시 볼 수 없으니')).toBeVisible()
  const row = page.getByRole('row', { name: new RegExp(NAME) })
  await expect(row).toContainText(`${key.slice(0, 12)}…`)
  await expect(row).toContainText('읽기')
  await expect(row).toContainText('아직 안 씀')
  expect(await row.textContent()).not.toContain(key)

  // it works for MCP, and only there
  expect((await mcp(baseURL!, key)).status).toBe(200)
  const other = await playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  expect((await other.get('/api/state', { headers: { authorization: `Bearer ${key}` } })).status()).toBe(401)
  await other.dispose()

  // closing the box forgets the key; so does a reload
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(box).toHaveCount(0)
  expect(await page.content()).not.toContain(key)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'API 키', exact: true })).toBeVisible()
  expect(await page.content()).not.toContain(key)
  await expect(page.getByRole('row', { name: new RegExp(NAME) })).not.toContainText('아직 안 씀')

  // how to connect
  await expect(page.getByText(`${new URL(baseURL!).origin}/api/mcp`).first()).toBeVisible()
  await expect(page.getByText('claude mcp add --transport http allot')).toBeVisible()
  await expect(page.getByText('0.1.10')).toBeVisible()

  // manage: the key's facts, then revoke in the dialog's own confirm step (no browser dialog)
  await page.getByRole('button', { name: `${NAME} 키 관리` }).click()
  const manage = page.locator('[role="dialog"]') // its title changes in the confirm step
  await expect(manage.getByText(`${key.slice(0, 12)}…`)).toBeVisible()
  await manage.getByRole('button', { name: `${NAME} 키 폐기` }).click()
  await expect(manage.getByText('되돌릴 수 없어요').first()).toBeVisible()
  await manage.getByRole('button', { name: '폐기', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '폐기했어요' })).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(NAME) })).toHaveCount(0)
  expect((await mcp(baseURL!, key)).status).toBe(401)
  expect(await (await request.get('/api/keys')).text()).not.toContain(key)
})

test('keys: a name is required and at most 32 characters', async ({ page }) => {
  await openAi(page)
  await page.getByRole('button', { name: '+ 키 만들기' }).click()
  const s = sheet(page, '새 API 키')
  await s.getByRole('button', { name: '키 만들기' }).click()
  await expect(s.getByRole('alert')).toContainText('이름')
  await s.getByLabel('이름').fill('x'.repeat(40))
  expect(await s.getByLabel('이름').inputValue()).toHaveLength(32) // maxlength
  await s.getByRole('button', { name: '취소' }).click()
  await expect(s).toBeHidden()
})

test('policy: "만료 없음" is offered only while the server allows it; switching it off caps the key', async ({ page, request }) => {
  const before = await policy(request)
  test.skip(before.locked, 'ALLOT_API_KEY_NO_EXPIRY locks the switch')
  try {
    // off: no such option
    expect((await request.put('/api/admin/api-keys', { data: { noExpiry: false } })).status()).toBe(200)
    await openAi(page)
    await page.getByRole('button', { name: '+ 키 만들기' }).click()
    await expect(sheet(page, '새 API 키').getByRole('group', { name: '만료' }).getByRole('button')).toHaveText(['30일', '90일', '180일', '365일'])
    await expect(sheet(page, '새 API 키').getByText('이 서버는 만료 없는 키를 허용하지 않아요')).toBeVisible()
    await sheet(page, '새 API 키').getByRole('button', { name: '취소' }).click()

    // on: the option is there; make a key without an expiry
    await page.goto('/admin')
    await page.getByRole('tab', { name: 'API 키' }).click()
    const sw = page.getByLabel('만료 없는 키 허용')
    await expect(sw).not.toBeChecked()
    await sw.check()
    await expect(page.getByRole('status').filter({ hasText: '허용해요' })).toBeVisible()
    await openAi(page)
    await page.getByRole('button', { name: '+ 키 만들기' }).click()
    const s = sheet(page, '새 API 키')
    await s.getByLabel('이름').fill(`${NAME}-forever`)
    await s.getByRole('group', { name: '만료' }).getByRole('button', { name: '만료 없음' }).click()
    await expect(s.getByText('이 서버는 만료 없는 키를 허용하지 않아요')).toHaveCount(0)
    await saveSheet(page, '새 API 키', '키 만들기')
    const row = page.getByRole('row', { name: new RegExp(`${NAME}-forever`) })
    await expect(row).toContainText('없음')

    // off again from the admin screen: the key now expires in a year
    await page.goto('/admin')
    await page.getByRole('tab', { name: 'API 키' }).click()
    page.once('dialog', (d) => d.accept())
    await page.getByLabel('만료 없는 키 허용').uncheck()
    await expect(page.getByRole('status').filter({ hasText: '만료 없던 키' })).toBeVisible()
    await openAi(page)
    const after = page.getByRole('row', { name: new RegExp(`${NAME}-forever`) })
    const year = new Date(Date.now() + 365 * 86_400_000).toLocaleDateString('ko-KR', { dateStyle: 'medium' })
    await expect(after).toContainText(year)
  } finally {
    await request.put('/api/admin/api-keys', { data: { noExpiry: before.noExpiry } })
  }
})

test('policy: when env sets it, the switch is locked and says so', async ({ page, request }) => {
  const p = await policy(request)
  test.skip(!p.locked, 'ALLOT_API_KEY_NO_EXPIRY is not set (this check runs with it set)')
  await page.goto('/admin')
  await page.getByRole('tab', { name: 'API 키' }).click()
  const sw = page.getByLabel('만료 없는 키 허용')
  await expect(sw).toBeDisabled()
  if (p.noExpiry) await expect(sw).toBeChecked()
  else await expect(sw).not.toBeChecked()
  await expect(page.getByText('env(')).toContainText('ALLOT_API_KEY_NO_EXPIRY')
  expect((await request.put('/api/admin/api-keys', { data: { noExpiry: !p.noExpiry } })).status()).toBe(409)
})

test('keys: a write key chooses its confirmation method when it is made (spec 009)', async ({ page, request }) => {
  await openAi(page)
  await page.getByRole('button', { name: '+ 키 만들기' }).click()
  const s = sheet(page, '새 API 키')
  await s.getByLabel('이름', { exact: false }).first().fill(`${NAME}-w`)
  await expect(s.getByRole('radio', { name: /읽기 전용/ })).toBeChecked()
  // no confirmation method for a read key
  await expect(s.getByRole('radio', { name: '대화 안에서 확인' })).toHaveCount(0)
  await s.getByRole('radio', { name: /쓰기 제안 허용/ }).click()
  await expect(s.getByRole('radio', { name: 'Allot 화면에서 확인' })).toBeChecked()
  await expect(s.getByText('가장 안전해요')).toBeVisible()
  await s.getByRole('radio', { name: '대화 안에서 확인' }).check()
  await saveSheet(page, '새 API 키', '키 만들기')
  await expect(page.getByRole('row', { name: new RegExp(`${NAME}-w`) })).toContainText('읽기·쓰기 · 대화에서 확인')
  const made = ((await (await request.get('/api/keys')).json()) as { keys: { name: string; confirm: string | null }[] }).keys.find((k) => k.name === `${NAME}-w`)
  expect(made?.confirm).toBe('chat')
})

test('keys: the list says how many write proposals each key made; what cannot change yet is 준비 중 (S-3, S-11)', async ({ page, request, baseURL }) => {
  // the page-wide summary counts every proposal ever made on this account: read it first, expect one more
  await openAi(page)
  const summary = page.locator('.sum').filter({ hasText: '쓰기 제안' })
  const before = Number((await summary.locator('b.num').innerText()).replace(/\D/g, ''))
  const key = await makeKey(request, 'ui', `${NAME}-n`)
  await propose(baseURL!, key) // one proposal; it changes nothing until it is decided, and the count is all time
  await page.reload() // the same hash: only a reload reads the new key
  await expect(page.getByRole('heading', { name: 'API 키', exact: true })).toBeVisible()
  await page.getByRole('button', { name: `${NAME}-n 키 관리` }).click()
  const manage = sheet(page, `${NAME}-n 키`)
  await expect(manage.getByText('1건')).toBeVisible()
  await expect(summary.locator('b.num')).toHaveText(String(before + 1))
  // 이름 바꾸기, 범위 바꾸기, 만료 연장, 사용 기록: shown, inert, no request
  await page.waitForLoadState('networkidle') // the proposal count may still be paging
  const calls: string[] = []
  page.on('request', (r) => { if (r.url().includes('/api/')) calls.push(r.url()) })
  for (const n of ['이름 바꾸기', '범위 바꾸기', '만료 연장', '사용 기록 보기']) {
    const el = manage.getByRole('button', { name: `${n} (준비 중)` })
    await expect(el).toHaveAttribute('aria-disabled', 'true')
    await el.click({ force: true })
  }
  expect(calls).toEqual([])
  await manage.getByRole('button', { name: '닫기', exact: true }).last().click()
  await expect(manage).toBeHidden()
  const rejects = (await (await request.get('/api/proposals?status=pending')).json()) as { id: string; keyName: string }[]
  for (const x of rejects.filter((y) => y.keyName === `${NAME}-n`)) await request.post(`/api/proposals/${x.id}/reject`)
})

test('keys: an answer that comes after the screen was left does not bring the key text back (A-21)', async ({ page }) => {
  await openAi(page)
  await page.getByRole('button', { name: '+ 키 만들기' }).click()
  const s = sheet(page, '새 API 키')
  await s.getByLabel('이름').first().fill(`${NAME}-late`)
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let sent!: () => void
  const wasSent = new Promise<void>((r) => { sent = r })
  await page.route('**/api/keys', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const res = await route.fetch()
    sent()
    await gate
    await route.fulfill({ response: res })
  })
  await s.getByRole('button', { name: '키 만들기', exact: true }).click()
  await wasSent
  await page.goto('/') // leave the screen (it is kept alive)
  await page.locator('header.ph h1').waitFor()
  release()
  await page.waitForTimeout(1500)
  await page.goto('/settings/ai')
  await expect(page.getByRole('heading', { name: 'API 키', exact: true })).toBeVisible()
  await expect(page.getByLabel('API 키', { exact: true })).toHaveCount(0)
  expect(await page.content()).not.toMatch(/allot_[A-Za-z]{64}/)
})

test('keys: made and revoked while the proposal count is still loading, the list is read again; the first visit reads it once (A-22)', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  await page.route(/\/api\/proposals/, async (route) => { await gate; await route.continue() }) // the count never finishes until released
  const listCalls: string[] = []
  page.on('request', (r) => { if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/keys') listCalls.push(r.url()) })
  await openAi(page)
  await expect(page.getByText(/활성 \d+/).first()).toBeVisible()
  await page.waitForTimeout(500)
  expect(listCalls.length, 'one list request on the first visit').toBe(1)
  await page.getByRole('button', { name: '+ 키 만들기' }).click()
  const s = sheet(page, '새 API 키')
  await s.getByLabel('이름').first().fill(`${NAME}-hold`)
  await saveSheet(page, '새 API 키', '키 만들기')
  await expect(page.getByRole('row', { name: new RegExp(`${NAME}-hold`) })).toBeVisible() // fresh list while counting
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByRole('button', { name: `${NAME}-hold 키 관리` }).click()
  const manage = page.locator('[role="dialog"]')
  await manage.getByRole('button', { name: `${NAME}-hold 키 폐기` }).click()
  await manage.getByRole('button', { name: '폐기', exact: true }).click()
  await expect(page.getByRole('row', { name: new RegExp(`${NAME}-hold`) })).toHaveCount(0)
  release()
})
