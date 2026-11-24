// spec 001 V-9 / V-11: every item can be added, edited and deleted in the UI,
// and the result survives a reload (it came back from PostgreSQL).
// Each test cleans up after itself so the seeded data is left as it was.
import { expect, test } from '@playwright/test'
import { MARK, choose, deleteInSheet, fillDate, go, noSaveError, reload, saveSheet, sheet } from './helpers'

test.describe('login', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('wrong password shows an error and no data', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('이메일').fill(process.env.ADMIN_EMAIL!)
    await page.getByLabel('비밀번호').fill('definitely-wrong')
    await page.getByRole('button', { name: '로그인', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(/맞지 않아요|너무 많아요/)
    await expect(page.getByRole('tab', { name: '이번 달' })).toHaveCount(0)
  })
})

test('settings: edit, reload, restore', async ({ page }) => {
  await go(page, 'pay', '통장·생활비·설정')
  const form = () => page.getByRole('form', { name: '분배 설정' })
  const round = () => form().getByLabel('구독 이체 올림 단위')
  const before = (await round().textContent())!.trim()
  await choose(round(), { label: '₩50,000' })
  await form().getByRole('button', { name: '저장', exact: true }).click()
  await expect(form().getByRole('status')).toHaveText('저장했어요.')
  await reload(page, 'pay', '통장·생활비·설정')
  await expect(round()).toHaveText('₩50,000')
  await choose(round(), { label: before })
  await form().getByRole('button', { name: '저장', exact: true }).click()
  await expect(form().getByRole('status')).toHaveText('저장했어요.')
  await noSaveError(page)
})

// spec 013 S-2: the three fields of 0.1.6 are now the three coded items of 생활. The values they took (whole won,
// 0 and up) are taken by the items' amount field and come back through the state's `living` as before.
test('living costs: the three moved items take the values the three fields took, save, reload, restore', async ({ page, request }) => {
  type It = { id: string; name: string; amount: number; code: string | null }
  const items = async () => ((await (await request.get('/api/state')).json()) as { livingItems: It[]; living: Record<string, number> })
  const st = await items()
  const codes = ['food', 'transit', 'allowance'] as const
  const three = codes.map((c) => st.livingItems.find((x) => x.code === c)!)
  expect(three.every(Boolean)).toBe(true)
  const setAmount = async (it: It, v: string) => {
    await page.getByRole('button', { name: `${it.name} 수정` }).click()
    const s = sheet(page, `생활비 항목 수정 · ${it.name}`)
    await s.getByRole('button', { name: '다음', exact: true }).click()
    await s.locator('#lv-amount').fill(v)
    await saveSheet(page, `생활비 항목 수정 · ${it.name}`)
  }
  const next = ['333000', '44000', '0']
  try {
    await page.goto('/living')
    for (const [i, it] of three.entries()) await setAmount(it, next[i]!)
    await page.reload()
    for (const [i, it] of three.entries()) await expect(page.getByTestId(`item-${it.id}`).locator('b.am')).toHaveText(`₩${Number(next[i]).toLocaleString('en-US')}`)
    const after = await items()
    expect(codes.map((c) => after.living[c])).toEqual(next.map(Number))
    for (const [i, it] of three.entries()) await setAmount(it, String(st.living[codes[i]!]))
    await page.reload()
    for (const [i, it] of three.entries()) await expect(page.getByTestId(`item-${it.id}`).locator('b.am')).toHaveText(`₩${st.living[codes[i]!]!.toLocaleString('en-US')}`)
  } finally {
    await request.put('/api/living', { data: st.living, headers: { origin: test.info().project.use.baseURL! } })
    expect((await items()).living).toEqual(st.living)
  }
})

test('accounts: add, edit, delete', async ({ page }) => {
  await go(page, 'pay', '통장·생활비·설정')
  await page.getByRole('button', { name: '+ 통장 추가' }).click()
  await sheet(page, '통장 추가').getByLabel('통장').fill(MARK)
  await sheet(page, '통장 추가').getByLabel('역할').fill('테스트')
  await sheet(page, '통장 추가').getByLabel('들어오는 돈').fill('월급 · 25일')
  // spec 013 S-5: the editor has two steps (the four old fields on the first); a row opens its detail sheet and
  // the row's 수정 button the editor (A-7)
  await sheet(page, '통장 추가').getByRole('button', { name: '다음', exact: true }).click()
  await saveSheet(page, '통장 추가')
  await reload(page, 'pay', '통장·생활비·설정')
  await page.getByRole('button', { name: `통장 수정 · ${MARK}` }).click()
  await sheet(page, '통장 수정').getByLabel('역할').fill('테스트-수정')
  await sheet(page, '통장 수정').getByRole('button', { name: '다음', exact: true }).click()
  await saveSheet(page, '통장 수정')
  await reload(page, 'pay', '통장·생활비·설정')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('테스트-수정')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('월급 · 25일')
  await page.getByRole('button', { name: `통장 수정 · ${MARK}` }).click()
  await deleteInSheet(page, '통장 수정')
  await reload(page, 'pay', '통장·생활비·설정')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toHaveCount(0)
})

test('remainder split: add, edit, delete', async ({ page }) => {
  await go(page, 'pay', '월별 시뮬레이션')
  await page.getByRole('button', { name: '+ 여유 분배 추가' }).click()
  const add = sheet(page, '여유 분배 추가')
  await add.getByLabel('항목').fill(MARK)
  await add.getByLabel('코드').fill('000000')
  await add.getByLabel('비율 %').fill('10')
  await saveSheet(page, '여유 분배 추가')
  await reload(page, 'pay', '월별 시뮬레이션')
  const row = page.getByRole('row', { name: new RegExp(MARK) })
  await expect(row).toContainText('10%')
  await row.click()
  await sheet(page, '여유 분배 수정').getByLabel('비율 %').fill('20')
  await saveSheet(page, '여유 분배 수정')
  await reload(page, 'pay', '월별 시뮬레이션')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('20%')
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await deleteInSheet(page, '여유 분배 수정')
  await reload(page, 'pay', '월별 시뮬레이션')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toHaveCount(0)
})

test('allocation targets: add a fixed target, give it a phase amount, see it in the distribution, delete', async ({ page }) => {
  await go(page, 'pay', '구간')
  await page.getByRole('button', { name: '+ 분배 대상 추가' }).click()
  const add = sheet(page, '분배 대상 추가')
  await add.getByLabel('이름').fill(MARK)
  await choose(add.getByLabel('종류'), { label: '구간별 고정' })
  await saveSheet(page, '분배 대상 추가')
  await reload(page, 'pay', '구간')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('구간별 고정')

  // Give the current phase an amount for it; the month's distribution shows it.
  const current = page.locator('.phase-card', { has: page.locator('.pill', { hasText: '지금' }) })
  await current.getByRole('button', { name: /구간 수정$/ }).click()
  await sheet(page, '구간 수정').getByLabel(MARK).fill('12340')
  await saveSheet(page, '구간 수정')
  await reload(page, 'pay', '월별 시뮬레이션')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('12,340')

  // A second remainder is refused with a message.
  await go(page, 'pay', '구간')
  await page.getByRole('button', { name: '+ 분배 대상 추가' }).click()
  await sheet(page, '분배 대상 추가').getByLabel('이름').fill(`${MARK}-rem`)
  await choose(sheet(page, '분배 대상 추가').getByLabel('종류'), 'remainder')
  await sheet(page, '분배 대상 추가').getByRole('button', { name: '저장' }).click()
  await expect(sheet(page, '분배 대상 추가').getByRole('alert')).toContainText('하나만')
  await sheet(page, '분배 대상 추가').getByRole('button', { name: '취소' }).click()

  // Deleting the target removes its phase amounts too.
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await deleteInSheet(page, '분배 대상 수정')
  await reload(page, 'pay', '월별 시뮬레이션')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toHaveCount(0)
})

test('phases: overlap is refused, then add, edit, delete', async ({ page }) => {
  await go(page, 'pay', '구간')
  // Overlap with the open-ended last phase is refused with a message.
  await page.getByRole('button', { name: '+ 구간 추가' }).click()
  const add = sheet(page, '구간 추가')
  await add.getByLabel('이름').fill(MARK)
  await add.getByLabel('시작 월').fill('2090-01')
  await add.getByLabel('끝 월 (비우면 계속)').fill('2090-12')
  await add.getByRole('button', { name: '저장' }).click()
  await expect(add.getByRole('alert')).toContainText('겹쳐요')
  await add.getByRole('button', { name: '취소' }).click()

  // Close the open-ended phase before 2090, add the test phase, then undo both.
  const lastEdit = page.getByRole('button', { name: /구간 수정$/ }).last()
  await lastEdit.click()
  const lastName = await sheet(page, '구간 수정').getByLabel('이름').inputValue()
  await sheet(page, '구간 수정').getByLabel('끝 월 (비우면 계속)').fill('2089-12')
  await saveSheet(page, '구간 수정')

  await page.getByRole('button', { name: '+ 구간 추가' }).click()
  await sheet(page, '구간 추가').getByLabel('이름').fill(MARK)
  await sheet(page, '구간 추가').getByLabel('시작 월').fill('2090-01')
  await sheet(page, '구간 추가').getByLabel('끝 월 (비우면 계속)').fill('2090-12')
  await saveSheet(page, '구간 추가')
  await reload(page, 'pay', '구간')
  await page.getByRole('button', { name: `${MARK} 구간 수정` }).click()
  await sheet(page, '구간 수정').getByLabel('메모').fill('수정됨')
  await saveSheet(page, '구간 수정')
  await reload(page, 'pay', '구간')
  await expect(page.locator('.phase-card', { hasText: MARK })).toContainText('수정됨')
  await page.getByRole('button', { name: `${MARK} 구간 수정` }).click()
  await deleteInSheet(page, '구간 수정')

  await page.getByRole('button', { name: `${lastName} 구간 수정` }).click()
  await sheet(page, '구간 수정').getByLabel('끝 월 (비우면 계속)').fill('')
  await saveSheet(page, '구간 수정')
  await reload(page, 'pay', '구간')
  await expect(page.locator('.phase-card', { hasText: MARK })).toHaveCount(0)
  await page.getByRole('button', { name: `${lastName} 구간 수정` }).click()
  await expect(sheet(page, '구간 수정').getByLabel('끝 월 (비우면 계속)')).toHaveValue('')
})

test('events: add, edit, state toggle, delete', async ({ page }) => {
  await go(page, 'events', '타임라인')
  await page.getByRole('button', { name: '이벤트 추가', exact: true }).click()
  const add = sheet(page, '이벤트 추가')
  await add.getByLabel('월', { exact: true }).fill('2090-03')
  await add.getByLabel('내용').fill(MARK)
  await saveSheet(page, '이벤트 추가')
  await reload(page, 'events', '타임라인')
  await page.getByRole('button', { name: `${MARK} 수정` }).click()
  await sheet(page, '이벤트 수정').getByLabel('내용').fill(`${MARK}-수정`)
  await saveSheet(page, '이벤트 수정')
  const item = page.getByRole('listitem').filter({ hasText: `${MARK}-수정` })
  await item.getByRole('button', { name: /^상태 예정/ }).click()
  await expect(item.getByRole('button', { name: /^상태 진행/ })).toBeVisible()
  await reload(page, 'events', '타임라인')
  await expect(page.getByRole('listitem').filter({ hasText: `${MARK}-수정` }).getByRole('button', { name: /^상태 진행/ })).toBeVisible()
  await page.getByRole('button', { name: `${MARK}-수정 수정` }).click()
  await deleteInSheet(page, '이벤트 수정')
  await reload(page, 'events', '타임라인')
  await expect(page.getByText(MARK)).toHaveCount(0)
})

test('events (spec 010 V-6, V-10; spec 013 S-18): a range 2027-01~02 and a range ending before it starts save and read back; a range into the next year is stored as YYYY-MM~YYYY-MM', async ({ page, request }) => {
  await go(page, 'events', '타임라인')
  const open = () => page.getByRole('button', { name: '이벤트 추가', exact: true }).click()
  await open()
  let s = sheet(page, '이벤트 추가')
  await expect(s.getByRole('button', { name: '직접 입력', exact: true })).toBeEnabled()
  await s.getByLabel('내용').fill(`${MARK}-rng`)
  await s.getByRole('button', { name: '기간', exact: true }).click()
  await s.getByLabel('시작 월').fill('2031-01')
  await s.getByLabel('끝 월').fill('2031-02')
  await saveSheet(page, '이벤트 추가')
  await open()
  s = sheet(page, '이벤트 추가')
  await s.getByLabel('내용').fill(`${MARK}-rev`)
  await s.getByRole('button', { name: '기간', exact: true }).click()
  await s.getByLabel('시작 월').fill('2031-05')
  await s.getByLabel('끝 월').fill('2031-03') // accepted before, still accepted
  await saveSheet(page, '이벤트 추가')
  // a range into another year: refused as 준비 중 until rc.1, stored in the long form since spec 013 S-18
  await open()
  s = sheet(page, '이벤트 추가')
  await s.getByLabel('내용').fill(`${MARK}-x`)
  await s.getByRole('button', { name: '기간', exact: true }).click()
  await s.getByLabel('시작 월').fill('2031-12')
  await s.getByLabel('끝 월').fill('2032-02')
  await saveSheet(page, '이벤트 추가')
  const events = ((await (await request.get('/api/state')).json()) as { events: { id: string; when: string; title: string }[] }).events
  try {
    expect(events.find((e) => e.title === `${MARK}-rng`)?.when).toBe('2031-01~02')
    expect(events.find((e) => e.title === `${MARK}-rev`)?.when).toBe('2031-05~03')
    expect(events.find((e) => e.title === `${MARK}-x`)?.when).toBe('2031-12~2032-02')
    // opening a saved range shows its two months
    await page.getByRole('button', { name: `${MARK}-rng 수정` }).click()
    s = sheet(page, '이벤트 수정')
    await expect(s.getByLabel('시작 월')).toHaveValue('2031-01')
    await expect(s.getByLabel('끝 월')).toHaveValue('2031-02')
    await page.keyboard.press('Escape')
  } finally {
    for (const e of events.filter((x) => x.title.startsWith(`${MARK}-`))) await request.delete(`/api/events/${e.id}`)
  }
})

test('events (A-18): 직접 입력 takes every value the server pattern takes (2027-13, 2027-11~99); a stored 2027-00 opens as text and re-saves unchanged', async ({ page, request }) => {
  const stored = (await (await request.post('/api/events', { data: { when: '2027-00', kind: '저축', title: `${MARK}-zero`, state: 'todo' } })).json()) as { id: string }
  await go(page, 'events', '타임라인')
  try {
    for (const [name, when] of [['a', '2027-13'], ['b', '2027-11~99']] as const) {
      await page.getByRole('button', { name: '이벤트 추가', exact: true }).click()
      const s = sheet(page, '이벤트 추가')
      await s.getByLabel('내용').fill(`${MARK}-raw${name}`)
      await s.getByRole('button', { name: '직접 입력', exact: true }).click()
      await s.getByLabel('시기 직접 입력').fill(when)
      await saveSheet(page, '이벤트 추가')
    }
    // a value that is not the pattern is still refused, with the reason
    await page.getByRole('button', { name: '이벤트 추가', exact: true }).click()
    const bad = sheet(page, '이벤트 추가')
    await bad.getByLabel('내용').fill(`${MARK}-rawbad`)
    await bad.getByRole('button', { name: '직접 입력', exact: true }).click()
    await bad.getByLabel('시기 직접 입력').fill('soon')
    await bad.getByRole('button', { name: '저장' }).click()
    await expect(bad.getByRole('alert')).toBeVisible()
    await page.keyboard.press('Escape')
    const get = async () => ((await (await request.get('/api/state')).json()) as { events: { id: string; when: string; title: string }[] }).events
    const ev = await get()
    expect(ev.find((e) => e.title === `${MARK}-rawa`)?.when).toBe('2027-13')
    expect(ev.find((e) => e.title === `${MARK}-rawb`)?.when).toBe('2027-11~99')
    // the stored 2027-00 opens verbatim in text mode and survives a save
    await reload(page, 'events', '타임라인')
    await page.getByRole('button', { name: `${MARK}-zero 수정` }).click()
    const s = sheet(page, '이벤트 수정')
    await expect(s.getByLabel('시기 직접 입력')).toHaveValue('2027-00')
    await s.getByLabel('내용').fill(`${MARK}-zero2`)
    await saveSheet(page, '이벤트 수정')
    expect((await get()).find((e) => e.id === stored.id)?.when).toBe('2027-00')
  } finally {
    const ev = ((await (await request.get('/api/state')).json()) as { events: { id: string; title: string }[] }).events
    for (const e of ev.filter((x) => x.title.startsWith(`${MARK}-`))) await request.delete(`/api/events/${e.id}`)
  }
})

test('debts: add, edit, delete', async ({ page }) => {
  await go(page, 'events', '부채')
  await page.getByRole('button', { name: '부채 추가', exact: true }).click()
  const add = sheet(page, '부채 추가')
  await add.getByLabel('항목').fill(MARK)
  await add.getByLabel('원금').fill('1234567') // not a multiple of 10,000: must still save
  await add.getByRole('button', { name: '다음' }).click()
  await saveSheet(page, '부채 추가')
  await reload(page, 'events', '부채')
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await sheet(page, '부채 수정').getByLabel('원금').fill('2000000')
  await sheet(page, '부채 수정').getByRole('button', { name: '다음' }).click()
  await saveSheet(page, '부채 수정')
  await reload(page, 'events', '부채')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('2,000,000')
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await sheet(page, '부채 수정').getByRole('button', { name: '다음' }).click()
  await deleteInSheet(page, '부채 수정')
  await reload(page, 'events', '부채')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toHaveCount(0)
})

test('debts (spec 010 V-6, S-9): the rate is any text or empty, a number shows as a percentage; the principal takes 0 and pasted digits; 기타 keeps the typed method', async ({ page, request }) => {
  await go(page, 'events', '부채')
  const make = async (name: string, principal: string, rate: string, other?: string) => {
    await page.getByRole('button', { name: '부채 추가', exact: true }).click()
    const s = sheet(page, '부채 추가')
    await s.getByLabel('항목').fill(name)
    await s.getByLabel('원금').fill(principal)
    await s.getByRole('button', { name: '다음' }).click()
    if (rate) await s.getByLabel('금리').fill(rate)
    if (other) { await s.getByRole('button', { name: '기타' }).click(); await s.getByLabel('상환 방식 직접 입력').fill(other) }
    await saveSheet(page, '부채 추가')
  }
  await make(`${MARK}-a`, '0', '변동 (CD+1.5)', '체증식')
  await make(`${MARK}-b`, '4000000', '4.2')
  await make(`${MARK}-c`, '1000', '')
  const debts = () => request.get('/api/state').then((r) => r.json() as Promise<{ debts: { id: string; name: string; principal: number; rate: string; method: string }[] }>).then((j) => j.debts.filter((d) => d.name.startsWith(`${MARK}-`)))
  try {
    const got = await debts()
    const by = (n: string) => got.find((d) => d.name === `${MARK}-${n}`)!
    expect([by('a').principal, by('a').rate, by('a').method]).toEqual([0, '변동 (CD+1.5)', '체증식'])
    expect([by('b').principal, by('b').rate, by('b').method]).toEqual([4000000, '4.2', ''])
    expect([by('c').principal, by('c').rate]).toEqual([1000, ''])
    await reload(page, 'events', '부채')
    await expect(page.getByRole('row', { name: new RegExp(`${MARK}-b`) })).toContainText('4.2%')
    await expect(page.getByRole('row', { name: new RegExp(`${MARK}-a`) })).toContainText('변동 (CD+1.5)')
    await expect(page.getByRole('row', { name: new RegExp(`${MARK}-a`) })).toContainText('체증식')
    // reopened, the text is back in its fields
    await page.getByRole('row', { name: new RegExp(`${MARK}-a`) }).click()
    const s = sheet(page, '부채 수정')
    await s.getByRole('button', { name: '다음' }).click()
    await expect(s.getByLabel('금리')).toHaveValue('변동 (CD+1.5)')
    await expect(s.getByLabel('상환 방식 직접 입력')).toHaveValue('체증식')
    await page.keyboard.press('Escape')
  } finally {
    for (const d of await debts()) await request.delete(`/api/debts/${d.id}`)
  }
})

test('checklist: add, toggle, edit, delete', async ({ page }) => {
  await go(page, 'home', '확인할 것')
  await page.getByRole('button', { name: '확인할 것 추가' }).click()
  await sheet(page, '기록 추가').getByLabel('내용').fill(MARK)
  await saveSheet(page, '기록 추가')
  await page.getByRole('checkbox', { name: MARK }).check()
  await reload(page, 'home', '확인할 것')
  await expect(page.getByRole('checkbox', { name: MARK })).toBeChecked()
  await page.getByRole('button', { name: `${MARK} 수정` }).click()
  await sheet(page, '확인할 것 수정').getByLabel('내용').fill(`${MARK}-수정`)
  await saveSheet(page, '확인할 것 수정')
  await reload(page, 'home', '확인할 것')
  await expect(page.getByRole('checkbox', { name: `${MARK}-수정` })).toBeChecked()
  await page.getByRole('button', { name: `${MARK}-수정 수정` }).click()
  await deleteInSheet(page, '확인할 것 수정')
  await reload(page, 'home', '확인할 것')
  await expect(page.getByText(MARK)).toHaveCount(0)
})

test('subscriptions and plan changes: 2-step add, edit (with memo), plan change, delete (spec 010 V-10)', async ({ page }) => {
  await go(page, 'subs', '목록')
  await page.getByRole('button', { name: '구독 추가' }).click()
  const add = sheet(page, '구독 추가')
  // step 1 needs a name before it goes on
  await add.getByRole('button', { name: '다음' }).click()
  await expect(add.getByRole('alert')).toContainText('서비스 이름')
  await add.getByLabel('서비스 이름').fill(MARK)
  await add.getByRole('radio', { name: 'AI' }).click()
  await add.getByLabel('플랜').fill('기본\n둘째 줄')
  await add.getByRole('button', { name: '다음' }).click()
  await expect(add.getByLabel('금액', { exact: true })).toBeVisible()
  await add.getByLabel('금액', { exact: true }).fill('9900')
  await fillDate(add.getByRole('group', { name: '다음 결제일' }), '2031-01-15')
  await add.getByRole('button', { name: '메모 추가' }).click()
  await add.getByLabel('메모').fill('메모1')
  await saveSheet(page, '구독 추가')
  await reload(page, 'subs', '목록')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('기본')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).not.toContainText('둘째 줄')
  await page.getByRole('button', { name: `${MARK} 수정` }).click()
  const ed = sheet(page, '구독 수정')
  await expect(ed.getByLabel('서비스 이름')).toHaveValue(MARK) // opens on step 1
  await ed.getByRole('button', { name: '다음' }).click()
  await expect(ed.getByLabel('메모')).toHaveValue('메모1') // the memo is open because it has text
  await ed.getByLabel('메모').fill('메모2')
  await saveSheet(page, '구독 수정')

  // plan change for it: two steps
  await go(page, 'subs', '변경 일정')
  await page.getByRole('button', { name: '+ 전환 예약' }).click()
  const chg = sheet(page, '플랜 전환 예약')
  await choose(chg.getByLabel('대상 구독'), { label: MARK })
  await chg.getByRole('button', { name: '다음' }).click()
  await chg.getByLabel('새 금액').fill('12000')
  await chg.getByRole('button', { name: '메모 추가' }).click()
  await chg.getByLabel('메모').fill(MARK)
  await saveSheet(page, '플랜 전환 예약')
  await reload(page, 'subs', '변경 일정')
  await page.getByRole('button', { name: `${MARK} 전환 수정` }).click()
  await sheet(page, '플랜 전환 수정').getByRole('button', { name: '다음' }).click()
  await sheet(page, '플랜 전환 수정').getByLabel('새 금액').fill('13000')
  await saveSheet(page, '플랜 전환 수정')
  await reload(page, 'subs', '변경 일정')
  await page.getByRole('button', { name: `${MARK} 전환 수정` }).click()
  await sheet(page, '플랜 전환 수정').getByRole('button', { name: '다음' }).click()
  await expect(sheet(page, '플랜 전환 수정').getByLabel('새 금액')).toHaveValue('13,000')
  // 예약 취소 asks first; backing out keeps it
  await sheet(page, '플랜 전환 수정').getByRole('button', { name: '예약 취소' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '그대로 두기' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await sheet(page, '플랜 전환 수정').getByRole('button', { name: '예약 취소' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '예약 취소' }).click()
  await expect(sheet(page, '플랜 전환 수정')).toBeHidden()
  await reload(page, 'subs', '변경 일정')
  await expect(page.getByRole('button', { name: `${MARK} 전환 수정` })).toHaveCount(0) // gone before the subscription (and its cascade) is

  await reload(page, 'subs', '목록')
  await page.getByRole('button', { name: `${MARK} 수정` }).click()
  await sheet(page, '구독 수정').getByRole('button', { name: '다음' }).click()
  await expect(sheet(page, '구독 수정').getByLabel('메모')).toHaveValue('메모2')
  // 삭제 asks first (an alertdialog): 취소 keeps the subscription, 삭제 removes it
  await sheet(page, '구독 수정').getByRole('button', { name: '삭제' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '취소' }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await sheet(page, '구독 수정').getByRole('button', { name: '삭제' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '삭제' }).click()
  await expect(sheet(page, '구독 수정')).toBeHidden()
  await reload(page, 'subs', '목록')
  await expect(page.getByRole('button', { name: `${MARK} 수정` })).toHaveCount(0)
})

test('subscription under a plan change shows base vs applied values', async ({ page, request }) => {
  // Make a subscription whose change is already in effect this month.
  const state = await (await request.get('/api/state')).json()
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const sub = await (await request.post('/api/subscriptions', {
    data: { name: MARK, category: 'tool', plan: '기본', amount: 1000, currency: 'KRW', vat: 0, cycle: 'monthly', status: 'active', nextDate: `${ym}-20`, path: 'direct', verified: false },
  })).json()
  const chg = await (await request.post('/api/plan-changes', {
    data: { subId: sub.id, effective: `${ym}-01`, to: { plan: '전환후', amount: 2000 }, note: '' },
  })).json()
  expect(state.subscriptions.length).toBeGreaterThan(0)

  await go(page, 'subs', '목록')
  const row = page.getByRole('row', { name: new RegExp(MARK) })
  await expect(row).toContainText('전환후') // the list shows the applied plan
  await page.getByRole('button', { name: `${MARK} 수정` }).click()
  const ed = sheet(page, '구독 수정')
  await expect(ed.getByLabel('플랜')).toHaveValue('기본') // the editor edits the base
  await ed.getByLabel('플랜').fill('기본2')
  await ed.getByRole('button', { name: '다음' }).click()
  await expect(ed.getByTestId('override-note')).toContainText('적용값')
  await expect(ed.getByTestId('override-note')).toContainText('전환후')
  await saveSheet(page, '구독 수정')
  await reload(page, 'subs', '목록')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('전환후')
  await page.getByRole('button', { name: `${MARK} 수정` }).click()
  await expect(sheet(page, '구독 수정').getByLabel('플랜')).toHaveValue('기본2')

  await request.delete(`/api/plan-changes/${chg.id}`)
  await request.delete(`/api/subscriptions/${sub.id}`)
})

test('JSON export has every list, equal to the API (V-11)', async ({ page, request }) => {
  await go(page, 'dev', '현재 데이터')
  const text = await page.locator('pre code').textContent()
  const shown = JSON.parse(text!)
  // the badge's number (spec 009) is in /api/state but is not data: the export is the data
  const { pendingProposals: _badge, ...api } = await (await request.get('/api/state')).json()
  for (const k of ['accounts', 'debts', 'remainderSplit', 'targets']) expect(shown).toHaveProperty(k)
  expect(shown).toEqual(api)
})

test('record modal (spec 010 V-6, V-10): a 일정 with a month range saves and reads back; a 확인할 것 too; 구독 goes on to its page', async ({ page, request }) => {
  await go(page, 'home')
  await page.getByRole('button', { name: '기록 추가', exact: true }).click()
  const s = sheet(page, '기록 추가')
  await s.getByRole('radio', { name: /^일정/ }).click()
  await s.getByLabel('제목').fill(`${MARK}-ev`)
  await s.getByLabel('날짜 또는 월').fill('2031-01~02')
  await saveSheet(page, '기록 추가')
  const events = ((await (await request.get('/api/state')).json()) as { events: { id: string; when: string; title: string; state: string }[] }).events
  const made = events.find((e) => e.title === `${MARK}-ev`)
  expect(made?.when).toBe('2031-01~02')
  expect(made?.state).toBe('todo')
  await request.delete(`/api/events/${made!.id}`)
  // a refused pattern says why and saves nothing
  await page.getByRole('button', { name: '기록 추가', exact: true }).click()
  await s.getByRole('radio', { name: /^일정/ }).click()
  await s.getByLabel('제목').fill(`${MARK}-bad`)
  await s.getByLabel('날짜 또는 월').fill('soon')
  await s.getByRole('button', { name: '저장' }).click()
  await expect(s.getByRole('alert')).toBeVisible()
  await s.getByRole('radio', { name: /^구독/ }).click()
  await s.getByRole('button', { name: '다음' }).click()
  await expect(page).toHaveURL(/\/spend\/subs$/)
  // ... and opens the subscription add editor there
  await expect(sheet(page, '구독 추가')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet(page, '구독 추가')).toBeHidden()
})
