// spec 010 V-10 (A-30): one pass of the redesigned flows in the English screen language.
// Subscriptions and proposals have English tests of their own (edit/subscriptions, proposals); this
// file covers 월급 분배, 일정, 변경 내역, 설정, 관리, 현황 and the shell. The shared account is put on
// English for the run through the API and back to what it was in afterAll; everything the tests make
// is deleted again (also when a test fails).
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test'
import { MARK, choose, optionTexts, sheet } from './helpers'

const M = `${MARK}-en`

type Prefs = Record<string, unknown> & { language: 'ko' | 'en' | null }
type Target = { id: string; name: string; kind: string }
type State = {
  preferences: Prefs
  settings: Record<string, unknown> & { subRound: number }
  targets: Target[]
  remainderSplit: { id: string }[]
  events: { id: string; when: string; title: string }[]
  checks: { id: string; text: string }[]
  holidaySets: { id: string; name: string; enabled: boolean }[]
  phases: { id: string; from: string }[]
}

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
const state = async (request: APIRequestContext) => (await api(request, 'GET', '/api/state')).json as State

let originalLanguage: Prefs['language'] | undefined

test.describe.configure({ mode: 'serial' })

test.beforeEach(async ({ request }) => {
  const prefs = (await state(request)).preferences
  if (originalLanguage === undefined) originalLanguage = prefs.language ?? null
  if (prefs.language !== 'en') expect((await api(request, 'PUT', '/api/preferences', { ...prefs, language: 'en' })).status).toBe(200)
})

test.afterAll(async ({ playwright, baseURL }) => {
  // back to the language the account had, so the specs after this one are Korean again
  const ctx = await playwright.request.newContext({ baseURL, storageState: 'tests/e2e/.auth.json' })
  try {
    const prefs = ((await (await ctx.get('/api/state')).json()) as State).preferences
    await ctx.put('/api/preferences', { data: { ...prefs, language: originalLanguage ?? null }, headers: { origin: baseURL! } })
    expect(((await (await ctx.get('/api/state')).json()) as State).preferences.language ?? null).toBe(originalLanguage ?? null)
  } finally {
    await ctx.dispose()
  }
})

const heading = (page: Page) => page.locator('header.ph h1')

/** Open a pay-split tab (the English tab names). */
async function payTab(page: Page, tab: 'Phases' | 'Monthly simulation' | 'Accounts, living costs, settings') {
  await page.goto('/pay')
  await page.getByRole('tablist').first().waitFor()
  await page.getByRole('tab', { name: tab }).click()
}

// ---------------------------------------------------------------- 월급 분배

test('pay split: automatic phase numbers, the rounding select with "Off", saved and read back', async ({ page, request }) => {
  const st = await state(request)
  const before = st.settings
  try {
    await payTab(page, 'Phases')
    const ordered = [...st.phases].sort((a, b) => (a.from < b.from ? -1 : 1))
    const cards = page.locator('.phase-card')
    await expect(cards).toHaveCount(ordered.length)
    for (const [i, p] of st.phases.entries()) await expect(cards.nth(i)).toContainText(`Phase ${ordered.findIndex((x) => x.id === p.id) + 1}`)

    await payTab(page, 'Accounts, living costs, settings')
    const form = page.getByRole('form', { name: 'Pay settings' })
    const round = form.getByLabel('Subscription transfer rounding unit')
    expect((await optionTexts(round)).at(-1)).toBe('Off')
    await choose(round, { label: '₩50,000' })
    await choose(round, { label: 'Off' })
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(form.getByRole('status')).toBeVisible()
    expect((await state(request)).settings.subRound).toBe(1)
    await page.reload()
    await payTab(page, 'Accounts, living costs, settings')
    await expect(round).toHaveText('Off')
  } finally {
    await api(request, 'PUT', '/api/settings', before)
  }
  expect((await state(request)).settings.subRound).toBe(before.subRound)
})

test('pay split: delete the remainder target, the leftover stays in the pay account, History reverts it (temporary account)', async ({ browser, request, baseURL }) => {
  test.setTimeout(180_000)
  // The owner's data is never written here: a temporary account holds the targets this test deletes.
  // Earlier specs sign in too: start with an empty login window (5 a minute).
  await new Promise((r) => setTimeout(r, 60_000))
  const email = `e2e-en-rem-${Date.now().toString(36)}@example.com`
  const pass = 'e2e-en-rem-pass-1'
  const created = await api(request, 'POST', '/api/auth/admin/create-user', { email, name: 'E2E en', password: pass })
  expect(created.status).toBe(200)
  const userId = (created.json as { user: { id: string } }).user.id
  let ctx: BrowserContext | undefined
  try {
  ctx = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] }, locale: 'ko-KR' })
  const c = ctx
  const mine = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) => {
    const r = await c.request.fetch(path, { method, data, headers: { origin: baseURL! } })
    return { status: r.status(), json: await r.json().catch(() => null) }
  }
    const page = await c.newPage()
    await page.goto('/')
    await page.getByLabel('이메일').fill(email)
    await page.getByLabel('비밀번호').fill(pass)
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await page.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })

    // seed what the test needs: English, a remainder target and one remainder-split row
    const prefs = ((await mine('GET', '/api/state')).json as State).preferences
    expect((await mine('PUT', '/api/preferences', { ...prefs, language: 'en' })).status).toBe(200)
    const remName = `${M}-rest`
    expect((await mine('POST', '/api/targets', { name: remName, kind: 'remainder', note: '' })).status).toBe(201)
    expect((await mine('POST', '/api/remainder-split', { name: `${M}-split`, code: 'R', ratio: 0.5 })).status).toBe(201)
    const seeded = (await mine('GET', '/api/state')).json as State
    expect(seeded.targets.some((x) => x.kind === 'remainder' && x.name === remName)).toBe(true)
    const splits = seeded.remainderSplit.length

    await page.goto('/pay')
    await page.reload()
    await page.getByRole('tablist').first().waitFor()
    await page.getByRole('tab', { name: 'Phases' }).click()
    await page.getByRole('row', { name: new RegExp(remName) }).first().click()
    const s = sheet(page, 'Edit split target')
    await s.getByRole('button', { name: 'Delete' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(s).toBeHidden()
    expect(((await mine('GET', '/api/state')).json as State).targets.some((x) => x.kind === 'remainder')).toBe(false)
    // the exact change set of the deletion
    const del = ((await mine('GET', '/api/changes?limit=1')).json as { id: string }[])[0]!

    await page.getByRole('tab', { name: 'Monthly simulation' }).click()
    await expect(page.getByRole('row', { name: /Stays in the pay account/ })).toBeVisible()
    await expect(page.getByText('There is no remainder target, so there is nothing to split')).toBeVisible()
    expect(((await mine('GET', '/api/state')).json as State).remainderSplit.length, 'the split items are kept').toBe(splits)

    // the way back is the History revert, through the modal
    await page.goto('/history')
    const first = page.getByRole('list', { name: 'Changes' }).locator('li:not(.day)').first()
    await expect(first).toContainText(remName)
    await first.getByRole('button', { name: 'Revert', exact: true }).click()
    const ask = sheet(page, 'Revert this change?')
    await expect(ask).toContainText('is restored to how it was before it was deleted')
    await ask.getByRole('button', { name: 'Revert', exact: true }).click()
    await expect(ask).toBeHidden()
    await expect.poll(async () => ((await mine('GET', '/api/state')).json as State).targets.some((x) => x.kind === 'remainder' && x.name === remName)).toBe(true)
    // that revert reverted the deletion set, and nothing else
    const sets = (await mine('GET', '/api/changes?limit=5')).json as { id: string; revertOf?: string | null }[]
    expect(sets.some((x) => x.id === del.id)).toBe(true)
    await page.goto('/pay')
    await page.reload()
    await page.getByRole('tablist').first().waitFor()
    await page.getByRole('tab', { name: 'Phases' }).click()
    await expect(page.getByRole('row', { name: new RegExp(remName) }).first()).toBeVisible()
  } finally {
    try {
      await ctx?.close()
    } catch { /* the account is deleted below whatever the context did */ }
    const del = await api(request, 'DELETE', `/api/admin/users/${userId}`, { confirmEmail: email })
    expect(del.status, 'the temporary account is deleted').toBeLessThan(300)
    const left = (await api(request, 'GET', '/api/auth/admin/list-users?limit=500')).json.users as { email: string }[]
    expect(left.some((x) => x.email === email), 'the temporary account is gone').toBe(false)
  }
})

// ---------------------------------------------------------------- 일정

test('schedule: add events with a month range, picked and typed; the phone month strip moves the agenda', async ({ page, request }) => {
  const cleanUp = async () => {
    for (const e of (await state(request)).events.filter((x) => x.title.startsWith(M))) await api(request, 'DELETE', `/api/events/${e.id}`)
  }
  try {
    await page.goto('/events')
    await page.getByRole('tablist').first().waitFor()
    await page.getByRole('tab', { name: 'Timeline' }).click()
    const open = () => page.getByRole('button', { name: 'Add event', exact: true }).click()

    // the picker: a start and an end month
    await open()
    let s = sheet(page, 'Add event')
    await s.getByLabel('Details').fill(`${M}-picked`)
    await s.getByRole('button', { name: 'Range', exact: true }).click()
    await s.getByLabel('From month').fill('2031-01')
    await s.getByLabel('To month').fill('2031-02')
    await s.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(s).toBeHidden()

    // direct entry
    await open()
    s = sheet(page, 'Add event')
    await s.getByLabel('Details').fill(`${M}-typed`)
    await s.getByRole('button', { name: 'Type it', exact: true }).click()
    await s.getByLabel('When, typed').fill('2031-05~07')
    await s.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(s).toBeHidden()

    // a range into another year: coming soon until rc.1, stored in the long form since spec 013 S-18
    await open()
    s = sheet(page, 'Add event')
    await s.getByLabel('Details').fill(`${M}-x`)
    await s.getByRole('button', { name: 'Range', exact: true }).click()
    await s.getByLabel('From month').fill('2031-12')
    await s.getByLabel('To month').fill('2032-02')
    await s.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(s).toBeHidden()

    const events = (await state(request)).events
    expect(events.find((e) => e.title === `${M}-picked`)?.when).toBe('2031-01~02')
    expect(events.find((e) => e.title === `${M}-typed`)?.when).toBe('2031-05~07')
    expect(events.find((e) => e.title === `${M}-x`)?.when).toBe('2031-12~2032-02')
    await page.getByRole('button', { name: `Edit ${M}-picked` }).click()
    s = sheet(page, 'Edit event')
    await expect(s.getByLabel('From month')).toHaveValue('2031-01')
    await expect(s.getByLabel('To month')).toHaveValue('2031-02')
    await page.keyboard.press('Escape')

    // phone: the month strip moves the agenda, no grid, no Today button
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.goto('/events')
    await page.reload()
    const bar = page.getByRole('group', { name: 'Choose month' })
    await bar.waitFor()
    await expect(page.getByRole('region', { name: 'This month schedule calendar' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toHaveCount(0)
    const title = bar.locator('b')
    const t0 = await title.innerText()
    await bar.getByRole('button', { name: 'Next month' }).click()
    expect(await title.innerText()).not.toBe(t0)
    await expect(page.locator('.agenda h2')).toContainText(/ schedule$/)
    await bar.getByRole('button', { name: 'Previous month' }).click()
    await expect(title).toHaveText(t0)
    await expect(bar).toContainText(/Today/)
  } finally {
    await cleanUp()
  }
  expect((await state(request)).events.some((e) => e.title.startsWith(M))).toBe(false)
})

// ---------------------------------------------------------------- 변경 내역

test('history: day groups, the actor and item filters, the revert modal and its result', async ({ page, request }) => {
  const text = `${M}-hist`
  const made = ((await api(request, 'POST', '/api/checks', { text, done: false })).json as { id: string })
  try {
    await page.goto('/history')
    await expect(page.getByRole('heading', { name: 'Change history', exact: true })).toBeVisible()
    const list = page.getByRole('list', { name: 'Changes' })
    const row = list.getByRole('listitem').filter({ hasText: text })
    await expect(row).toBeVisible()
    await expect(list.locator('li.day').first()).toContainText(/\d/)
    // who: mine, not the AI keys'
    const seg = page.getByRole('group', { name: 'Filter by who changed it' })
    await seg.getByRole('button', { name: /^AI keys/ }).click()
    await expect(row).toHaveCount(0)
    await seg.getByRole('button', { name: /^Me/ }).click()
    await expect(row).toBeVisible()
    await seg.getByRole('button', { name: /^All/ }).click()
    // item type
    const kind = page.getByLabel('Item type')
    await choose(kind, { label: 'Checklist item' })
    await expect(row).toBeVisible()
    await choose(kind, { label: 'Subscription' })
    await expect(row).toHaveCount(0)
    expect(await optionTexts(kind)).toContain('Remainder target')
    await choose(kind, { label: 'All items' })

    // the revert modal says what happens; the result is a set of its own
    await row.getByRole('button', { name: 'Revert', exact: true }).click()
    const ask = sheet(page, 'Revert this change?')
    await expect(ask).toContainText('is removed, back to before it was added')
    await ask.getByRole('button', { name: 'Revert', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: /Reverted/ })).toBeVisible()
    await expect(list.locator('li:not(.day)').first()).toContainText('Revert')
    await expect.poll(async () => (await state(request)).checks.some((c) => c.text === text)).toBe(false)
  } finally {
    await api(request, 'DELETE', `/api/checks/${made.id}`)
  }
})

// ---------------------------------------------------------------- 설정

test('settings: the display format saves at once; a holiday set is added, switched off and removed', async ({ page, request }) => {
  const s0 = await state(request)
  let setId: string | undefined
  try {
    await page.goto('/settings/general')
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
    // the format saves the moment a choice is made: no save button
    const saved = page.waitForResponse((r) => r.url().endsWith('/api/preferences') && r.request().method() === 'PUT' && r.ok())
    await page.getByRole('group', { name: 'Date format' }).getByRole('button', { name: '2026. 11. 14.' }).click()
    await saved
    await expect(page.getByRole('status').filter({ hasText: 'Saved right away.' })).toBeVisible()
    expect((await state(request)).preferences.dateFormat).toBe('dot')

    // holiday sets card
    await page.getByRole('button', { name: '+ Add set' }).click()
    const s = page.getByRole('form', { name: 'Add holiday set' })
    await s.getByLabel('Set name').fill(`${M}-set`)
    await s.getByRole('button', { name: 'Next' }).click()
    await s.getByLabel('Name', { exact: true }).fill('Founding day')
    await choose(s.getByLabel('Type'), 'dates')
    await s.getByLabel(/^Dates/).fill('2031-03-01')
    await s.getByRole('button', { name: 'Save' }).click()
    await expect(s).toBeHidden()
    const made = (await state(request)).holidaySets.find((h) => h.name === `${M}-set`)
    expect(made, 'the set is stored').toBeTruthy()
    setId = made!.id
    const sw = page.getByRole('switch', { name: `Turn on ${M}-set` })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect.poll(async () => (await state(request)).holidaySets.find((h) => h.id === setId)?.enabled).toBe(false)
  } finally {
    for (const h of (await state(request)).holidaySets.filter((x) => x.name.startsWith(M))) {
      expect((await api(request, 'DELETE', `/api/holiday-sets/${h.id}`)).status, `delete set ${h.name}`).toBeLessThan(300)
    }
    await api(request, 'PUT', '/api/preferences', { ...s0.preferences, language: 'en' })
    expect((await state(request)).holidaySets.some((h) => h.name.startsWith(M)), 'no marked holiday set remains').toBe(false)
  }
})

test('settings: an AI key is made, shown once, and revoked', async ({ page, request }) => {
  const keys = async () => ((await (await request.get('/api/keys')).json()) as { keys: { id: string; name: string }[] }).keys
  try {
    await page.goto('/settings/ai')
    await expect(page.getByRole('tab', { name: 'AI & integrations' })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: '+ Create key' }).click()
    const s = sheet(page, 'New API key')
    await s.getByLabel('Name', { exact: false }).first().fill(`${M}-key`)
    await s.getByRole('button', { name: 'Create key', exact: true }).click()
    await expect(s).toBeHidden()
    const box = page.getByLabel('API key', { exact: true })
    await expect(box).toBeVisible()
    expect(await box.inputValue()).toMatch(/^allot_[A-Za-z]{64}$/)
    await expect(page.getByText('You can see this only now')).toBeVisible()
    const row = page.getByRole('row', { name: new RegExp(`${M}-key`) })
    await expect(row).toContainText('Read')
    await expect(row).toContainText('Never used')
    expect((await keys()).some((k) => k.name === `${M}-key`)).toBe(true)

    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(box).toHaveCount(0)
    await page.getByRole('button', { name: `Manage key ${M}-key` }).click()
    const manage = page.locator('[role="dialog"]')
    await manage.getByRole('button', { name: `Revoke key ${M}-key` }).click()
    await expect(manage.getByText('This cannot be undone').first()).toBeVisible()
    await manage.getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Revoked the key' })).toBeVisible()
    await expect(page.getByRole('row', { name: new RegExp(`${M}-key`) })).toHaveCount(0)
    expect((await keys()).some((k) => k.name === `${M}-key`)).toBe(false)
  } finally {
    for (const k of (await keys()).filter((x) => x.name.startsWith(M))) await request.delete(`/api/keys/${k.id}`)
  }
})

// ---------------------------------------------------------------- 관리

test('admin: the account list, and an account is created without a password (external login only) and deleted', async ({ page, request }) => {
  const email = `e2e-en-${Date.now().toString(36)}@example.com`
  const find = async () => ((await api(request, 'GET', '/api/auth/admin/list-users?limit=500')).json.users as { id: string; email: string }[]).find((x) => x.email === email)
  try {
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Admin', exact: true })).toBeVisible()
    await expect(page.getByText('(you)').first()).toBeVisible()
    await page.getByRole('button', { name: 'Create account' }).click()
    const s = page.getByRole('form', { name: 'New account' })
    await s.getByLabel('Email').fill(email)
    await s.getByLabel('Name', { exact: true }).fill('E2E')
    await expect(s.getByText('It is created without a password.')).toBeVisible()
    await s.getByRole('button', { name: 'Set one' }).click()
    await expect(s.getByLabel('Temporary password')).toHaveValue('')
    await s.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('status')).toContainText('Account created')
    expect(await find(), 'the account exists').toBeTruthy()
    await expect(page.getByRole('row', { name: new RegExp(email) })).toBeVisible()

    await page.getByRole('button', { name: `Manage ${email}` }).click()
    const edit = page.getByRole('form', { name: email })
    await edit.getByRole('button', { name: 'Delete', exact: true }).click()
    await edit.getByLabel(/Delete permanently/).fill(email)
    await edit.getByRole('button', { name: 'Delete account and data permanently' }).click()
    await expect(page.getByRole('status')).toContainText('Deleted the account')
    await expect(page.getByRole('row', { name: new RegExp(email) })).toHaveCount(0)
    expect(await find()).toBeUndefined()
  } finally {
    const u = await find()
    if (u) await api(request, 'DELETE', `/api/admin/users/${u.id}`, { confirmEmail: email })
  }
})

// ---------------------------------------------------------------- 현황

test('overview: the record modal adds a schedule with a month range and a to-check item', async ({ page, request }) => {
  const cleanUp = async () => {
    const st = await state(request)
    for (const e of st.events.filter((x) => x.title.startsWith(M))) await api(request, 'DELETE', `/api/events/${e.id}`)
    for (const c of st.checks.filter((x) => x.text.startsWith(M))) await api(request, 'DELETE', `/api/checks/${c.id}`)
  }
  try {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add record', exact: true }).click()
    const s = sheet(page, 'Add record')
    await s.getByRole('radio', { name: /^Schedule/ }).click()
    await s.getByLabel('Title').fill(`${M}-ev`)
    await s.getByLabel('Date or month').fill('2031-01~02')
    await s.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(s).toBeHidden()
    expect((await state(request)).events.find((e) => e.title === `${M}-ev`)?.when).toBe('2031-01~02')

    // a pattern the server refuses shows why and stores nothing
    await page.getByRole('button', { name: 'Add record', exact: true }).click()
    await s.getByRole('radio', { name: /^Schedule/ }).click()
    await s.getByLabel('Title').fill(`${M}-bad`)
    await s.getByLabel('Date or month').fill('soon')
    await s.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(s.getByRole('alert')).toBeVisible()
    await s.getByRole('radio', { name: /^To check/ }).click()
    await s.getByLabel('Details').fill(`${M}-todo`)
    await s.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(s).toBeHidden()
    const st = await state(request)
    expect(st.checks.some((c) => c.text === `${M}-todo`)).toBe(true)
    expect(st.events.some((e) => e.title === `${M}-bad`)).toBe(false)
  } finally {
    await cleanUp()
  }
  const st = await state(request)
  expect(st.events.some((e) => e.title.startsWith(M)) || st.checks.some((c) => c.text.startsWith(M))).toBe(false)
})

// ---------------------------------------------------------------- the shell

test.describe('shell', () => {
  test('desktop: sidebar groups, the unfinished entries are visible, disabled and say "Coming soon"', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const side = page.locator('aside.side')
    await expect(side.locator('.glabel')).toHaveText(['Overview', 'Budget', 'Manage', 'AI'])
    await expect(side.getByRole('link')).toContainText(['Overview', 'Pay split', 'Living', 'Spending', 'Savings', 'Investing', 'Schedule', 'Pending changes', 'Change history', 'Settings'])
    const calls: string[] = []
    page.on('request', (req) => { if (req.url().includes('/api/')) calls.push(req.url()) })
    const before = page.url()
    for (const name of ['Statement analysis', 'AI assistant']) { // Living, Savings and Investing open in spec 013 S-1
      const item = side.getByRole('button', { name: new RegExp(name) })
      await expect(item, name).toHaveAttribute('aria-disabled', 'true')
      await expect(item.locator('.soon-pill'), name).toHaveText('Coming soon')
      await item.click({ force: true })
    }
    expect(page.url(), 'no navigation').toBe(before)
    expect(calls, 'no request').toEqual([])
  })

  test.describe('phone', () => {
    test.use({ viewport: { width: 390, height: 844 } })
    test('the bottom bar and the "More" sheet reach the pages', async ({ page }) => {
      await page.goto('/')
      await heading(page).waitFor()
      const bar = page.getByRole('navigation', { name: 'Menu' }).last()
      for (const [label, title] of [['Budget', 'Pay split'], ['Schedule', 'Schedule'], ['Overview', /overview$/]] as const) {
        await bar.getByRole('link', { name: label }).click()
        await expect(heading(page)).toHaveText(title)
      }
      const more = page.getByRole('dialog', { name: 'More' })
      for (const [label, title] of [['Spending', 'Spending'], ['Change history', 'Change history'], ['Settings', 'Settings']] as const) {
        await bar.getByRole('button', { name: 'More' }).click()
        await more.getByRole('link', { name: label }).click()
        await expect(heading(page)).toHaveText(title)
        await expect(more).toBeHidden()
      }
    })
  })
})
