// spec 013 rev 1 W-17 (0.1.7-rc.2): this month only (V-14), the second tabs and the maturity card (V-15), the overview
// links and the CSV files (V-16), events across years, the old `when` forms, subscription 기타 and the history period
// (V-17), and search, notifications and the API docs (V-18). Every row made here carries the run mark and is removed
// by id in `finally`; what the tests change in rows they did not make (settings) is put back. Values that depend on
// today are worked out from today in Korea.
import { readFileSync } from 'node:fs'
import { expect, request as pwRequest, test, type APIRequestContext, type Download, type Page } from '@playwright/test'
import { MARK as RUN, choose, fillDate, menu, saveSheet, sheet } from './helpers'

const MARK = `${RUN}-r2`

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
type Row = Record<string, unknown> & { id: string; name: string }
type Phase = { id: string; label: string; name: string; from: string; to: string | null; amounts: Record<string, number>; note?: string }
type Item = Row & { amount: number; from: string | null; amounts: Record<string, number> }
type Target = Row & { kind: string; accountId?: string | null }
type Adjust = { id: string; ym: string; targetId: string; amount: number; reason?: string | null }
type Settings = Record<string, unknown> & { savingSplit?: string; investSplit?: string }
type Account = Row & { group?: string | null; stopFrom?: string | null; afterMaturity?: string; term?: string }
type Event = { id: string; when: string; title: string; kind: string; state: string }
type Sub = Row & { category: string; nextDate: string }
type State = {
  settings: Settings; livingItems: Item[]; phases: Phase[]; targets: Target[]; monthAdjusts: Adjust[]; accounts: Account[]
  events: Event[]; subscriptions: Sub[]; spendings: Row[]; checks: { id: string; text: string }[]
}
const state = async (request: APIRequestContext) => (await api(request, 'GET', '/api/state')).json as State

const won = (n: number) => `₩${n.toLocaleString('en-US')}`
const digits = (s: string) => {
  const n = Number(s.replace(/[^\d]/g, ''))
  return /[−-]/.test(s) ? -n : n
}
const kst = () => new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' })
const thisYm = () => kst().slice(0, 7)
const todayKst = () => kst().slice(0, 10)
const dayAdd = (ymd: string, n: number) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + n)).toISOString().slice(0, 10)
const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7)
const ymDiff = (a: string, b: string) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7))
const ymLabel = (ym: string) => `${ym.slice(0, 4)}.${ym.slice(5, 7)}`
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const phaseAt = (phases: Phase[], ym: string) => phases.find((p) => p.from <= ym && (p.to === null || p.to >= ym)) ?? null
const itemIn = (it: Item, phases: Phase[], ym: string) => {
  if (it.from && ym < it.from) return 0
  const p = phaseAt(phases, ym)
  return p && it.amounts[p.id] !== undefined ? it.amounts[p.id]! : it.amount
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }) })

// ---------- 월급 분배: the month table ----------
async function simAt(page: Page, ym: string) {
  await menu(page, '월급 분배')
  await page.getByRole('tab', { name: '월별 시뮬레이션' }).click()
  const title = page.getByRole('heading', { level: 2, name: /이체$/ })
  await expect(title).toBeVisible()
  const shown = async () => (await title.innerText()).replace(/^(\d{4})\.(\d{2}).*$/s, '$1-$2')
  for (let i = 0; i < 40 && (await shown()) !== ym; i++) {
    await page.getByRole('button', { name: ymDiff(await shown(), ym) > 0 ? '다음 달' : '이전 달' }).click()
  }
  await expect(title).toHaveText(`${ym.slice(0, 4)}.${ym.slice(5, 7)} 이체`)
}
const simRow = (page: Page, name: string) => page.locator('tbody tr').filter({ has: page.locator('td .tname b', { hasText: new RegExp(`^${esc(name)}$`) }) })
/** A row's amount; an adjusted row also shows the value it replaces, struck through, which is not counted here. */
async function simValue(page: Page, name: string) {
  const row = simRow(page, name)
  await expect(row).toHaveCount(1)
  const cell = row.locator('td.amt')
  const orig = (await cell.locator('s.orig').count()) ? await cell.locator('s.orig').innerText() : ''
  return digits((await cell.innerText()).replace(orig, ''))
}
async function simValueOr0(page: Page, name: string) {
  return (await simRow(page, name).count()) === 0 ? 0 : simValue(page, name)
}

/** The saving total target of the test account: made for the test (one per user) when there is none. */
async function savingTarget(request: APIRequestContext, st: State) {
  const had = st.targets.find((x) => x.kind === 'saving')
  if (had) return { id: had.id, name: had.name, made: false }
  const name = `${MARK}-svt`
  const r = await api(request, 'POST', '/api/targets', { name, kind: 'saving', accountId: null })
  expect(r.status).toBe(201)
  return { id: (r.json as Row).id, name, made: true }
}
const account = (name: string, over: Record<string, unknown>) => ({ name, role: '', inflow: '', outflow: '', group: 'saving', amount: 0, from: null, ...over })

// ---------- V-14 이번 달만 조정 ----------
test('(V-14, S-14) 월급 분배 조정: this month only changes that month\'s fixed amount and remainder, the next month stays; the row shows the old value and the reason; 조정 되돌리기 takes it back', async ({ page, request }) => {
  const st = await state(request)
  const ym = thisYm()
  const next = ymAdd(ym, 1)
  const phase = phaseAt(st.phases, ym)
  expect(phase, 'a phase covers this month (seed)').toBeTruthy()
  expect(phaseAt(st.phases, next)?.id, 'the same phase covers next month (seed: open-ended)').toBe(phase!.id)
  const fixed = st.targets.find((x) => x.kind === 'fixed' && phase!.amounts[x.id] !== undefined)!
  expect(fixed, 'a fixed target with an amount this month (seed)').toBeTruthy()
  const rem = st.targets.find((x) => x.kind === 'remainder')!
  expect(rem, 'a remainder target (seed)').toBeTruthy()
  expect(st.monthAdjusts.filter((a) => a.targetId === fixed.id && a.ym === ym), 'no adjustment yet').toHaveLength(0)
  const reason = `${MARK} reason`
  const mine = async () => (await state(request)).monthAdjusts.filter((a) => a.targetId === fixed.id && (a.ym === ym || a.ym === next))
  try {
    await page.goto('/')
    await simAt(page, next)
    const fN = await simValue(page, fixed.name)
    const rN = await simValue(page, rem.name)
    await simAt(page, ym)
    const f0 = await simValue(page, fixed.name)
    const r0 = await simValue(page, rem.name)
    expect(f0, 'the phase amount').toBe(phase!.amounts[fixed.id])

    await page.getByRole('button', { name: `${fixed.name} 조정` }).click()
    const title = `금액 조정 · ${fixed.name}`
    const s = sheet(page, title)
    expect(digits(await s.locator('#ad-amount').inputValue()), 'the dialog starts on the computed value').toBe(f0)
    await expect(s.getByRole('button', { name: '이번 달만', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(s.getByRole('button', { name: '이 구간 끝까지', exact: true })).toBeVisible()
    await s.getByRole('button', { name: '+5만', exact: true }).click()
    expect(digits(await s.locator('#ad-amount').inputValue()), '+5만').toBe(f0 + 50_000)
    await s.getByRole('button', { name: '+ 이유 추가' }).click()
    await s.locator('#ad-reason').fill(reason)
    const pv = s.getByTestId('adjust-preview').locator('.pl').first()
    await expect(pv.locator('s')).toHaveText(`${r0.toLocaleString('en-US')}원`)
    await expect(pv.locator('b')).toHaveText(`${(r0 - 50_000).toLocaleString('en-US')}원`)
    await saveSheet(page, title, '적용')

    const [a] = await mine()
    expect(a, 'one month adjustment').toMatchObject({ ym, targetId: fixed.id, amount: f0 + 50_000, reason })
    expect(await mine()).toHaveLength(1)
    expect((await state(request)).phases.find((p) => p.id === phase!.id)?.amounts[fixed.id], 'the phase amount is unchanged').toBe(phase!.amounts[fixed.id])
    const row = simRow(page, fixed.name)
    await expect(row.locator('s.orig')).toHaveText(won(f0))
    await expect(row).toContainText('조정됨 · 이번 달만')
    await expect(row).toContainText(reason)
    expect(await simValue(page, fixed.name)).toBe(f0 + 50_000)
    expect(await simValue(page, rem.name), 'this month\'s remainder is down by the change').toBe(r0 - 50_000)
    await simAt(page, next)
    expect(await simValue(page, fixed.name), 'next month: the phase amount').toBe(fN)
    expect(await simValue(page, rem.name), 'next month: the remainder as before').toBe(rN)
    await expect(simRow(page, fixed.name)).not.toContainText('조정됨')

    // 조정 되돌리기: the month's adjustment is deleted
    await simAt(page, ym)
    await page.getByRole('button', { name: `${fixed.name} 조정` }).click()
    await expect(s).toContainText(`${ymLabel(ym)}은 ${(f0 + 50_000).toLocaleString('en-US')}원로 조정되어 있어요`)
    await s.getByRole('button', { name: '조정 되돌리기' }).click()
    await expect(s).toBeHidden()
    await expect.poll(async () => (await mine()).length).toBe(0)
    expect(await simValue(page, fixed.name)).toBe(f0)
    expect(await simValue(page, rem.name)).toBe(r0)
    await expect(simRow(page, fixed.name)).not.toContainText('조정됨')
  } finally {
    for (const x of await mine()) await api(request, 'DELETE', `/api/month-adjusts/${x.id}`)
    expect(await mine()).toHaveLength(0)
  }
})

test('(V-14, S-14) 저축 총액 수정: 구간 끝까지 in the ratio split still writes the phase amount (the old value); 이번 달만 in the amount split writes this month only', async ({ page, request }) => {
  const st0 = await state(request)
  const ym = thisYm()
  const next = ymAdd(ym, 1)
  const phase0 = phaseAt(st0.phases, ym)
  expect(phase0, 'a phase covers this month (seed)').toBeTruthy()
  const made: string[] = []
  let tg = { id: '', name: '', made: false }
  const adjusts = async () => (await state(request)).monthAdjusts.filter((a) => a.targetId === tg.id)
  try {
    tg = await savingTarget(request, st0)
    const it = await api(request, 'POST', '/api/accounts', account(`${MARK}-tot`, { amount: 100_000, ratio: 0.5, from: null }))
    expect(it.status).toBe(201)
    made.push((it.json as Row).id)

    // the ratio split: 총액 수정 starts on the phase scope and writes the phase amount, as rc.1 did
    expect((await api(request, 'PUT', '/api/settings', { ...st0.settings, savingSplit: 'ratio' })).status).toBe(200)
    await page.goto('/saving')
    await expect(page.locator('header.ph h1')).toHaveText('저축')
    await page.getByRole('button', { name: '저축 총액 수정' }).click()
    const tot = sheet(page, '저축 총액 수정')
    await expect(tot.getByRole('button', { name: /^구간 \d+ 끝까지$/ })).toHaveAttribute('aria-pressed', 'true')
    await tot.locator('#ad-amount').fill('600000')
    await expect(tot.getByTestId('adjust-preview')).toContainText(`${MARK}-tot · 50%300,000원`)
    await saveSheet(page, '저축 총액 수정')
    const ph1 = (await state(request)).phases.find((p) => p.id === phase0!.id)!
    expect(ph1.amounts[tg.id], '구간 끝까지 writes the phase amount').toBe(600_000)
    expect(await adjusts(), 'and no month adjustment').toHaveLength(0)
    await expect(page.getByTestId(`item-${made[0]}`)).toContainText('= ₩300,000 / 월')
    // the simulation's 조정 on the ratio-split total starts on the month's total, not the items' sum (review rc2-1 F-1)
    await simAt(page, ym)
    expect(await simValue(page, tg.name)).toBe(300_000)
    await page.getByRole('button', { name: `${tg.name} 조정` }).click()
    const adj = sheet(page, `금액 조정 · ${tg.name}`)
    expect(digits(await adj.locator('#ad-amount').inputValue()), 'the dialog starts on the month\'s total').toBe(600_000)
    await adj.getByRole('button', { name: '취소', exact: true }).click()
    await expect(adj).toBeHidden()
    await menu(page, '저축')

    // the amount split: only 이번 달만; the value is this month's alone
    expect((await api(request, 'PUT', '/api/settings', { ...st0.settings, savingSplit: 'amount' })).status).toBe(200)
    await page.reload()
    await expect(page.locator('header.ph h1')).toHaveText('저축')
    await page.getByRole('button', { name: '저축 총액 수정' }).click()
    await expect(tot.getByRole('button', { name: '이번 달만', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(tot.getByRole('button', { name: /끝까지$/ })).toHaveCount(0)
    await expect(tot).toContainText('금액으로 나누는 중이라 구간 금액이 없어요. 이번 달만 바꿀 수 있어요.')
    await tot.locator('#ad-amount').fill('250000')
    await saveSheet(page, '저축 총액 수정')
    const [a] = await adjusts()
    expect(a).toMatchObject({ ym, targetId: tg.id, amount: 250_000 })
    await expect(page.getByText('이번 달만 조정 · 원래 ₩100,000')).toBeVisible()
    // the total line: an amount split's adjustment is spread over the items (review rc2-2 F-2, rc2-3 F-2)
    await expect(page.getByText('이번 달만 ₩250,000로 조정했어요 · 항목에 금액 비례로 나눠요')).toBeVisible()
    await simAt(page, ym)
    expect(await simValue(page, tg.name), 'this month: the adjusted total').toBe(250_000)
    await expect(simRow(page, tg.name)).toContainText('조정됨 · 이번 달만')
    await simAt(page, next)
    expect(await simValueOr0(page, tg.name), 'next month: the items\' sum').toBe(100_000)
  } finally {
    for (const x of await adjusts()) await api(request, 'DELETE', `/api/month-adjusts/${x.id}`)
    for (const id of made) await api(request, 'DELETE', `/api/accounts/${id}`)
    const p = (await state(request)).phases.find((x) => x.id === phase0!.id)
    if (p) await api(request, 'PUT', `/api/phases/${p.id}`, { label: phase0!.label, name: phase0!.name, from: phase0!.from, to: phase0!.to, amounts: phase0!.amounts, note: phase0!.note ?? '' })
    if (tg.made) await api(request, 'DELETE', `/api/targets/${tg.id}`)
    await api(request, 'PUT', '/api/settings', st0.settings)
    const after = await state(request)
    expect(after.accounts.filter((x) => made.includes(x.id))).toHaveLength(0)
    expect(after.monthAdjusts.filter((x) => x.targetId === tg.id)).toHaveLength(0)
    expect(after.phases.find((x) => x.id === phase0!.id)?.amounts).toEqual(phase0!.amounts)
    if (tg.made) expect(after.targets.some((x) => x.id === tg.id)).toBe(false)
  }
})

// ---------- V-15 만기 일정 · 만기 카드 · 월별 기록 ----------
test('(V-15, S-15) 만기 일정: rows by maturity month with 받을 돈 and 만기 후; an unreadable term is named; the maturity card on 대기 중인 변경 → 멈추기', async ({ page, request }) => {
  const st0 = await state(request)
  const ym = thisYm()
  const made: string[] = []
  let tg = { id: '', name: '', made: false }
  const n6 = `${MARK}-m6`
  const nu = `${MARK}-mu`
  const nx = `${MARK}-mx`
  try {
    if (st0.settings.savingSplit !== 'amount') expect((await api(request, 'PUT', '/api/settings', { ...st0.settings, savingSplit: 'amount' })).status).toBe(200)
    tg = await savingTarget(request, st0)
    const until = ymAdd(ym, 3)
    for (const body of [
      account(n6, { amount: 100_000, from: ymAdd(ym, -6), term: '6개월' }),
      account(nu, { amount: 50_000, from: ymAdd(ym, -1), term: `${until}까지`, afterMaturity: 'E2E 생활비 통장으로' }),
      account(nx, { amount: 10_000, from: ym, term: '자유 적립' }),
    ]) {
      const r = await api(request, 'POST', '/api/accounts', body)
      expect(r.status, body.name as string).toBe(201)
      made.push((r.json as Row).id)
    }
    const [id6, idu] = made

    await page.goto('/saving')
    await expect(page.locator('header.ph h1')).toHaveText('저축')
    await page.getByRole('tab', { name: '만기 일정' }).click()
    const tbl = page.getByTestId('maturity-table')
    const rows = tbl.locator('tbody tr')
    const ids = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid))
    expect(ids.indexOf(`maturity-${id6}`), 'sorted by maturity month').toBeLessThan(ids.indexOf(`maturity-${idu}`))
    expect(ids).not.toContain(`maturity-${made[2]}`)
    const r6 = page.getByTestId(`maturity-${id6}`)
    await expect(r6).toContainText(ymLabel(ym))
    await expect(r6).toContainText('이번 달')
    await expect(r6).toContainText(won(600_000))
    await expect(r6).toContainText('6개월 동안 분배가 보내는 돈 · 이자 제외')
    await expect(r6).toContainText('아직 안 정함')
    const ru = page.getByTestId(`maturity-${idu}`)
    await expect(ru).toContainText(ymLabel(until))
    await expect(ru).toContainText(won(200_000))
    await expect(ru).toContainText('4개월 동안 분배가 보내는 돈 · 이자 제외')
    await expect(ru).toContainText('E2E 생활비 통장으로')
    await expect(tbl.locator('.foot')).toContainText(nx)

    // a balance record: 받을 돈 is the projection
    const b = await api(request, 'POST', '/api/balances', { accountId: idu, date: `${ym}-01`, amount: 500_000, note: MARK })
    expect(b.status).toBe(201)
    await page.reload()
    await page.getByRole('tab', { name: '만기 일정' }).click()
    await expect(ru).toContainText('잔액 기록 기준 예상 · 이자 제외')

    // 정해 두기 opens the item editor on step 2; 만기 후 is saved
    await r6.getByRole('button', { name: `${n6} 만기 후 수정` }).click()
    const e = sheet(page, `저축 상품 수정 · ${n6}`)
    await e.locator('#bi-after').fill('E2E 다음 적금으로')
    await saveSheet(page, `저축 상품 수정 · ${n6}`)
    expect((await state(request)).accounts.find((x) => x.id === id6)?.afterMaturity).toBe('E2E 다음 적금으로')
    await expect(r6).toContainText('E2E 다음 적금으로')

    // the maturity card: only for the one due this month
    await menu(page, '대기 중인 변경')
    const card = page.getByRole('article', { name: `만기 · ${n6}` })
    await expect(card).toContainText(`${n6} · `)
    await expect(card).toContainText('만기예요. 이 통장으로 보내기를 멈출까요?')
    await expect(page.getByRole('article', { name: `만기 · ${nu}` })).toHaveCount(0)
    await expect(card.locator('tbody tr').nth(0).locator('td.to')).toHaveText('₩0')
    await card.getByRole('button', { name: '멈추기', exact: true }).click()
    await expect(card).toHaveCount(0)
    const stop = (await state(request)).accounts.find((x) => x.id === id6)?.stopFrom
    expect(stop, '멈추기 writes the stop month').toBeTruthy()
    expect(ymDiff(ym, stop!)).toBeGreaterThanOrEqual(0)
    expect(ymDiff(ym, stop!)).toBeLessThanOrEqual(1)
    await menu(page, '저축')
    await page.getByRole('tab', { name: '만기 일정' }).click()
    await expect(r6).toContainText('멈춤')
  } finally {
    for (const id of made) await api(request, 'DELETE', `/api/accounts/${id}`)
    if (tg.made) await api(request, 'DELETE', `/api/targets/${tg.id}`)
    await api(request, 'PUT', '/api/settings', st0.settings)
    const after = await state(request)
    expect(after.accounts.filter((x) => made.includes(x.id))).toHaveLength(0)
    if (tg.made) expect(after.targets.some((x) => x.id === tg.id)).toBe(false)
  }
})

test('(V-15, S-15) 월별 기록: Living and Investment list this month and the six before, newest first, with the planned amount and "—" for what is not known yet', async ({ page, request }) => {
  const st = await state(request)
  const ym = thisYm()
  const sum = st.livingItems.reduce((a, x) => a + itemIn(x, st.phases, ym), 0)
  await page.goto('/living')
  await expect(page.locator('header.ph h1')).toHaveText('생활')
  await page.getByRole('tab', { name: '월별 기록' }).click()
  const h = page.getByTestId('budget-history')
  await expect(h).toContainText('월별 예산과 실제 사용')
  const rows = h.locator('tbody tr')
  await expect(rows).toHaveCount(7)
  await expect(rows.nth(0)).toContainText(`${ymLabel(ym)}이번 달`)
  await expect(rows.nth(0).locator('td.amt')).toHaveText(won(sum))
  for (let i = 0; i < 7; i++) await expect(rows.nth(i).locator('td').first()).toContainText(ymLabel(ymAdd(ym, -i)))
  await expect(rows.nth(0).locator('td').nth(2)).toHaveText('—')
  await expect(rows.nth(0).locator('td').nth(3)).toHaveText('—')
  // the list tab is still there
  await page.getByRole('tab', { name: '항목' }).click()
  await expect(page.locator('.tot b.num')).toHaveText(won(sum))

  await menu(page, '투자')
  await page.getByRole('tab', { name: '월별 기록' }).click()
  await expect(h).toContainText('월별 이체 기록')
  await expect(h.locator('tbody tr')).toHaveCount(7)
  await expect(h.locator('thead')).toContainText('보낸 금액')
  if (!st.targets.some((x) => x.kind === 'invest')) await expect(h).toContainText('월급 분배에 투자 합계 대상이 없어 항목 합을 보여요.')
})

// ---------- V-16 현황 링크 · CSV ----------
/** A download's bytes: the UTF-8 BOM, then CRLF records. */
async function csvOf(d: Download) {
  const buf = readFileSync((await d.path())!)
  expect([...buf.subarray(0, 3)], 'the UTF-8 BOM').toEqual([0xef, 0xbb, 0xbf])
  const text = buf.subarray(3).toString('utf8')
  expect(text.endsWith('\r\n'), 'CRLF records').toBe(true)
  return text.slice(0, -2).split('\r\n')
}

test('(V-16, S-16) 현황: 결제 추가 opens the spending add editor; the remainder\'s 관리 opens the pay split on 월별 시뮬레이션', async ({ page, request }) => {
  const st = await state(request)
  const rem = st.targets.find((x) => x.kind === 'remainder')!
  expect(rem, 'a remainder target (seed)').toBeTruthy()
  await page.goto('/')
  await page.getByRole('link', { name: '+ 결제 추가' }).click()
  await expect(page).toHaveURL(/\/spend\/general$/)
  await expect(sheet(page, '지출 추가')).toBeVisible()
  await sheet(page, '지출 추가').getByRole('button', { name: '취소', exact: true }).click()
  await expect(sheet(page, '지출 추가')).toBeHidden()
  await menu(page, '현황')
  await page.getByRole('link', { name: `${rem.name}에서 관리 →` }).click()
  await expect(page).toHaveURL(/\/pay\?tab=sim$/)
  await expect(page.getByRole('tab', { name: '월별 시뮬레이션' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { level: 2, name: /이체$/ })).toBeVisible()
})

test('(V-16, S-17) CSV: the overview month, the 지출 일반 tab and the subscription list download with the BOM, the header row and a known row', async ({ page, request }) => {
  const st = await state(request)
  const ym = thisYm()
  const today = todayKst()
  const phase = phaseAt(st.phases, ym)!
  const fixed = st.targets.find((x) => x.kind === 'fixed' && phase.amounts[x.id] !== undefined)!
  expect(fixed, 'a fixed target with an amount this month (seed)').toBeTruthy()
  const sname = `${MARK}-csv`
  const spending = {
    name: sname, note: '', category: '가전', bought: today, amount: 123_450, currency: 'KRW', fxRate: null, fxBuffer: null,
    how: 'lump', payBy: 'salary', count: 1, fee: 0, interval: null, cancelled: false,
    rounds: [{ no: 1, date: today, amount: 123_450, state: 'left', edited: false }],
  }
  const sub = { name: sname, category: 'tool', plan: 'E2E plan', amount: 4_500, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: dayAdd(today, 20), path: 'direct', verified: false }
  const made: [string, string][] = []
  try {
    const sp = await api(request, 'POST', '/api/spendings', spending)
    expect(sp.status).toBe(201)
    made.push(['/api/spendings', (sp.json as Row).id])
    const su = await api(request, 'POST', '/api/subscriptions', sub)
    expect(su.status).toBe(201)
    made.push(['/api/subscriptions', (su.json as Row).id])

    // 현황 내보내기
    await page.goto('/')
    await expect(page.locator('header.ph h1')).toBeVisible()
    let wait = page.waitForEvent('download')
    await page.getByRole('button', { name: '내보내기', exact: true }).click()
    let d = await wait
    expect(d.suggestedFilename()).toBe(`allot-summary-${ym}.csv`)
    let lines = await csvOf(d)
    expect(lines[0]).toBe('구분,대상·이름,종류,날짜,금액(원)')
    expect(lines.some((l) => l.startsWith(`분배,${fixed.name},`) && l.endsWith(`,${phase.amounts[fixed.id]}`)), `the fixed target's row:\n${lines.join('\n')}`).toBe(true)
    expect(lines.some((l) => l.startsWith(`지출 회차,${sname},`) && l.endsWith(`,${today},123450`)), 'this month\'s spending round').toBe(true)

    // 지출 일반 CSV
    await page.goto('/spend/general')
    await expect(page.getByText(sname).first()).toBeVisible()
    wait = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV 내보내기', exact: true }).click()
    d = await wait
    expect(d.suggestedFilename()).toBe(`allot-spending-general-${ym}.csv`)
    lines = await csvOf(d)
    expect(lines[0]).toBe('지출,분류,산 날,방식,결제 수단,회차,날짜,금액(원),상태')
    const row = lines.find((l) => l.startsWith(`${sname},`))
    expect(row, `the spending's row:\n${lines.join('\n')}`).toBeTruthy()
    expect(row!.startsWith(`${sname},가전,${today},`)).toBe(true)
    expect(row).toContain(`,${today},123450,`)

    // 구독 CSV
    await menu(page, '지출')
    await page.getByRole('tab', { name: /^구독/ }).click()
    await expect(page.getByRole('row', { name: new RegExp(sname) })).toBeVisible()
    wait = page.waitForEvent('download')
    await page.getByRole('button', { name: 'CSV 내보내기', exact: true }).click()
    d = await wait
    expect(d.suggestedFilename()).toMatch(/^allot-subscriptions-\d{4}-\d{2}\.csv$/)
    lines = await csvOf(d)
    // the last three columns name the next charge when it is not the row's plan (spec 018 A-35); empty for this row
    expect(lines[0]).toBe('이름,분류,요금제,금액,통화,주기,상태,다음 결제일,월 환산(원),다음 결제 요금제,다음 결제 금액,다음 결제 통화')
    const srow = lines.find((l) => l.startsWith(`${sname},`))
    expect(srow, `the subscription's row:\n${lines.join('\n')}`).toBeTruthy()
    expect(srow).toContain(',E2E plan,4500,KRW,')
    expect(srow).toContain(`,${sub.nextDate},`)
  } finally {
    for (const [path, id] of made.reverse()) await api(request, 'DELETE', `${path}/${id}`)
    const after = await state(request)
    expect(after.spendings.some((x) => x.name === sname)).toBe(false)
    expect(after.subscriptions.some((x) => x.name === sname)).toBe(false)
  }
})

// ---------- V-17 해를 넘는 일정 · 예전 when · 구독 기타 · 내역 기간 ----------
test('(V-17, S-18) events: a range into the next year is saved as YYYY-MM~YYYY-MM and listed under both years; the two old forms read back and save unchanged', async ({ page, request }) => {
  const events = async () => (await state(request)).events.filter((e) => e.title.startsWith(MARK))
  try {
    await page.goto('/events')
    await page.getByRole('tab', { name: '타임라인' }).click()
    await page.getByRole('button', { name: '이벤트 추가', exact: true }).click()
    const s = sheet(page, '이벤트 추가')
    await s.getByLabel('내용').fill(`${MARK}-xy`)
    await s.getByRole('button', { name: '기간', exact: true }).click()
    await expect(s).toContainText('끝 월은 다음 해로 넘어가도 돼요.')
    await s.getByLabel('시작 월').fill('2031-12')
    await s.getByLabel('끝 월').fill('2032-02')
    await saveSheet(page, '이벤트 추가')
    const xy = (await events()).find((e) => e.title === `${MARK}-xy`)
    expect(xy?.when, 'stored in the long form').toBe('2031-12~2032-02')
    for (const y of ['2031', '2032']) {
      const block = page.locator('.tl > div').filter({ has: page.locator('h3.yr', { hasText: new RegExp(`^${y}$`) }) })
      const li = block.getByRole('listitem').filter({ hasText: `${MARK}-xy` })
      await expect(li, `listed under ${y}`).toHaveCount(1)
      await expect(li.locator('.when')).toHaveText('31.12~32.02')
    }
    // opening it (from either year) shows its two months; saved unchanged it stays the same
    await page.getByRole('button', { name: `${MARK}-xy 수정` }).last().click()
    const e = sheet(page, '이벤트 수정')
    await expect(e.getByLabel('시작 월')).toHaveValue('2031-12')
    await expect(e.getByLabel('끝 월')).toHaveValue('2032-02')
    await saveSheet(page, '이벤트 수정')
    expect((await events()).find((x) => x.id === xy!.id)?.when).toBe('2031-12~2032-02')

    // the old forms: one month and a range in one year (and a range ending before it starts, accepted since spec 010)
    for (const when of ['2031-03', '2031-01~02', '2031-05~03']) {
      const r = await api(request, 'POST', '/api/events', { when, kind: '저축', title: `${MARK}-old-${when}`, state: 'todo' })
      expect(r.status, when).toBe(201)
    }
    await page.reload()
    await page.getByRole('tab', { name: '타임라인' }).click()
    for (const [when, from, to] of [['2031-03', '2031-03', null], ['2031-01~02', '2031-01', '2031-02'], ['2031-05~03', '2031-05', '2031-03']] as const) {
      await page.getByRole('button', { name: `${MARK}-old-${when} 수정` }).click()
      const o = sheet(page, '이벤트 수정')
      if (to) {
        await expect(o.getByLabel('시작 월')).toHaveValue(from)
        await expect(o.getByLabel('끝 월')).toHaveValue(to)
      } else {
        await expect(o.getByLabel('월', { exact: true })).toHaveValue(from)
      }
      await saveSheet(page, '이벤트 수정')
      expect((await events()).find((x) => x.title === `${MARK}-old-${when}`)?.when, `${when} saved unchanged`).toBe(when)
    }
  } finally {
    for (const x of await events()) await api(request, 'DELETE', `/api/events/${x.id}`)
    expect(await events()).toHaveLength(0)
  }
})

test('(V-17, S-18) subscriptions: 기타 is a category chip that saves `other`, and a filter option', async ({ page, request }) => {
  const name = `${MARK}-other`
  const body = { name, category: 'tool', plan: 'p', amount: 1_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false }
  let id = ''
  try {
    const r = await api(request, 'POST', '/api/subscriptions', body)
    expect(r.status).toBe(201)
    id = (r.json as Row).id
    await page.goto('/spend/subs')
    await page.getByRole('button', { name: `${name} 수정` }).click()
    const s = sheet(page, '구독 수정')
    const chip = s.getByRole('radio', { name: '기타', exact: true })
    await expect(chip).toBeEnabled()
    await chip.click()
    await expect(chip).toHaveAttribute('aria-checked', 'true')
    await s.getByRole('button', { name: '다음', exact: true }).click()
    await saveSheet(page, '구독 수정')
    expect((await state(request)).subscriptions.find((x) => x.id === id)?.category).toBe('other')
    // read back
    await page.reload()
    await page.getByRole('button', { name: `${name} 수정` }).click()
    await expect(s.getByRole('radio', { name: '기타', exact: true })).toHaveAttribute('aria-checked', 'true')
    await s.getByRole('button', { name: '취소', exact: true }).click()
    await expect(s).toBeHidden()
    // the filter
    await choose(page.getByRole('combobox', { name: '분류' }), { label: '기타' })
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
    await choose(page.getByRole('combobox', { name: '분류' }), { label: '도구' })
    await expect(page.getByRole('row', { name: new RegExp(name) })).toHaveCount(0)
  } finally {
    if (id) await api(request, 'DELETE', `/api/subscriptions/${id}`)
    expect((await state(request)).subscriptions.some((x) => x.name === name)).toBe(false)
  }
})

test('(V-17, S-18) 변경 내역: the period filter asks the server for since/until; 이번 달 lists a change made now, a past range lists none', async ({ page, request }) => {
  const text = `${MARK}-period`
  const made = (await api(request, 'POST', '/api/checks', { text, done: false })).json as { id: string }
  try {
    await page.goto('/history')
    const list = page.getByRole('list', { name: '변경 목록' })
    await expect(list.getByRole('listitem').filter({ hasText: text }).first()).toBeVisible()
    const period = page.getByRole('combobox', { name: '기간', exact: true })
    let req = page.waitForRequest((r) => r.url().includes('/api/changes') && r.url().includes('since='))
    await choose(period, { label: '이번 달' })
    const since = new URL((await req).url()).searchParams.get('since')!
    expect(since.slice(0, 7) <= thisYm() && Date.parse(since) <= Date.now(), `since ${since}`).toBe(true)
    await expect(list.getByRole('listitem').filter({ hasText: text }).first()).toBeVisible()
    await choose(period, { label: '지난 3달' })
    await expect(list.getByRole('listitem').filter({ hasText: text }).first()).toBeVisible()
    // chosen dates in the past: nothing in them
    await choose(period, { label: '직접 정하기' })
    req = page.waitForRequest((r) => r.url().includes('/api/changes') && r.url().includes('until='))
    await fillDate(page.getByRole('group', { name: '시작 날짜' }), '2020-01-01')
    await fillDate(page.getByRole('group', { name: '끝 날짜' }), '2020-01-31')
    const u = new URL((await req).url()).searchParams
    expect(u.get('until')).toBeTruthy()
    await expect(page.getByText('이 기간에는 변경이 없어요.')).toBeVisible()
    await choose(period, { label: '전체 기간' })
    await expect(list.getByRole('listitem').filter({ hasText: text }).first()).toBeVisible()
  } finally {
    await api(request, 'DELETE', `/api/checks/${made.id}`)
  }
})

// ---------- V-18 검색 · 알림 · API 문서 ----------
test('(V-18, S-19) search: Ctrl+K opens it, a marked row is found by part of its name and Enter opens its page', async ({ page, request }) => {
  const name = `${MARK}-findme`
  const body = { name, category: 'tool', plan: 'p', amount: 1_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: '2031-01-15', path: 'direct', verified: false }
  let id = ''
  try {
    const r = await api(request, 'POST', '/api/subscriptions', body)
    expect(r.status).toBe(201)
    id = (r.json as Row).id
    await page.goto('/events')
    await page.locator('header.ph h1').waitFor()
    await page.keyboard.press('Control+k')
    const input = page.getByRole('combobox', { name: '검색어' })
    await expect(input).toBeFocused()
    await input.fill(`${MARK.slice(4)}-FINDME`) // a part of the name, in other letter case
    const opt = page.getByRole('option').filter({ hasText: name })
    await expect(opt).toHaveCount(1)
    await expect(page.getByRole('group', { name: '구독', exact: true })).toContainText(name)
    await input.press('Enter')
    await expect(input).toBeHidden()
    await expect(page).toHaveURL(/\/spend\/subs$/)
    await expect(page.getByRole('row', { name: new RegExp(name) })).toBeVisible()
    // the header button opens it too, and a query that matches nothing says so
    await page.getByRole('button', { name: '검색 열기 (Ctrl+K)' }).click()
    await input.fill(`${MARK}-nothing-like-this`)
    await expect(page.getByRole('status').filter({ hasText: '맞는 항목이 없어요' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(input).toBeHidden()
  } finally {
    if (id) await api(request, 'DELETE', `/api/subscriptions/${id}`)
  }
})

test('(V-18, S-20) notifications: the bell lists a payment due within 3 days; it opens its page; 모두 읽음 marks it read', async ({ page, request }) => {
  const name = `${MARK}-bell`
  const due = dayAdd(todayKst(), 2)
  const body = { name, category: 'tool', plan: 'p', amount: 7_000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: due, path: 'direct', verified: false }
  let id = ''
  try {
    const r = await api(request, 'POST', '/api/subscriptions', body)
    expect(r.status).toBe(201)
    id = (r.json as Row).id
    await page.goto('/')
    await page.locator('header.ph h1').waitFor()
    const bell = page.locator('header.topbar').getByRole('button', { name: /^알림 · 읽지 않음 \d+건$/ })
    await bell.click()
    const pop = page.getByRole('dialog', { name: '알림' })
    const row = pop.getByRole('button').filter({ hasText: `${name} 결제 D-2` })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('₩7,000')
    await expect(row.getByRole('img', { name: '읽지 않음' })).toHaveCount(1)
    await pop.getByRole('group', { name: '알림 종류' }).getByRole('button', { name: '결제' }).click()
    await expect(row).toHaveCount(1)
    await pop.getByRole('button', { name: '모두 읽음' }).click()
    await expect(row.getByRole('img', { name: '읽지 않음' })).toHaveCount(0)
    await expect(bell).toHaveAccessibleName('알림 · 읽지 않음 0건')
    await row.click()
    await expect(page).toHaveURL(/\/spend\/subs/)
  } finally {
    if (id) await api(request, 'DELETE', `/api/subscriptions/${id}`)
  }
})

test('(V-18, S-21) API docs: the footer link; /api/docs answers a signed-in user with the routes and the MCP tools, and refuses without a session', async ({ page, request }) => {
  const base = test.info().project.use.baseURL!
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'API 문서' }).first()).toHaveAttribute('href', '/api/docs')
  const r = await request.get('/api/docs')
  expect(r.status()).toBe(200)
  expect(r.headers()['content-type']).toContain('text/html')
  expect(r.headers()['cache-control']).toContain('no-store')
  const html = await r.text()
  for (const s of ['/api/state', '/api/month-adjusts', 'get_budget', 'search', 'list_notifications', 'propose_changes']) expect(html, s).toContain(s)
  const anon = await pwRequest.newContext({ baseURL: base, storageState: { cookies: [], origins: [] } })
  try {
    const a = await anon.get('/api/docs')
    expect(a.status()).toBe(401)
    expect(await a.text()).not.toContain('get_budget')
  } finally {
    await anon.dispose()
  }
})
