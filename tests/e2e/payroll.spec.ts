// spec 010 V-6 / V-7 / V-10 for 월급 분배: the rounding select (a stored 20,000 is an option and is
// selected; "끄기" stores 1), a stored phase label survives a save from the screen, phase numbers by
// start month, the remainder target deleted → the leftover stays in the pay account (and the split rows
// stay), a revert from the history brings the target back, the pay simulation and the calculation dialog,
// the account role as free text with the chips and 들어오는 돈. Everything is put back at the end.
import { expect, test, type APIRequestContext } from '@playwright/test'
import { MARK, choose, deleteInSheet, go, optionTexts, saveSheet, sheet } from './helpers'

type Settings = Record<string, unknown> & { subRound: number; netPay: number }
type Phase = { id: string; label: string; name: string; from: string; to: string | null; amounts: Record<string, number>; note: string }
type Target = { id: string; name: string; kind: string; note: string }
type State = { settings: Settings; phases: Phase[]; targets: Target[]; remainderSplit: { id: string; name: string }[] }

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
const state = async (request: APIRequestContext) => (await api(request, 'GET', '/api/state')).json as State

test('(V-7) a stored rounding unit of 20,000 is an option and selected; another can be picked and this one picked again; "끄기" stores 1', async ({ page, request }) => {
  const before = (await state(request)).settings
  try {
    expect((await api(request, 'PUT', '/api/settings', { ...before, subRound: 20_000 })).status).toBe(200)
    await go(page, 'pay', '통장·생활비·설정')
    const round = page.getByRole('form', { name: '분배 설정' }).getByLabel('구독 이체 올림 단위')
    await expect(round).toHaveText('₩20,000')
    expect(await optionTexts(round)).toEqual(['₩10,000', '₩20,000', '₩50,000', '₩100,000', '끄기'])
    await choose(round, { label: '₩50,000' })
    await choose(round, { label: '₩20,000' })
    await expect(round).toHaveText('₩20,000')

    await choose(round, { label: '끄기' })
    await page.getByRole('form', { name: '분배 설정' }).getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('form', { name: '분배 설정' }).getByRole('status')).toHaveText('저장했어요.')
    expect((await state(request)).settings.subRound).toBe(1)
    await page.reload()
    await go(page, 'pay', '통장·생활비·설정')
    await expect(round).toHaveText('끄기')
  } finally {
    await api(request, 'PUT', '/api/settings', before)
  }
})

test('(V-7) a stored phase label is not shown, phases are numbered by start month, and saving a phase keeps the label', async ({ page, request }) => {
  const st = await state(request)
  const first = st.phases[0]!
  try {
    expect((await api(request, 'PUT', `/api/phases/${first.id}`, { ...first, label: '⑨' })).status).toBe(200)
    await go(page, 'pay', '구간')
    const ordered = [...st.phases].sort((a, b) => (a.from < b.from ? -1 : 1))
    const cards = page.locator('.phase-card')
    await expect(cards).toHaveCount(ordered.length)
    // The screen's order is the list order; every card says its own number, by start month, and never the label.
    for (const [i, p] of st.phases.entries()) {
      const n = ordered.findIndex((x) => x.id === p.id) + 1
      await expect(cards.nth(i)).toContainText(`${n}단계`)
    }
    await expect(page.locator('.phase-card', { hasText: '⑨' })).toHaveCount(0)
    await page.getByRole('button', { name: `${first.name} 구간 수정` }).click()
    await expect(sheet(page, '구간 수정').getByLabel('기호')).toHaveCount(0)
    await sheet(page, '구간 수정').getByLabel('메모').fill(`${MARK}-memo`)
    await saveSheet(page, '구간 수정')
    const after = (await state(request)).phases.find((p) => p.id === first.id)!
    expect(after.label).toBe('⑨')
    expect(after.note).toBe(`${MARK}-memo`)
  } finally {
    await api(request, 'PUT', `/api/phases/${first.id}`, first)
  }
})

test('(V-10) deleting the remainder target: the leftover shows as "급여 통장에 남음", the split rows stay, a revert brings it back', async ({ page, request }) => {
  const st = await state(request)
  const rem = st.targets.find((x) => x.kind === 'remainder')
  test.skip(!rem, 'the account has no remainder target to delete')
  let restored = false
  try {
    await go(page, 'pay', '구간')
    await page.getByRole('row', { name: new RegExp(rem!.name) }).first().click()
    await deleteInSheet(page, '분배 대상 수정')
    await expect(page.getByRole('row', { name: new RegExp(rem!.name) })).toHaveCount(0)
    expect((await state(request)).targets.some((x) => x.kind === 'remainder')).toBe(false)

    await page.getByRole('tab', { name: '월별 시뮬레이션' }).click()
    await expect(page.getByRole('row', { name: /급여 통장에 남음/ })).toBeVisible()
    await expect(page.getByText('여유 대상이 없어서 나눌 금액이 없어요')).toBeVisible()
    // the split rows are kept and can still be opened
    expect((await state(request)).remainderSplit.length).toBe(st.remainderSplit.length)
    if (st.remainderSplit.length) {
      await page.getByRole('row', { name: new RegExp(st.remainderSplit[0]!.name) }).click()
      await expect(sheet(page, '여유 분배 수정')).toBeVisible()
      await page.keyboard.press('Escape')
    }
    await page.getByRole('tab', { name: '통장·생활비·설정' }).click()
    await expect(page.getByText('급여 통장에 남음').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: '돈의 흐름' })).toBeVisible()

    const latest = ((await api(request, 'GET', '/api/changes?limit=1')).json as { id: string }[])[0]!
    expect((await api(request, 'POST', `/api/changes/${latest.id}/revert`)).status).toBe(200)
    restored = true
    await page.reload()
    await go(page, 'pay', '구간')
    await expect(page.getByRole('row', { name: new RegExp(rem!.name) }).first()).toBeVisible()
    expect((await state(request)).targets.some((x) => x.kind === 'remainder' && x.name === rem!.name)).toBe(true)
  } finally {
    if (!restored && !(await state(request)).targets.some((x) => x.kind === 'remainder')) {
      const latest = ((await api(request, 'GET', '/api/changes?limit=1')).json as { id: string }[])[0]
      if (latest) await api(request, 'POST', `/api/changes/${latest.id}/revert`)
    }
  }
})

test('(V-10) the simulation: month steps, the take-home tried on the screen only, and the "how it is worked out" dialog', async ({ page, request }) => {
  await go(page, 'pay', '월별 시뮬레이션')
  const title = page.getByRole('heading', { level: 2, name: /이체$/ })
  const was = await title.textContent()
  await page.getByRole('button', { name: '다음 달' }).click()
  await expect(title).not.toHaveText(was!)
  await page.getByRole('button', { name: '이전 달' }).click()
  await expect(title).toHaveText(was!)

  const saved = (await state(request)).settings
  await page.getByRole('button', { name: '실수령 수정' }).click()
  await sheet(page, '실수령 시뮬레이션').getByLabel('시뮬레이션 실수령').fill(String(Number(saved.netPay) + 100_000))
  await sheet(page, '실수령 시뮬레이션').getByRole('button', { name: '적용' }).click()
  await expect(page.getByText('임시 값')).toBeVisible()
  expect((await state(request)).settings.netPay).toBe(saved.netPay) // nothing was saved
  await page.getByRole('button', { name: '실수령 수정' }).click()
  await sheet(page, '실수령 시뮬레이션').getByRole('button', { name: '설정 값으로 되돌리기' }).click()
  await sheet(page, '실수령 시뮬레이션').getByRole('button', { name: '적용' }).click()
  await expect(page.getByText('임시 값')).toHaveCount(0)

  // the total is the take-home, and a computed row opens its dialog
  // the total row (the living row's detail says 생활비 항목 합계 since spec 013 S-2)
  await expect(page.getByRole('row', { name: /^합계/ })).toContainText('실수령과 같아요')
  await page.getByRole('button', { name: /계산 보기$/ }).first().click()
  const dlg = page.getByRole('alertdialog')
  await expect(dlg).toContainText('이 금액은 계산 값이에요')
  await page.keyboard.press('Escape')
  await expect(dlg).toHaveCount(0)
})

test('(V-6) an account role is any text, the chips fill it, and 들어오는 돈 is kept', async ({ page, request }) => {
  await go(page, 'pay', '통장·생활비·설정')
  try {
    await page.getByRole('button', { name: '+ 통장 추가' }).click()
    const s = sheet(page, '통장 추가')
    await s.getByLabel('통장', { exact: false }).first().fill(`${MARK}-acc`)
    await s.getByRole('group', { name: '빠른 선택' }).getByRole('button', { name: '고정 지출' }).click()
    await expect(s.getByLabel('역할')).toHaveValue('고정 지출')
    await s.getByLabel('역할').fill('내가 정한 역할 ABC')
    await s.getByLabel('들어오는 돈').fill('매달 이체 · 26일')
    await s.getByLabel('나가는 돈').fill('카드 대금')
    await s.getByRole('button', { name: '다음', exact: true }).click() // spec 013 S-5: two steps, the four old fields on the first
    await saveSheet(page, '통장 추가')
    await page.reload()
    await go(page, 'pay', '통장·생활비·설정')
    const row = page.getByRole('row', { name: new RegExp(`${MARK}-acc`) })
    await expect(row).toContainText('내가 정한 역할 ABC')
    await expect(row).toContainText('매달 이체 · 26일')
    await expect(row).toContainText('카드 대금')
    const acc = ((await api(request, 'GET', '/api/state')).json as { accounts: { name: string; role: string; inflow: string }[] }).accounts.find((a) => a.name === `${MARK}-acc`)
    expect(acc?.role).toBe('내가 정한 역할 ABC')
    expect(acc?.inflow).toBe('매달 이체 · 26일')
  } finally {
    const accs = ((await api(request, 'GET', '/api/state')).json as { accounts: { id: string; name: string }[] }).accounts
    for (const a of accs.filter((x) => x.name === `${MARK}-acc`)) await api(request, 'DELETE', `/api/accounts/${a.id}`)
  }
})

test('(A-17) renaming a remainder split keeps its stored ratio (0.3333, the column keeps four decimals)', async ({ page, request }) => {
  const made = await api(request, 'POST', '/api/remainder-split', { name: `${MARK}-ratio`, code: 'R', ratio: 0.3333 })
  expect(made.status).toBe(201)
  const id = (made.json as { id: string }).id
  try {
    await go(page, 'pay', '월별 시뮬레이션')
    await page.getByRole('row', { name: new RegExp(`${MARK}-ratio`) }).click()
    await sheet(page, '여유 분배 수정').getByLabel('항목').fill(`${MARK}-renamed`)
    await saveSheet(page, '여유 분배 수정')
    const row = ((await state(request)) as unknown as { remainderSplit: { id: string; name: string; ratio: number }[] }).remainderSplit.find((x) => x.id === id)!
    expect(row.name).toBe(`${MARK}-renamed`)
    expect(row.ratio).toBe(0.3333)
    // editing the percent still changes it
    await page.getByRole('row', { name: new RegExp(`${MARK}-renamed`) }).click()
    await sheet(page, '여유 분배 수정').getByLabel('비율 %').fill('25')
    await saveSheet(page, '여유 분배 수정')
    expect(((await state(request)) as unknown as { remainderSplit: { id: string; ratio: number }[] }).remainderSplit.find((x) => x.id === id)!.ratio).toBe(0.25)
  } finally {
    await api(request, 'DELETE', `/api/remainder-split/${id}`)
  }
})
