// spec 001 V-9 / V-11: every item can be added, edited and deleted in the UI,
// and the result survives a reload (it came back from PostgreSQL).
// Each test cleans up after itself so the seeded data is left as it was.
import { expect, test } from '@playwright/test'
import { MARK, deleteInSheet, go, noSaveError, reload, saveSheet, sheet } from './helpers'

test.describe('login', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('wrong password shows an error and no data', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('이메일').fill(process.env.ADMIN_EMAIL!)
    await page.getByLabel('비밀번호').fill('definitely-wrong')
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.getByRole('alert')).toContainText(/맞지 않아요|너무 많아요/)
    await expect(page.getByRole('tab', { name: '이번 달' })).toHaveCount(0)
  })
})

test('settings: edit, reload, restore', async ({ page }) => {
  await go(page, 'pay', '통장·생활비·설정')
  const form = page.getByRole('form', { name: '설정' })
  const round = form.getByLabel('구독 이체 올림 단위')
  const before = await round.inputValue()
  await round.fill('5000')
  await form.getByRole('button', { name: '설정 저장' }).click()
  await expect(form.getByRole('status')).toHaveText('저장했어요.')
  await reload(page, 'pay', '통장·생활비·설정')
  await expect(page.getByRole('form', { name: '설정' }).getByLabel('구독 이체 올림 단위')).toHaveValue('5000')
  await page.getByRole('form', { name: '설정' }).getByLabel('구독 이체 올림 단위').fill(before)
  await page.getByRole('form', { name: '설정' }).getByRole('button', { name: '설정 저장' }).click()
  await expect(page.getByRole('form', { name: '설정' }).getByRole('status')).toHaveText('저장했어요.')
  await noSaveError(page)
})

test('living costs: edit, reload, restore', async ({ page }) => {
  await go(page, 'pay', '통장·생활비·설정')
  const food = page.getByLabel('식비')
  const before = await food.inputValue()
  await food.fill('333000')
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/living') && r.request().method() === 'PUT' && r.ok()),
    food.blur(),
  ])
  await reload(page, 'pay', '통장·생활비·설정')
  await expect(page.getByLabel('식비')).toHaveValue('333000')
  await page.getByLabel('식비').fill(before)
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/living') && r.request().method() === 'PUT'),
    page.getByLabel('식비').blur(),
  ])
})

test('accounts: add, edit, delete', async ({ page }) => {
  await go(page, 'pay', '통장·생활비·설정')
  await page.getByRole('button', { name: '+ 통장 추가' }).click()
  await sheet(page, '통장 추가').getByLabel('통장').fill(MARK)
  await sheet(page, '통장 추가').getByLabel('역할').fill('테스트')
  await saveSheet(page, '통장 추가')
  await reload(page, 'pay', '통장·생활비·설정')
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await sheet(page, '통장 수정').getByLabel('역할').fill('테스트-수정')
  await saveSheet(page, '통장 수정')
  await reload(page, 'pay', '통장·생활비·설정')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('테스트-수정')
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await deleteInSheet(page, '통장 수정')
  await reload(page, 'pay', '통장·생활비·설정')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toHaveCount(0)
})

test('remainder split: add, edit, delete', async ({ page }) => {
  await go(page, 'pay', '월별 시뮬레이션')
  await page.getByRole('button', { name: '+ 나머지 분배 추가' }).click()
  const add = sheet(page, '나머지 분배 추가')
  await add.getByLabel('항목').fill(MARK)
  await add.getByLabel('코드').fill('000000')
  await add.getByLabel('비율 %').fill('10')
  await saveSheet(page, '나머지 분배 추가')
  await reload(page, 'pay', '월별 시뮬레이션')
  const row = page.getByRole('row', { name: new RegExp(MARK) })
  await expect(row).toContainText('10%')
  await row.click()
  await sheet(page, '나머지 분배 수정').getByLabel('비율 %').fill('20')
  await saveSheet(page, '나머지 분배 수정')
  await reload(page, 'pay', '월별 시뮬레이션')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('20%')
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await deleteInSheet(page, '나머지 분배 수정')
  await reload(page, 'pay', '월별 시뮬레이션')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toHaveCount(0)
})

test('allocation targets: add a fixed target, give it a phase amount, see it in the distribution, delete', async ({ page }) => {
  await go(page, 'pay', '구간')
  await page.getByRole('button', { name: '+ 분배 대상 추가' }).click()
  const add = sheet(page, '분배 대상 추가')
  await add.getByLabel('이름').fill(MARK)
  await add.getByLabel('종류').selectOption({ label: '구간별 고정' })
  await saveSheet(page, '분배 대상 추가')
  await reload(page, 'pay', '구간')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('구간별 고정')

  // Give the current phase an amount for it; the month's distribution shows it.
  const current = page.locator('.panel', { has: page.locator('.pill', { hasText: '지금' }) })
  await current.getByRole('button', { name: /구간 수정$/ }).click()
  await sheet(page, '구간 수정').getByLabel(MARK).fill('12340')
  await saveSheet(page, '구간 수정')
  await reload(page, 'pay', '월별 시뮬레이션')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('12,340원')

  // A second remainder is refused with a message.
  await go(page, 'pay', '구간')
  await page.getByRole('button', { name: '+ 분배 대상 추가' }).click()
  await sheet(page, '분배 대상 추가').getByLabel('이름').fill(`${MARK}-rem`)
  await sheet(page, '분배 대상 추가').getByLabel('종류').selectOption({ label: '나머지 전부' })
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
  await expect(page.locator('.panel', { hasText: MARK })).toContainText('수정됨')
  await page.getByRole('button', { name: `${MARK} 구간 수정` }).click()
  await deleteInSheet(page, '구간 수정')

  await page.getByRole('button', { name: `${lastName} 구간 수정` }).click()
  await sheet(page, '구간 수정').getByLabel('끝 월 (비우면 계속)').fill('')
  await saveSheet(page, '구간 수정')
  await reload(page, 'pay', '구간')
  await expect(page.locator('.panel', { hasText: MARK })).toHaveCount(0)
  await page.getByRole('button', { name: `${lastName} 구간 수정` }).click()
  await expect(sheet(page, '구간 수정').getByLabel('끝 월 (비우면 계속)')).toHaveValue('')
})

test('events: add, edit, state toggle, delete', async ({ page }) => {
  await go(page, 'events', '타임라인')
  await page.getByRole('button', { name: '+ 이벤트 추가' }).click()
  const add = sheet(page, '이벤트 추가')
  await add.getByLabel('시기 (YYYY-MM 또는 YYYY-MM~MM)').fill('2090-03')
  await add.getByLabel('내용').fill(MARK)
  await saveSheet(page, '이벤트 추가')
  await reload(page, 'events', '타임라인')
  await page.getByRole('button', { name: `${MARK} 수정` }).click()
  await sheet(page, '이벤트 수정').getByLabel('내용').fill(`${MARK}-수정`)
  await saveSheet(page, '이벤트 수정')
  const item = page.getByRole('listitem').filter({ hasText: `${MARK}-수정` })
  await item.getByRole('button', { name: '예정' }).click()
  await expect(item.getByRole('button', { name: '진행' })).toBeVisible()
  await reload(page, 'events', '타임라인')
  await expect(page.getByRole('listitem').filter({ hasText: `${MARK}-수정` }).getByRole('button', { name: '진행' })).toBeVisible()
  await page.getByRole('button', { name: `${MARK}-수정 수정` }).click()
  await deleteInSheet(page, '이벤트 수정')
  await reload(page, 'events', '타임라인')
  await expect(page.getByText(MARK)).toHaveCount(0)
})

test('debts: add, edit, delete', async ({ page }) => {
  await go(page, 'events', '부채')
  await page.getByRole('button', { name: '+ 부채 추가' }).click()
  await sheet(page, '부채 추가').getByLabel('항목').fill(MARK)
  await sheet(page, '부채 추가').getByLabel('원금').fill('1234567') // not a multiple of step=10000: must still save
  await saveSheet(page, '부채 추가')
  await reload(page, 'events', '부채')
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await sheet(page, '부채 수정').getByLabel('원금').fill('2000000')
  await saveSheet(page, '부채 수정')
  await reload(page, 'events', '부채')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toContainText('2,000,000')
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await deleteInSheet(page, '부채 수정')
  await reload(page, 'events', '부채')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toHaveCount(0)
})

test('checklist: add, toggle, edit, delete', async ({ page }) => {
  await go(page, 'home', '확인 필요')
  await page.getByRole('button', { name: '+ 확인할 것 추가' }).click()
  await sheet(page, '확인할 것 추가').getByLabel('내용').fill(MARK)
  await saveSheet(page, '확인할 것 추가')
  await page.getByRole('checkbox', { name: MARK }).check()
  await reload(page, 'home', '확인 필요')
  await expect(page.getByRole('checkbox', { name: MARK })).toBeChecked()
  await page.getByRole('button', { name: `${MARK} 수정` }).click()
  await sheet(page, '확인할 것 수정').getByLabel('내용').fill(`${MARK}-수정`)
  await saveSheet(page, '확인할 것 수정')
  await reload(page, 'home', '확인 필요')
  await expect(page.getByRole('checkbox', { name: `${MARK}-수정` })).toBeChecked()
  await page.getByRole('button', { name: `${MARK}-수정 수정` }).click()
  await deleteInSheet(page, '확인할 것 수정')
  await reload(page, 'home', '확인 필요')
  await expect(page.getByText(MARK)).toHaveCount(0)
})

test('subscriptions and plan changes: add, edit (with memo), delete', async ({ page }) => {
  await go(page, 'subs', '목록')
  await page.getByRole('button', { name: '+ 구독 추가' }).click()
  const add = sheet(page, '구독 추가')
  await add.getByLabel('서비스').fill(MARK)
  await add.getByLabel('결제 금액').fill('9900')
  await add.getByLabel('다음 결제일').fill('2031-01-15')
  await add.getByLabel('메모').fill('메모1')
  await saveSheet(page, '구독 추가')
  await reload(page, 'subs', '목록')
  await page.getByRole('button', { name: new RegExp(MARK) }).click()
  await expect(sheet(page, '구독 수정').getByLabel('메모')).toHaveValue('메모1')
  await sheet(page, '구독 수정').getByLabel('메모').fill('메모2')
  await saveSheet(page, '구독 수정')

  // plan change for it
  await go(page, 'subs', '변경 일정')
  await page.getByRole('button', { name: '+ 전환 예약' }).click()
  const chg = sheet(page, '전환 예약')
  await chg.getByLabel('구독').selectOption({ label: MARK })
  await chg.getByLabel('새 금액').fill('12000')
  await chg.getByLabel('메모').fill(MARK)
  await saveSheet(page, '전환 예약')
  await reload(page, 'subs', '변경 일정')
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await sheet(page, '전환 수정').getByLabel('새 금액').fill('13000')
  await saveSheet(page, '전환 수정')
  await reload(page, 'subs', '변경 일정')
  await page.getByRole('row', { name: new RegExp(MARK) }).click()
  await expect(sheet(page, '전환 수정').getByLabel('새 금액')).toHaveValue('13000')
  await deleteInSheet(page, '전환 수정')
  await reload(page, 'subs', '변경 일정')
  await expect(page.getByRole('row', { name: new RegExp(MARK) })).toHaveCount(0) // gone before the subscription (and its cascade) is

  await reload(page, 'subs', '목록')
  await page.getByRole('button', { name: new RegExp(MARK) }).click()
  await expect(sheet(page, '구독 수정').getByLabel('메모')).toHaveValue('메모2')
  await deleteInSheet(page, '구독 수정')
  await reload(page, 'subs', '목록')
  await expect(page.getByRole('button', { name: new RegExp(MARK) })).toHaveCount(0)
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
  const row = page.getByRole('button', { name: new RegExp(MARK) })
  await expect(row).toContainText('전환후') // the list shows the applied plan
  await row.click()
  const ed = sheet(page, '구독 수정')
  await expect(ed.getByLabel('플랜')).toHaveValue('기본') // the editor edits the base
  await expect(ed.getByTestId('override-note')).toContainText('적용값')
  await expect(ed.getByTestId('override-note')).toContainText('전환후')
  await ed.getByLabel('플랜').fill('기본2')
  await saveSheet(page, '구독 수정')
  await reload(page, 'subs', '목록')
  await expect(page.getByRole('button', { name: new RegExp(MARK) })).toContainText('전환후')
  await page.getByRole('button', { name: new RegExp(MARK) }).click()
  await expect(sheet(page, '구독 수정').getByLabel('플랜')).toHaveValue('기본2')

  await request.delete(`/api/plan-changes/${chg.id}`)
  await request.delete(`/api/subscriptions/${sub.id}`)
})

test('JSON export has every list, equal to the API (V-11)', async ({ page, request }) => {
  await go(page, 'dev', '현재 데이터')
  const text = await page.locator('pre code').textContent()
  const shown = JSON.parse(text!)
  const api = await (await request.get('/api/state')).json()
  for (const k of ['accounts', 'debts', 'remainderSplit', 'targets']) expect(shown).toHaveProperty(k)
  expect(shown).toEqual(api)
})
