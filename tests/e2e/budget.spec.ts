// spec 013 W-10: the Living, Savings and Investment pages (V-7, V-8), the accounts, balance records, forecast and
// cards on 월급 분배 (V-9), buffer use and goal cards (V-10), and the card's billing day (V-13). Every row made here
// carries the run mark and is removed by id in `finally`; what the tests change in rows they did not make (settings,
// the current phase, a target's account) is put back. Values that depend on today are worked out from today in Korea.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK as RUN, choose, deleteInSheet, menu, readDate, saveSheet, sheet } from './helpers'

const MARK = `${RUN}-bd`

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
type Row = Record<string, unknown> & { id: string; name: string }
type Phase = { id: string; label: string; name: string; from: string; to: string | null; amounts: Record<string, number>; note?: string }
type Item = Row & { kind: string; payMethod: string; amount: number; from: string | null; code: string | null; amounts: Record<string, number> }
type Target = Row & { kind: string; accountId?: string | null; note?: string }
type Round = { no: number; date: string; amount: number; state: string; edited: boolean }
type Spend = Row & { how: string; payBy: string; cardId: string | null; refillFrom: string | null; fee: number; count: number; rounds: Round[] }
type Settings = Record<string, unknown> & { payDay: number; transferDay: number; billingDay: number; dayShift?: string; savingSplit?: string; investSplit?: string }
type State = {
  settings: Settings; living: { food: number; transit: number; allowance: number }; livingItems: Item[]; phases: Phase[]; targets: Target[]
  accounts: Row[]; balances: Row[]; cards: Row[]; spendings: Spend[]
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
const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7)
const ymDiff = (a: string, b: string) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7))
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const phaseAt = (phases: Phase[], ym: string) => phases.find((p) => p.from <= ym && (p.to === null || p.to >= ym)) ?? null
/** An item's amount in a month: 0 before its start, its phase amount if it has one, else the monthly amount (S-2, S-4). */
const itemIn = (it: Item, phases: Phase[], ym: string) => {
  if (it.from && ym < it.from) return 0
  const p = phaseAt(phases, ym)
  return p && it.amounts[p.id] !== undefined ? it.amounts[p.id]! : it.amount
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }) })

// ---------- 월급 분배: the month table ----------
/** Open 월급 분배 inside the app on its 월별 시뮬레이션 tab, at month `ym`. */
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
/** The amount of a target's row in the open month table. */
async function simValue(page: Page, name: string) {
  const row = page.locator('tbody tr').filter({ has: page.locator('td .tname b', { hasText: new RegExp(`^${esc(name)}$`) }) })
  await expect(row).toHaveCount(1)
  return digits(await row.locator('td.amt').innerText())
}
/** The same, where a row of 0 is not drawn (distributionAt leaves out targets of 0 but the remainder). */
async function simValueOr0(page: Page, name: string) {
  const row = page.locator('tbody tr').filter({ has: page.locator('td .tname b', { hasText: new RegExp(`^${esc(name)}$`) }) })
  return (await row.count()) === 0 ? 0 : digits(await row.locator('td.amt').innerText())
}

// ---------- V-7 생활 ----------
test('(V-7, S-2) 생활: the three moved items are listed, their sum is the old living cost and the living value on 월급 분배; the 통장·생활비·설정 tab shows them read-only with the link', async ({ page, request }) => {
  const st = await state(request)
  const ym = thisYm()
  const coded = ['food', 'transit', 'allowance'].map((c) => st.livingItems.find((x) => x.code === c))
  expect(coded.every(Boolean), 'the three coded items exist').toBe(true)
  const three = coded as Item[]
  // PUT /api/living and the state's `living` are made from them (S-2)
  expect(three.map((x) => x.amount)).toEqual([st.living.food, st.living.transit, st.living.allowance])
  const sum = st.livingItems.reduce((a, x) => a + itemIn(x, st.phases, ym), 0)
  const target = st.targets.find((x) => x.kind === 'living')
  expect(target, 'the account has a living target').toBeTruthy()

  await page.goto('/living')
  await expect(page.locator('header.ph h1')).toHaveText('생활')
  for (const it of three) {
    const row = page.getByTestId(`item-${it.id}`)
    await expect(row).toContainText(it.name)
    await expect(row.locator('b.am')).toHaveText(won(itemIn(it, st.phases, ym)))
  }
  await expect(page.locator('.tot b.num')).toHaveText(won(sum))
  await expect(page.getByTestId('budget-status')).toHaveText('이 합계가 월급 분배의 생활비 금액이 돼요')

  await simAt(page, ym)
  expect(await simValue(page, target!.name), 'the living target in the month table').toBe(sum)

  await page.getByRole('tab', { name: '통장·생활비·설정' }).click()
  const list = page.getByTestId('living-list')
  await expect(list).toBeVisible()
  for (const l of ['식비', '교통', '용돈']) await expect(page.getByLabel(l, { exact: true }), `no ${l} field`).toHaveCount(0)
  await expect(list.locator('input, textarea, [role="combobox"]')).toHaveCount(0)
  for (const it of three) await expect(list).toContainText(it.name)
  await expect(list.locator('.lv-hd b.num')).toHaveText(won(sum))
  await list.getByRole('link', { name: '생활에서 관리 →' }).click()
  await expect(page).toHaveURL(/\/living$/)
})

test('(V-7, S-2, S-4) 생활: an item added, given a phase amount and deleted moves the living value on 월급 분배', async ({ page, request }) => {
  const st = await state(request)
  const ym = thisYm()
  const phase = phaseAt(st.phases, ym)
  expect(phase, 'a phase covers this month (seed)').toBeTruthy()
  const target = st.targets.find((x) => x.kind === 'living')!
  const name = `${MARK}-lv`
  const mine = async () => (await state(request)).livingItems.filter((x) => x.name.startsWith(name))
  try {
    await page.goto('/living')
    await expect(page.locator('header.ph h1')).toHaveText('생활')
    await simAt(page, ym)
    const v0 = await simValue(page, target.name)

    await menu(page, '생활')
    await page.getByRole('button', { name: '항목 추가' }).first().click()
    const s = sheet(page, '생활비 항목 추가')
    await s.getByRole('radio', { name: '생필품' }).click()
    await s.locator('#lv-name').fill(name)
    await s.getByRole('button', { name: '현금', exact: true }).click()
    await s.getByRole('button', { name: '다음', exact: true }).click()
    await s.locator('#lv-amount').fill('12340')
    await s.getByRole('group', { name: '언제부터' }).getByRole('button', { name: '이번 달부터' }).click()
    await saveSheet(page, '생활비 항목 추가')
    const [made] = await mine()
    expect(made).toMatchObject({ name, kind: '생필품', payMethod: '현금', amount: 12_340, from: ym, code: null, amounts: {} })
    await expect(page.getByTestId(`item-${made!.id}`).locator('b.am')).toHaveText('₩12,340')
    await simAt(page, ym)
    expect(await simValue(page, target.name), 'an added item adds to the living value').toBe(v0 + 12_340)

    // a phase amount replaces the monthly amount in that phase
    await menu(page, '생활')
    await page.getByRole('button', { name: `${name} 수정` }).click()
    const title = `생활비 항목 수정 · ${name}`
    const e = sheet(page, title)
    await expect(e.locator('#lv-name')).toHaveValue(name)
    await e.getByRole('button', { name: '다음', exact: true }).click()
    await e.getByRole('button', { name: /^구간별 금액/ }).click()
    await e.locator(`#lv-ph-${phase!.id}`).fill('20000')
    await saveSheet(page, title)
    const [edited] = await mine()
    expect(edited).toMatchObject({ amount: 12_340, amounts: { [phase!.id]: 20_000 } })
    await expect(page.getByTestId(`item-${made!.id}`).locator('b.am')).toHaveText('₩20,000')
    await expect(page.getByTestId(`item-${made!.id}`)).toContainText(/구간 \d+ 금액/)
    await simAt(page, ym)
    expect(await simValue(page, target.name), 'the phase amount counts this month').toBe(v0 + 20_000)

    // delete: asked first, then gone from the living value
    await menu(page, '생활')
    await page.getByRole('button', { name: `${name} 수정` }).click()
    await deleteInSheet(page, title)
    expect(await mine()).toHaveLength(0)
    await expect(page.getByTestId(`item-${made!.id}`)).toHaveCount(0)
    await simAt(page, ym)
    expect(await simValue(page, target.name), 'deleting takes it off again').toBe(v0)
  } finally {
    for (const x of await mine()) await api(request, 'DELETE', `/api/living-items/${x.id}`)
    expect(await mine()).toHaveLength(0)
  }
})

// ---------- V-8 저축 · 투자 ----------
const statusLine = (page: Page) => page.getByTestId('budget-status')

test('(V-8, S-3) 저축: the target made from the page; amount and ratio split; ratio amounts rounded to 1,000; 총액 수정 is the phase amount on 월급 분배; the total-line messages; a fixed target stays as it was', async ({ page, request }) => {
  const st0 = await state(request)
  const ym = thisYm()
  const phase0 = phaseAt(st0.phases, ym)
  expect(phase0, 'a phase covers this month (seed)').toBeTruthy()
  expect(st0.targets.some((x) => x.kind === 'saving'), 'the test account has no 저축 합계 target yet (one per user)').toBe(false)
  const fixed = st0.targets.find((x) => x.kind === 'fixed' && phase0!.amounts[x.id] !== undefined)
  expect(fixed, 'a fixed target with an amount this month (seed)').toBeTruthy()
  const fixedAmt = phase0!.amounts[fixed!.id]!
  const made: string[] = []
  let targetId = ''
  try {
    if (st0.settings.savingSplit !== 'amount') expect((await api(request, 'PUT', '/api/settings', { ...st0.settings, savingSplit: 'amount' })).status).toBe(200)
    await page.goto('/saving')
    await expect(page.locator('header.ph h1')).toHaveText('저축')
    // no target yet: the page offers to make it
    const notice = page.getByTestId('no-target')
    await expect(notice).toContainText('월급 분배에 저축 합계 대상이 없어요')
    await notice.getByRole('button', { name: '저축 합계 대상 만들기' }).click()
    await expect(notice).toHaveCount(0)
    const tg = (await state(request)).targets.find((x) => x.kind === 'saving')!
    expect(tg).toMatchObject({ name: '저축', kind: 'saving', accountId: null })
    targetId = tg.id
    // the made target carries the run mark from here on, so an interrupted run leaves nothing cleanup.mjs misses
    const tname = `${MARK}-sv`
    expect((await api(request, 'PUT', `/api/targets/${targetId}`, { name: tname, kind: 'saving', note: '', accountId: null })).status).toBe(200)

    // an item through the page's editor (amount split)
    await page.getByRole('button', { name: '상품 추가' }).first().click()
    const s = sheet(page, '저축 상품 추가')
    await expect(s.getByRole('radio', { name: '정기적금' })).toHaveAttribute('aria-checked', 'true')
    await s.locator('#bi-name').fill(`${MARK}-s1`)
    await s.locator('#bi-bank').fill('E2E Bank')
    await s.locator('#bi-last4').fill('0123')
    await s.getByRole('button', { name: '다음', exact: true }).click()
    await s.locator('#bi-amount').fill('100000')
    await s.getByRole('group', { name: '언제부터' }).getByRole('button', { name: '이번 달부터' }).click()
    await saveSheet(page, '저축 상품 추가')
    const s1 = (await state(request)).accounts.find((x) => x.name === `${MARK}-s1`)!
    made.push(s1.id)
    expect(s1).toMatchObject({ group: 'saving', amount: 100_000, from: ym, kind: '정기적금', term: '12개월', bank: 'E2E Bank', last4: '0123', role: '', inflow: '', outflow: '', ratio: null })
    // two more by the API, and the ratios for later
    for (const [n, amount, ratio] of [['s2', 200_000, 0.3333], ['s3', 50_000, 0.3334]] as const) {
      const r = await api(request, 'POST', '/api/accounts', { name: `${MARK}-${n}`, role: '', inflow: '', outflow: '', group: 'saving', amount, ratio, from: null })
      expect(r.status).toBe(201)
      made.push((r.json as Row).id)
    }
    const { id: _s1, ...s1body } = s1
    expect((await api(request, 'PUT', `/api/accounts/${s1.id}`, { ...s1body, ratio: 0.3333 })).status).toBe(200)
    const [, s2id, s3id] = made

    // amount split: the target's value is the items' sum, and the line says it is the same
    await page.reload()
    await expect(page.locator('.tot b.num')).toHaveText(won(350_000))
    await expect(statusLine(page)).toHaveText('월급 분배의 저축 금액과 같아요')
    await simAt(page, ym)
    expect(await simValue(page, tname)).toBe(350_000)
    expect(await simValue(page, fixed!.name), 'the fixed target as before').toBe(fixedAmt)

    // ratio split, saved at once
    await menu(page, '저축')
    await page.getByRole('group', { name: '나누는 방식' }).getByRole('button', { name: '비율로' }).click()
    await expect.poll(async () => (await state(request)).settings.savingSplit).toBe('ratio')
    // 총액 수정: the phase amount of the target; items are total × ratio, rounded to 1,000
    await page.getByRole('button', { name: '저축 총액 수정' }).click()
    const tot = sheet(page, '저축 총액 수정')
    await tot.locator('#bt-amount').fill('1000000')
    await expect(tot.getByTestId('total-preview')).toContainText(`${MARK}-s1 · 33.33%333,000원`)
    await expect(tot.getByTestId('total-preview')).toContainText(`${MARK}-s3 · 33.34%333,000원`)
    await saveSheet(page, '저축 총액 수정')
    const ph1 = (await state(request)).phases.find((p) => p.id === phase0!.id)!
    expect(ph1.amounts[targetId], '총액 수정 writes the phase amount').toBe(1_000_000)
    expect(ph1.amounts[fixed!.id], 'the fixed target amount is unchanged').toBe(fixedAmt)
    for (const id of made) await expect(page.getByTestId(`item-${id}`)).toContainText('= ₩333,000 / 월')
    await expect(page.locator('.tot b.num')).toHaveText(won(999_000))
    await expect(statusLine(page), 'under: 1,000 short of the total').toHaveText('₩1,000 덜 나눴어요 · 남는 돈은 나머지로 남아요')
    await simAt(page, ym)
    expect(await simValue(page, tname)).toBe(999_000)
    expect(await simValue(page, fixed!.name)).toBe(fixedAmt)
    // the phase editor on 월급 분배 shows the same total
    await page.getByRole('tab', { name: '구간' }).click()
    await page.getByRole('button', { name: `${phase0!.name} 구간 수정` }).click()
    expect(digits(await sheet(page, '구간 수정').locator(`#ph-amt-${targetId}`).inputValue())).toBe(1_000_000)
    await sheet(page, '구간 수정').getByRole('button', { name: '취소', exact: true }).click()

    // over: rounding up past the total
    await menu(page, '저축')
    await page.getByRole('button', { name: '저축 총액 수정' }).click()
    await sheet(page, '저축 총액 수정').locator('#bt-amount').fill('1001500')
    await saveSheet(page, '저축 총액 수정')
    for (const id of made) await expect(page.getByTestId(`item-${id}`)).toContainText('= ₩334,000 / 월')
    await expect(statusLine(page), 'over').toHaveText('₩500 넘쳐요 · 월급 분배의 저축 총액을 늘리거나 항목을 줄이세요')
    // same: 1,500,000 splits exactly
    await page.getByRole('button', { name: '저축 총액 수정' }).click()
    await sheet(page, '저축 총액 수정').locator('#bt-amount').fill('1500000')
    await saveSheet(page, '저축 총액 수정')
    await expect(statusLine(page), 'same').toHaveText('비율 합계 100% · 월급 분배의 저축 금액과 같아요')
    // the ratio sum off 100%: under and over (a warning only; the save goes through)
    for (const [pct, msg] of [['33.33', '비율 합계 99.99% · 0.01%는 나머지로 남아요'], ['43.34', '비율 합계 110% · 10% 넘쳐요']] as const) {
      await page.getByRole('button', { name: `${MARK}-s3 수정` }).click()
      const e = sheet(page, `저축 상품 수정 · ${MARK}-s3`)
      await e.getByRole('button', { name: '다음', exact: true }).click()
      await e.locator('#bi-pct').fill(pct)
      await saveSheet(page, `저축 상품 수정 · ${MARK}-s3`)
      await expect(statusLine(page)).toHaveText(msg)
    }
    expect((await state(request)).accounts.find((x) => x.id === s3id)?.ratio).toBe(0.4334)
    expect((await state(request)).accounts.find((x) => x.id === s2id)?.ratio).toBe(0.3333)
  } finally {
    for (const id of made) await api(request, 'DELETE', `/api/accounts/${id}`)
    const now = await state(request)
    const p = now.phases.find((x) => x.id === phase0!.id)
    if (p) await api(request, 'PUT', `/api/phases/${p.id}`, { label: phase0!.label, name: phase0!.name, from: phase0!.from, to: phase0!.to, amounts: phase0!.amounts, note: phase0!.note ?? '' })
    if (targetId) await api(request, 'DELETE', `/api/targets/${targetId}`)
    await api(request, 'PUT', '/api/settings', st0.settings)
    const after = await state(request)
    expect(after.accounts.filter((x) => made.includes(x.id)), 'the items are removed').toHaveLength(0)
    expect(after.targets.some((x) => x.id === targetId), 'the target is removed').toBe(false)
    expect(after.phases.find((x) => x.id === phase0!.id)?.amounts).toEqual(phase0!.amounts)
    expect(after.settings.savingSplit ?? 'amount').toBe(st0.settings.savingSplit ?? 'amount')
  }
})

test('(V-8, S-3, S-5) 투자: the target made from the page; an ISA account by ratio with its limit filled; 총액 수정 → the account amount and the value on 월급 분배', async ({ page, request }) => {
  const st0 = await state(request)
  const ym = thisYm()
  const phase0 = phaseAt(st0.phases, ym)
  expect(phase0, 'a phase covers this month (seed)').toBeTruthy()
  expect(st0.targets.some((x) => x.kind === 'invest'), 'the test account has no 투자 합계 target yet (one per user)').toBe(false)
  const made: string[] = []
  let targetId = ''
  try {
    if ((st0.settings.investSplit ?? 'ratio') !== 'ratio') expect((await api(request, 'PUT', '/api/settings', { ...st0.settings, investSplit: 'ratio' })).status).toBe(200)
    await page.goto('/invest')
    await expect(page.locator('header.ph h1')).toHaveText('투자')
    await page.getByTestId('no-target').getByRole('button', { name: '투자 합계 대상 만들기' }).click()
    await expect(page.getByTestId('no-target')).toHaveCount(0)
    const tg = (await state(request)).targets.find((x) => x.kind === 'invest')!
    expect(tg).toMatchObject({ name: '투자', kind: 'invest', accountId: null })
    targetId = tg.id
    const tname = `${MARK}-iv`
    expect((await api(request, 'PUT', `/api/targets/${targetId}`, { name: tname, kind: 'invest', note: '', accountId: null })).status).toBe(200)
    await page.reload()
    await expect(page.getByRole('group', { name: '나누는 방식' }).getByRole('button', { name: '비율로' })).toHaveAttribute('aria-pressed', 'true')

    await page.getByRole('button', { name: '계좌 추가' }).first().click()
    const s = sheet(page, '투자 계좌 추가')
    await expect(s.getByRole('radio', { name: 'ISA' })).toHaveAttribute('aria-checked', 'true')
    await s.locator('#bi-name').fill(`${MARK}-isa`)
    await s.getByRole('button', { name: '다음', exact: true }).click()
    expect(digits(await s.locator('#bi-limit').inputValue()), 'the ISA chip fills the yearly limit').toBe(20_000_000)
    await s.locator('#bi-pct').fill('50')
    await s.getByRole('group', { name: '언제부터' }).getByRole('button', { name: '이번 달부터' }).click()
    await saveSheet(page, '투자 계좌 추가')
    const isa = (await state(request)).accounts.find((x) => x.name === `${MARK}-isa`)!
    made.push(isa.id)
    expect(isa).toMatchObject({ group: 'invest', kind: 'ISA', ratio: 0.5, annualLimit: 20_000_000, from: ym, amount: 0 })

    await page.getByRole('button', { name: '투자 총액 수정' }).click()
    await sheet(page, '투자 총액 수정').locator('#bt-amount').fill('500000')
    await saveSheet(page, '투자 총액 수정')
    expect((await state(request)).phases.find((p) => p.id === phase0!.id)!.amounts[targetId]).toBe(500_000)
    await expect(page.getByTestId(`item-${isa.id}`)).toContainText('= ₩250,000 / 월')
    await expect(statusLine(page)).toHaveText('비율 합계 50% · 50%는 나머지로 남아요')
    await simAt(page, ym)
    expect(await simValue(page, tname)).toBe(250_000)
  } finally {
    for (const id of made) await api(request, 'DELETE', `/api/accounts/${id}`)
    const p = (await state(request)).phases.find((x) => x.id === phase0!.id)
    if (p) await api(request, 'PUT', `/api/phases/${p.id}`, { label: phase0!.label, name: phase0!.name, from: phase0!.from, to: phase0!.to, amounts: phase0!.amounts, note: phase0!.note ?? '' })
    if (targetId) await api(request, 'DELETE', `/api/targets/${targetId}`)
    await api(request, 'PUT', '/api/settings', st0.settings)
    const after = await state(request)
    expect(after.accounts.filter((x) => made.includes(x.id))).toHaveLength(0)
    expect(after.targets.some((x) => x.id === targetId)).toBe(false)
    expect(after.phases.find((x) => x.id === phase0!.id)?.amounts).toEqual(phase0!.amounts)
  }
})

// ---------- V-9 통장 · 잔액 기록 · 예상 · 카드 ----------
async function accountsTab(page: Page) {
  await menu(page, '월급 분배')
  await page.getByRole('tab', { name: '통장·생활비·설정' }).click()
  await expect(page.getByRole('heading', { name: '돈의 흐름' })).toBeVisible()
}
const forecastRows = (page: Page, title: string) => sheet(page, title).getByTestId('account-forecast').locator('tbody tr')
async function forecast(page: Page, title: string) {
  const rows = forecastRows(page, title)
  await expect(rows).toHaveCount(12)
  return Promise.all((await rows.all()).map(async (r) => {
    const td = r.locator('td')
    const cell = async (i: number) => { const x = (await td.nth(i).innerText()).trim(); return x === '—' ? 0 : digits(x) }
    return { ym: (await td.nth(0).innerText()).trim().slice(0, 7).replace('.', '-'), inflow: await cell(1), outflow: await cell(2), end: await cell(3) }
  }))
}

test('(V-9, S-5, S-11) the account editor: the four old text fields come back exactly as typed (a role that is no chip), the new fields are saved; an 0.1.6 row is saved unchanged; a refused last-4 shows the reason', async ({ page, request }) => {
  const name = `${MARK}-ac`
  const mine = async () => (await state(request)).accounts.filter((x) => x.name.startsWith(name))
  try {
    await page.goto('/pay')
    await accountsTab(page)
    await page.getByRole('button', { name: '+ 통장 추가' }).click()
    const s = sheet(page, '통장 추가')
    await s.locator('#ac-name').fill(name)
    await s.locator('#ac-bank').fill('E2E Bank')
    await s.locator('#ac-last4').fill('0123')
    await s.getByRole('group', { name: '빠른 선택' }).getByRole('button', { name: '고정 지출' }).click()
    await expect(s.locator('#ac-role')).toHaveValue('고정 지출')
    await s.locator('#ac-role').fill('저축·투자') // the 0.1.6 chip, now free text
    await s.locator('#ac-in').fill('매달 이체 · 26일')
    await s.locator('#ac-out').fill('카드 대금 · 14일')
    await s.getByRole('button', { name: '다음', exact: true }).click()
    await s.locator('#ac-buffer').fill('300000')
    await s.locator('#ac-goal').fill('1000000')
    await s.locator('#ac-note').fill(`${MARK} memo`)
    await saveSheet(page, '통장 추가')
    const [a] = await mine()
    expect(a).toMatchObject({ name, role: '저축·투자', inflow: '매달 이체 · 26일', outflow: '카드 대금 · 14일', bank: 'E2E Bank', last4: '0123', buffer: 300_000, goal: 1_000_000, annualLimit: null, group: null, amount: 0, ratio: null, note: `${MARK} memo` })
    const row = page.getByTestId('accounts-table').locator('tbody tr').filter({ hasText: name })
    for (const x of ['저축·투자', '매달 이체 · 26일', '카드 대금 · 14일']) await expect(row).toContainText(x)

    // after a reload the editor shows every value as stored, and saving unchanged stores the same row
    await page.reload()
    await accountsTab(page)
    await page.getByRole('button', { name: `통장 수정 · ${name}` }).click()
    const e = sheet(page, '통장 수정')
    await expect(e.locator('#ac-name')).toHaveValue(name)
    await expect(e.locator('#ac-bank')).toHaveValue('E2E Bank')
    await expect(e.locator('#ac-last4')).toHaveValue('0123')
    await expect(e.locator('#ac-role')).toHaveValue('저축·투자')
    await expect(e.locator('#ac-in')).toHaveValue('매달 이체 · 26일')
    await expect(e.locator('#ac-out')).toHaveValue('카드 대금 · 14일')
    await e.getByRole('button', { name: '다음', exact: true }).click()
    expect(digits(await e.locator('#ac-buffer').inputValue())).toBe(300_000)
    expect(digits(await e.locator('#ac-goal').inputValue())).toBe(1_000_000)
    await expect(e.locator('#ac-limit')).toHaveValue('')
    await expect(e.locator('#ac-note')).toHaveValue(`${MARK} memo`)
    await saveSheet(page, '통장 수정')
    const [b] = await mine()
    expect(b).toEqual(a)

    // a last 4 that is not 4 digits: the API refuses and the editor says why
    await page.getByRole('button', { name: `통장 수정 · ${name}` }).click()
    await e.locator('#ac-last4').fill('123')
    await e.getByRole('button', { name: '다음', exact: true }).click()
    await e.getByRole('button', { name: '저장', exact: true }).click()
    await expect(e.getByRole('alert')).toContainText('끝 4자리는 숫자 4개로 적거나 비워 두세요.')
    await e.getByRole('button', { name: '취소', exact: true }).click()
    expect((await mine())[0]!.last4).toBe('0123')

    // a row as 0.1.6 wrote it (the four fields only): opened and saved unchanged, the four fields are as they were
    const old = await api(request, 'POST', '/api/accounts', { name: `${name}-old`, role: '내가 정한 역할 ABC', inflow: '월급 25일', outflow: '자동이체 3건' })
    expect(old.status).toBe(201)
    const oldRow = (await mine()).find((x) => x.name === `${name}-old`)
    expect(oldRow).toMatchObject({ role: '내가 정한 역할 ABC', inflow: '월급 25일', outflow: '자동이체 3건' })
    await page.reload()
    await accountsTab(page)
    await page.getByRole('button', { name: `통장 수정 · ${name}-old` }).click()
    await expect(e.locator('#ac-role')).toHaveValue('내가 정한 역할 ABC')
    await e.getByRole('button', { name: '다음', exact: true }).click()
    await saveSheet(page, '통장 수정')
    expect((await mine()).find((x) => x.name === `${name}-old`)).toEqual(oldRow)
  } finally {
    for (const x of await mine()) await api(request, 'DELETE', `/api/accounts/${x.id}`)
    expect(await mine()).toHaveLength(0)
  }
})

test('(V-9, S-5, S-6) a balance record → the 12-month forecast; the unlinked warning and 통장 연결 → transfers in the forecast', async ({ page, request }) => {
  const st0 = await state(request)
  const ym = thisYm()
  const fixed = st0.targets.find((x) => x.kind === 'fixed' && !x.accountId && phaseAt(st0.phases, ym)?.amounts[x.id])
  expect(fixed, 'an unlinked fixed target with an amount this month (seed)').toBeTruthy()
  const per = phaseAt(st0.phases, ym)!.amounts[fixed!.id]!
  const made = await api(request, 'POST', '/api/accounts', { name: `${MARK}-fc`, role: '', inflow: '', outflow: '' })
  expect(made.status).toBe(201)
  const acc = made.json as Row
  try {
    await page.goto('/pay')
    await accountsTab(page)
    // the row opens the detail sheet: no forecast without a balance record
    await page.getByTestId('accounts-table').locator('tbody tr').filter({ hasText: acc.name }).locator('td').first().click()
    const d = sheet(page, acc.name)
    await expect(d.getByTestId('account-forecast')).toContainText('잔액을 한 번 적으면 예상을 보여 줘요.')
    await d.getByRole('button', { name: '+ 잔액 기록' }).click()
    const bl = sheet(page, '잔액 기록 추가')
    expect(await readDate(bl.getByRole('group', { name: '날짜' })), 'the record date starts on today').toBe(todayKst())
    await bl.locator('#bl-amount').fill('500000')
    await bl.locator('#bl-note').fill(MARK)
    await saveSheet(page, '잔액 기록 추가')
    const rec = (await state(request)).balances.find((x) => x.accountId === acc.id)
    expect(rec).toMatchObject({ date: todayKst(), amount: 500_000, note: MARK })
    await expect(d.locator('tbody tr').filter({ hasText: todayKst() })).toContainText('₩500,000')
    const f0 = await forecast(page, acc.name)
    expect(f0[0]!.ym).toBe(ym)
    expect(f0.map((r) => r.end), 'nothing comes in while no target sends to it').toEqual(Array(12).fill(500_000))
    await d.getByText('닫기', { exact: true }).click()

    // the unlinked warning names the fixed target; 통장 연결 links it to this account
    const warn = page.getByTestId('unlinked-targets')
    await expect(warn).toContainText(fixed!.name)
    await warn.getByRole('button', { name: '통장 연결' }).click()
    const lk = sheet(page, '통장 연결')
    await choose(lk.locator(`#lk-${fixed!.id}`), acc.id)
    await saveSheet(page, '통장 연결')
    expect((await state(request)).targets.find((x) => x.id === fixed!.id)?.accountId).toBe(acc.id)
    await expect(page.getByTestId('unlinked-targets')).not.toContainText(fixed!.name)

    await page.getByTestId('accounts-table').locator('tbody tr').filter({ hasText: acc.name }).locator('td').first().click()
    await expect(d).toContainText(`받는 분배 대상 · ${fixed!.name}`)
    const f1 = await forecast(page, acc.name)
    for (let i = 1; i < 12; i++) {
      expect(f1[i]!.inflow, `${f1[i]!.ym}: the target's transfer comes in`).toBe(per)
      expect(f1[i]!.end - f1[i - 1]!.end).toBe(per)
    }
    await d.getByText('닫기', { exact: true }).click()
  } finally {
    const t = (await state(request)).targets.find((x) => x.id === fixed!.id)
    if (t) await api(request, 'PUT', `/api/targets/${t.id}`, { name: fixed!.name, kind: fixed!.kind, note: fixed!.note ?? '', accountId: fixed!.accountId ?? null })
    await api(request, 'DELETE', `/api/accounts/${acc.id}`)
    const after = await state(request)
    expect(after.accounts.some((x) => x.id === acc.id)).toBe(false)
    expect(after.balances.some((x) => x.accountId === acc.id), 'its balance record went with it').toBe(false)
    expect(after.targets.find((x) => x.id === fixed!.id)?.accountId ?? null).toBe(fixed!.accountId ?? null)
  }
})

test('(V-9, S-13) cards: add, edit (billing day back to the settings day), delete', async ({ page, request }) => {
  const st = await state(request)
  const acc = await api(request, 'POST', '/api/accounts', { name: `${MARK}-cacc`, role: '', inflow: '', outflow: '' })
  expect(acc.status).toBe(201)
  const accId = (acc.json as Row).id
  const name = `${MARK}-card`
  const mine = async () => (await state(request)).cards.filter((x) => x.name.startsWith(name))
  try {
    await page.goto('/pay')
    await accountsTab(page)
    const table = page.getByTestId('cards-table')
    await table.getByRole('button', { name: '+ 카드 추가' }).click()
    const s = sheet(page, '카드 추가')
    await s.locator('#cd-name').fill(name)
    await s.locator('#cd-last4').fill('4321')
    await choose(s.locator('#cd-acc'), accId)
    await choose(s.locator('#cd-day'), '5')
    await saveSheet(page, '카드 추가')
    const [c] = await mine()
    expect(c).toMatchObject({ name, last4: '4321', accountId: accId, billingDay: 5 })
    const row = table.locator('tbody tr').filter({ hasText: name })
    await expect(row).toContainText('4321')
    await expect(row).toContainText(`${MARK}-cacc`)
    await expect(row).toContainText('5일')

    await row.click()
    const e = sheet(page, '카드 수정')
    await expect(e.locator('#cd-name')).toHaveValue(name)
    await e.locator('#cd-name').fill(`${name}-2`)
    await choose(e.locator('#cd-day'), '')
    await saveSheet(page, '카드 수정')
    const [c2] = await mine()
    expect(c2).toMatchObject({ name: `${name}-2`, last4: '4321', accountId: accId, billingDay: null })
    await expect(table.locator('tbody tr').filter({ hasText: `${name}-2` })).toContainText(`설정의 카드 결제일 ${st.settings.billingDay}일`)

    await table.locator('tbody tr').filter({ hasText: `${name}-2` }).click()
    await deleteInSheet(page, '카드 수정')
    expect(await mine()).toHaveLength(0)
    await expect(table.locator('tbody tr').filter({ hasText: name })).toHaveCount(0)
  } finally {
    for (const x of await mine()) await api(request, 'DELETE', `/api/cards/${x.id}`)
    await api(request, 'DELETE', `/api/accounts/${accId}`)
    expect(await mine()).toHaveLength(0)
  }
})

// ---------- V-10 버퍼 사용 · 목표 ----------
async function openSpendAdd(page: Page, tab: 'general' | 'inst') {
  await menu(page, '지출')
  if (tab === 'inst') await page.getByRole('tablist', { name: '지출 종류' }).getByRole('tab', { name: /^할부/ }).click()
  await page.getByRole('button', { name: tab === 'general' ? '지출 추가' : '할부 추가', exact: true }).click()
  const s = sheet(page, tab === 'general' ? '지출 추가' : '할부 추가')
  await expect(s).toBeVisible()
  return s
}
const grp = (s: ReturnType<typeof sheet>, name: string) => s.getByRole('group', { name, exact: true })
const next = (s: ReturnType<typeof sheet>) => s.getByRole('button', { name: '다음', exact: true }).click()

/** An account with a buffer and a balance record of today, and a card paid from it. */
async function bufferSetup(request: APIRequestContext, tag: string, buffer: number, billingDay: number | null) {
  const a = await api(request, 'POST', '/api/accounts', { name: `${MARK}-${tag}`, role: '', inflow: '', outflow: '', buffer })
  expect(a.status).toBe(201)
  const acc = a.json as Row
  expect((await api(request, 'POST', '/api/balances', { accountId: acc.id, date: todayKst(), amount: 1_000_000, note: MARK })).status).toBe(201)
  const c = await api(request, 'POST', '/api/cards', { name: `${MARK}-${tag}-card`, last4: '', accountId: acc.id, billingDay, note: '' })
  expect(c.status).toBe(201)
  return { acc, card: c.json as Row }
}
async function removeAll(request: APIRequestContext, ids: { spendings?: string[]; cards?: string[]; accounts?: string[] }) {
  for (const id of ids.spendings ?? []) await api(request, 'DELETE', `/api/spendings/${id}`)
  for (const id of ids.cards ?? []) await api(request, 'DELETE', `/api/cards/${id}`)
  for (const id of ids.accounts ?? []) await api(request, 'DELETE', `/api/accounts/${id}`)
  const st = await state(request)
  expect(st.spendings.filter((x) => (ids.spendings ?? []).includes(x.id)), 'the test spendings are removed').toHaveLength(0)
  expect(st.cards.filter((x) => (ids.cards ?? []).includes(x.id)), 'the test cards are removed').toHaveLength(0)
  expect(st.accounts.filter((x) => (ids.accounts ?? []).includes(x.id)), 'the test accounts are removed').toHaveLength(0)
}

test('(V-10, S-8) 버퍼 사용: the refill rounds on pay days with the odd won on the last; that month\'s remainder is lower by the refill; the forecast shows the bill out and the refills in; the shortfall warning', async ({ page, request }) => {
  const st = await state(request)
  const { acc, card } = await bufferSetup(request, 'buf', 300_000, null)
  const rem = st.targets.find((x) => x.kind === 'remainder')
  expect(rem, 'the account has a remainder target (seed)').toBeTruthy()
  const name = `${MARK}-bu`
  const spends = async () => (await state(request)).spendings.filter((x) => x.name.startsWith(name))
  const ym = thisYm()
  try {
    await page.goto('/')
    // the shortfall: more than the buffer left is a warning only
    let s = await openSpendAdd(page, 'general')
    await s.getByLabel('내용', { exact: true }).fill(`${name}-big`)
    await s.getByLabel('금액', { exact: true }).fill('400000')
    await next(s)
    await grp(s, '내는 방식').getByRole('button', { name: '버퍼 사용', exact: true }).click()
    await choose(s.locator('#sp-bcard'), card.id)
    await expect(s.getByTestId('sp-short')).toHaveText('버퍼가 ₩100,000 모자라요. 다른 카드를 고르거나 카드 할부로 바꾸세요.')
    await s.getByRole('button', { name: '취소', exact: true }).click()
    await expect(s).toBeHidden()

    // the refill month comes from the card bill (the settings' billing day next month) and the next pay day
    const refill0 = ymAdd(ym, 1)
    await simAt(page, refill0)
    const r0 = await simValue(page, rem!.name)

    s = await openSpendAdd(page, 'general')
    await s.getByLabel('내용', { exact: true }).fill(name)
    await s.getByLabel('금액', { exact: true }).fill('100000')
    await next(s)
    await grp(s, '내는 방식').getByRole('button', { name: '버퍼 사용', exact: true }).click()
    await choose(s.locator('#sp-bcard'), card.id)
    await grp(s, '채울 개월').getByRole('button', { name: '3개월', exact: true }).click()
    await expect(s.getByTestId('sp-short')).toHaveCount(0)
    await expect(s.getByTestId('sp-gauge')).toContainText('버퍼 ₩300,000 중 ₩100,000 사용')
    await next(s)
    await expect(s.locator('.rl li')).toHaveCount(3)
    await expect(s.getByTestId('sp-plan')).toContainText('3개월 동안 버퍼 채우기 · 이자 없음')
    for (const [i, a] of ['₩33,330', '₩33,330', '₩33,340'].entries()) await expect(s.locator('.rl li').nth(i)).toContainText(a)
    await expect(s.getByText(/카드값은 \d+\/\d+ 결제 통장에서 버퍼로, 채우는 돈은 매달 나머지에서 빠져요/)).toBeVisible()
    await saveSheet(page, '지출 추가')
    const [got] = await spends()
    expect(got).toMatchObject({ how: 'buffer', payBy: 'card', cardId: card.id, fee: 0, count: 3, amount: 100_000, interval: null })
    expect(got!.rounds.map((r) => r.amount)).toEqual([33_330, 33_330, 33_340])
    expect(got!.refillFrom).toBe(got!.rounds[0]!.date)
    expect(got!.rounds.map((r) => r.date.slice(0, 7))).toEqual([refill0, ymAdd(ym, 2), ymAdd(ym, 3)])
    if ((st.settings.dayShift ?? 'none') === 'none') expect(got!.rounds.map((r) => +r.date.slice(8))).toEqual([st.settings.payDay, st.settings.payDay, st.settings.payDay])

    // the refill comes off that month's remainder
    await simAt(page, refill0)
    expect(await simValue(page, rem!.name), 'the remainder is lower by the refill').toBe(r0 - 33_330)

    // the paying account's forecast: the bill goes out, the refills come in
    await accountsTab(page)
    await page.getByTestId('accounts-table').locator('tbody tr').filter({ hasText: acc.name }).locator('td').first().click()
    const d = sheet(page, acc.name)
    await expect(d.getByTestId('buffer-gauge')).toContainText('버퍼 ₩300,000 중 ₩100,000 사용 중 · 남은 버퍼 ₩200,000')
    const f = await forecast(page, acc.name)
    const at = (y: string) => f.find((r) => r.ym === y)!
    expect(at(refill0)).toMatchObject({ outflow: 100_000, inflow: 33_330 })
    expect(at(ymAdd(ym, 2))).toMatchObject({ outflow: 0, inflow: 33_330 })
    expect(at(ymAdd(ym, 3))).toMatchObject({ outflow: 0, inflow: 33_340 })
    expect(at(ymAdd(ym, 3)).end, 'the buffer is back after the last refill').toBe(1_000_000)
    await d.getByText('닫기', { exact: true }).click()
  } finally {
    await removeAll(request, { spendings: (await spends()).map((x) => x.id), cards: [card.id], accounts: [acc.id] })
  }
})

test('(V-10, S-7) a goal reached: the card on 대기 중인 변경 → 멈추기 → that month\'s item amount 0 and the remainder up → reverted in 변경 내역 → the card is back; 계속 보내기 → it goes', async ({ page, request }) => {
  const st0 = await state(request)
  const ym = thisYm()
  const rem = st0.targets.find((x) => x.kind === 'remainder')
  expect(rem, 'the account has a remainder target (seed)').toBeTruthy()
  let targetId = st0.targets.find((x) => x.kind === 'saving')?.id ?? ''
  const madeTarget = !targetId
  let accId = ''
  try {
    if (st0.settings.savingSplit !== 'amount') expect((await api(request, 'PUT', '/api/settings', { ...st0.settings, savingSplit: 'amount' })).status).toBe(200)
    if (madeTarget) {
      const t = await api(request, 'POST', '/api/targets', { name: `${MARK}-gt`, kind: 'saving', accountId: null })
      expect(t.status).toBe(201)
      targetId = (t.json as Row).id
    }
    const tname = madeTarget ? `${MARK}-gt` : st0.targets.find((x) => x.id === targetId)!.name
    const a = await api(request, 'POST', '/api/accounts', { name: `${MARK}-goal`, role: '', inflow: '', outflow: '', group: 'saving', amount: 50_000, goal: 1_000_000, from: null })
    expect(a.status).toBe(201)
    accId = (a.json as Row).id
    const aname = `${MARK}-goal`
    // a record at the goal already: the goal month is the record's month (this month)
    expect((await api(request, 'POST', '/api/balances', { accountId: accId, date: `${ym}-01`, amount: 1_200_000, note: MARK })).status).toBe(201)

    await page.goto('/')
    await expect(page.locator('aside.side').getByRole('link', { name: /^대기 중인 변경/ })).toBeVisible()
    await menu(page, '대기 중인 변경')
    const cardOf = () => page.getByRole('article', { name: `목표 도달 · ${aname}` })
    await expect(cardOf()).toContainText(`${aname} 통장이 목표 ₩1,000,000에 닿았어요 (예상 ${ym}). 이 통장으로 보내기를 멈출까요?`)
    const head = await cardOf().locator('.chg-h').innerText()
    const stopYm = head.replace(/^.*?(\d{4})\.\s?(\d{2}).*$/s, '$1-$2')
    expect(ymDiff(ym, stopYm), 'the stop month is the next transfer month').toBeGreaterThanOrEqual(0)
    expect(ymDiff(ym, stopYm)).toBeLessThanOrEqual(1)
    const tds = cardOf().locator('tbody tr')
    await expect(tds.nth(0)).toContainText('₩50,000')
    await expect(tds.nth(0).locator('td.to')).toHaveText('₩0')
    const remBefore = digits(await tds.nth(1).locator('td.from').innerText())
    const remAfter = digits(await tds.nth(1).locator('td.to').innerText())
    expect(remAfter - remBefore, 'the preview: the remainder goes up by the item amount').toBe(50_000)

    const st1 = await state(request)
    expect(st1.settings.savingSplit ?? 'amount', 'the saving split is by amount').toBe('amount')
    expect(st1.targets.find((x) => x.id === targetId)?.name, 'the saving target').toBe(tname)
    await simAt(page, stopYm)
    const s0 = await simValue(page, tname)
    expect(await simValue(page, rem!.name), 'the preview starts from the month table').toBe(remBefore)

    // 멈추기
    await menu(page, '대기 중인 변경')
    await cardOf().getByRole('button', { name: '멈추기', exact: true }).click()
    await expect(cardOf()).toHaveCount(0)
    expect((await state(request)).accounts.find((x) => x.id === accId)?.stopFrom).toBe(stopYm)
    await simAt(page, stopYm)
    expect(await simValue(page, rem!.name), 'the remainder is up by the item amount').toBe(remBefore + 50_000)
    expect(await simValueOr0(page, tname), "that month's item amount is 0 (the target's row goes when it is 0)").toBe(s0 - 50_000)
    await menu(page, '저축')
    await expect(page.getByTestId(`item-${accId}`)).toContainText(`${stopYm}부터 멈춤`)

    // reverted in 변경 내역: sending again, the card is back
    await menu(page, '변경 내역')
    const list = page.getByRole('list', { name: '변경 목록' })
    const set = list.getByRole('listitem').filter({ hasText: aname }).first()
    await set.getByRole('button', { name: '되돌리기', exact: true }).click()
    await sheet(page, '이 변경을 되돌릴까요?').getByRole('button', { name: '되돌리기', exact: true }).click()
    await expect(sheet(page, '이 변경을 되돌릴까요?')).toBeHidden()
    await expect.poll(async () => (await state(request)).accounts.find((x) => x.id === accId)?.stopFrom ?? null).toBe(null)
    await menu(page, '대기 중인 변경')
    await expect(cardOf()).toBeVisible()

    // 계속 보내기: the goal is acknowledged and the card goes
    await cardOf().getByRole('button', { name: '계속 보내기', exact: true }).click()
    await expect(cardOf()).toHaveCount(0)
    const acc = (await state(request)).accounts.find((x) => x.id === accId)!
    expect(acc).toMatchObject({ goalAck: 1_000_000, stopFrom: null })
  } finally {
    if (accId) await api(request, 'DELETE', `/api/accounts/${accId}`)
    if (madeTarget && targetId) await api(request, 'DELETE', `/api/targets/${targetId}`)
    await api(request, 'PUT', '/api/settings', st0.settings)
    const after = await state(request)
    expect(after.accounts.some((x) => x.id === accId)).toBe(false)
    if (madeTarget) expect(after.targets.some((x) => x.id === targetId)).toBe(false)
  }
})

// ---------- V-13 카드 결제일 ----------
test('(V-13, S-13) a card lump sum and installment use the card\'s billing day, one without a card the settings\' day; the paying account\'s forecast counts the bills; buffer use without a card is refused; the card delete rules', async ({ page, request }) => {
  const st = await state(request)
  const { acc, card } = await bufferSetup(request, 'c5', 0, 5)
  const name = `${MARK}-cb`
  const spends = async () => (await state(request)).spendings.filter((x) => x.name.startsWith(name))
  const ym = thisYm()
  const shift = st.settings.dayShift ?? 'none'
  let cardGone = false
  try {
    await page.goto('/')
    // without a card: the settings' billing day (as before)
    let s = await openSpendAdd(page, 'general')
    await s.getByLabel('내용', { exact: true }).fill(`${name}-none`)
    await s.getByLabel('금액', { exact: true }).fill('1000')
    await next(s)
    await expect(s.getByLabel('결제 수단', { exact: true })).toContainText(`카드 · 매달 ${st.settings.billingDay}일 청구`)
    await expect(s.locator('#sp-card')).toContainText('고르지 않음')
    const plain = await readDate(grp(s, '청구일'))
    expect(plain.slice(0, 7)).toBe(ymAdd(ym, 1))
    if (shift === 'none') expect(+plain.slice(8)).toBe(st.settings.billingDay)
    // with the card: its own billing day
    await choose(s.locator('#sp-card'), card.id)
    await expect(s.getByLabel('결제 수단', { exact: true })).toContainText('카드 · 매달 5일 청구')
    const withCard = await readDate(grp(s, '청구일'))
    expect(withCard.slice(0, 7)).toBe(ymAdd(ym, 1))
    if (shift === 'none') expect(withCard.slice(8)).toBe('05')
    await next(s)
    await saveSheet(page, '지출 추가')
    const lump = (await spends()).find((x) => x.name === `${name}-none`)!
    expect(lump).toMatchObject({ how: 'lump', payBy: 'card', cardId: card.id, amount: 1_000 })
    expect(lump.rounds.map((r) => r.date)).toEqual([withCard])

    // an installment with the card: every round on its billing day
    s = await openSpendAdd(page, 'inst')
    await s.getByLabel('내용', { exact: true }).fill(`${name}-inst`)
    await s.getByLabel('금액', { exact: true }).fill('300000')
    await next(s)
    await grp(s, '할부 개월').getByRole('button', { name: '3개월', exact: true }).click()
    await choose(s.locator('#sp-card'), card.id)
    await next(s)
    await saveSheet(page, '할부 추가')
    const inst = (await spends()).find((x) => x.name === `${name}-inst`)!
    expect(inst).toMatchObject({ how: 'installment', payBy: 'card', cardId: card.id, count: 3 })
    expect(inst.rounds.map((r) => r.date.slice(0, 7))).toEqual([ymAdd(ym, 1), ymAdd(ym, 2), ymAdd(ym, 3)])
    if (shift === 'none') expect(inst.rounds.map((r) => r.date.slice(8))).toEqual(['05', '05', '05'])

    // the paying account's forecast: each bill goes out in its month
    await accountsTab(page)
    await page.getByTestId('accounts-table').locator('tbody tr').filter({ hasText: acc.name }).locator('td').first().click()
    const f = await forecast(page, acc.name)
    const outOf = (y: string) => [...lump.rounds, ...inst.rounds].filter((r) => r.date.slice(0, 7) === y).reduce((a, r) => a + r.amount, 0)
    for (const r of f) expect(r.outflow, `${r.ym} out`).toBe(outOf(r.ym))
    await sheet(page, acc.name).getByText('닫기', { exact: true }).click()

    // a buffer use without a card is refused by the API
    const noCard = await api(request, 'POST', '/api/spendings', {
      name: `${name}-bufnc`, note: '', category: '가전', bought: todayKst(), amount: 30_000, currency: 'KRW', fxRate: null, fxBuffer: null,
      how: 'buffer', payBy: 'card', count: 3, fee: 0, interval: null, cancelled: false, cardId: null, refillFrom: `${ymAdd(ym, 1)}-25`,
      rounds: [1, 2, 3].map((no) => ({ no, date: `${ymAdd(ym, no)}-25`, amount: 10_000, state: 'left', edited: false })),
    })
    expect(noCard.status).toBe(400)
    // a buffer use through the card: the card cannot be deleted
    const buf = await api(request, 'POST', '/api/spendings', {
      name: `${name}-buf`, note: '', category: '가전', bought: todayKst(), amount: 30_000, currency: 'KRW', fxRate: null, fxBuffer: null,
      how: 'buffer', payBy: 'card', count: 3, fee: 0, interval: null, cancelled: false, cardId: card.id, refillFrom: `${ymAdd(ym, 1)}-25`,
      rounds: [1, 2, 3].map((no) => ({ no, date: `${ymAdd(ym, no)}-25`, amount: 10_000, state: 'left', edited: false })),
    })
    expect(buf.status).toBe(201)
    await page.reload()
    await accountsTab(page)
    const cardRow = () => page.getByTestId('cards-table').locator('tbody tr').filter({ hasText: card.name })
    await cardRow().click()
    const e = sheet(page, '카드 수정')
    await e.getByRole('button', { name: '삭제' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '삭제', exact: true }).click()
    await expect(e.getByRole('alert')).toContainText('이 카드로 버퍼를 쓰는 지출이 있어요')
    await e.getByRole('button', { name: '취소', exact: true }).click()
    expect((await state(request)).cards.some((x) => x.id === card.id), 'the card is still there').toBe(true)
    // without it, the card goes and its spendings keep their rounds without the card
    expect((await api(request, 'DELETE', `/api/spendings/${(buf.json as Row).id}`)).status).toBe(204)
    await page.reload()
    await accountsTab(page)
    await cardRow().click()
    await deleteInSheet(page, '카드 수정')
    cardGone = true
    const after = await spends()
    for (const x of [lump, inst]) {
      const now = after.find((y) => y.id === x.id)!
      expect(now.cardId, `${x.name} has no card now`).toBeNull()
      expect(now.rounds).toEqual(x.rounds)
    }
  } finally {
    await removeAll(request, { spendings: (await spends()).map((x) => x.id), cards: cardGone ? [] : [card.id], accounts: [acc.id] })
  }
})
