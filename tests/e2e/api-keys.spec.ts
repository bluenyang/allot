// spec 008 W-5 / V-2 (screen), V-3 (screen): 설정 › AI·연동 makes, lists and revokes API keys, and
// 관리 › API 키 switches the "no expiry" policy. Run on the dev stack; it leaves no key behind and
// puts the policy back. When ALLOT_API_KEY_NO_EXPIRY locks the policy the switch tests are skipped.
import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK, saveSheet, sheet } from './helpers'

const NAME = `${MARK}-key`

async function policy(request: APIRequestContext) {
  const r = await request.get('/api/admin/api-keys')
  return (await r.json()) as { noExpiry: boolean; source: string; locked: boolean }
}

/** Revoke every key this run made (whatever the test got to). */
async function cleanUp(request: APIRequestContext) {
  const list = (await (await request.get('/api/keys')).json()) as { keys: { id: string; name: string }[] }
  for (const k of list.keys.filter((x) => x.name.startsWith(MARK))) await request.delete(`/api/keys/${k.id}`)
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
  await page.goto('/#settings/ai')
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
  await s.getByLabel('만료').selectOption('30')
  await saveSheet(page, '새 API 키')

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

  // revoke
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `${NAME} 키 폐기` }).click()
  await expect(page.getByRole('status').filter({ hasText: '폐기했어요' })).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(NAME) })).toHaveCount(0)
  expect((await mcp(baseURL!, key)).status).toBe(401)
  expect(await (await request.get('/api/keys')).text()).not.toContain(key)
})

test('keys: a name is required and at most 32 characters', async ({ page }) => {
  await openAi(page)
  await page.getByRole('button', { name: '+ 키 만들기' }).click()
  const s = sheet(page, '새 API 키')
  await s.getByRole('button', { name: '저장' }).click()
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
    await expect(sheet(page, '새 API 키').getByLabel('만료').locator('option')).toHaveText(['30일 뒤', '90일 뒤', '180일 뒤', '365일 뒤'])
    await sheet(page, '새 API 키').getByRole('button', { name: '취소' }).click()

    // on: the option is there; make a key without an expiry
    await page.goto('/#admin')
    await page.getByRole('tab', { name: 'API 키' }).click()
    const sw = page.getByLabel('만료 없는 키 허용')
    await expect(sw).not.toBeChecked()
    await sw.check()
    await expect(page.getByRole('status').filter({ hasText: '허용해요' })).toBeVisible()
    await openAi(page)
    await page.getByRole('button', { name: '+ 키 만들기' }).click()
    const s = sheet(page, '새 API 키')
    await s.getByLabel('이름').fill(`${NAME}-forever`)
    await s.getByLabel('만료').selectOption('none')
    await saveSheet(page, '새 API 키')
    const row = page.getByRole('row', { name: new RegExp(`${NAME}-forever`) })
    await expect(row).toContainText('없음')

    // off again from the admin screen: the key now expires in a year
    await page.goto('/#admin')
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
