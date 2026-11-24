// spec 014 W-3 (V-6): the income page. A regular income added, edited (monthly → yearly) and deleted with its receipts;
// two receipts for the salary in the shown month add up and give the difference; an income that came in once adds to
// the month and to its 여유; the salary's expected amount is Payroll's 월 실수령 and an edit on either side shows on the
// other, the old value saved and read back. Every row made here carries the run mark (or is listed by id) and is removed
// in `finally`; the settings changed here (netPay) are put back.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { MARK as RUN, choose, deleteInSheet, go, menu, saveSheet, sheet } from './helpers'

const MARK = `${RUN}-inc`

async function api(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, data?: unknown) {
  const base = test.info().project.use.baseURL!
  const r = await request.fetch(path, { method, data, headers: { origin: base } })
  return { status: r.status(), json: await r.json().catch(() => null) }
}
type Settings = Record<string, unknown> & { netPay: number; payDay: number }
type Income = { id: string; name: string; cycle: 'monthly' | 'yearly'; month: number | null; day: number; amount: number; accountId: string | null; note?: string }
type Receipt = { id: string; itemId: string | null; ym: string; amount: number; date: string | null; note?: string }
type Extra = { id: string; date: string; name: string; amount: number; note?: string }
type State = { settings: Settings; incomes: Income[]; incomeReceipts: Receipt[]; incomeExtras: Extra[] }
const state = async (request: APIRequestContext) => (await api(request, 'GET', '/api/state')).json as State

const won = (n: number) => `${n < 0 ? '−' : ''}₩${Math.abs(n).toLocaleString('en-US')}`
const signed = (n: number) => `${n > 0 ? '+' : ''}${won(n)}`
const digits = (s: string) => {
  const n = Number(s.replace(/[^\d]/g, ''))
  return /[−-]/.test(s) ? -n : n
}
const kst = () => new Date().toLocaleString('sv', { timeZone: 'Asia/Seoul' })
const thisYm = () => kst().slice(0, 7)
const todayKst = () => kst().slice(0, 10)
const ymAdd = (ym: string, n: number) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1)).toISOString().slice(0, 7)
const monthKo = (ym: string) => `${Number(ym.slice(5, 7))}월`

async function openIncome(page: Page) {
  await page.goto('/income')
  await expect(page.locator('header.ph h1')).toHaveText('수입')
  await expect(page.getByTestId('income-month')).toBeVisible()
}
/** The 여유 the summary's link names ("11월 여유 ₩1,234 보기 →"). */
async function leftOver(page: Page) {
  const text = await page.getByTestId('income-summary').getByRole('link').innerText()
  return digits(text.replace(/^.*여유\s+/, '').replace(/\s*보기.*$/, ''))
}

test.beforeEach(async ({ page }) => { await page.setViewportSize({ width: 1440, height: 900 }) })

test('(V-6, S-2) a regular income: added, edited to yearly, deleted with its receipts (the question says so)', async ({ page, request }) => {
  const ym = thisYm()
  const name = `${MARK}-reg`
  const mine = async () => (await state(request)).incomes.filter((x) => x.name.startsWith(name))
  try {
    await openIncome(page)
    const exp0 = digits(await page.getByTestId('sum-expected').innerText())

    await page.getByRole('button', { name: '수입 추가' }).first().click()
    const s = sheet(page, '수입 추가')
    await s.locator('#inc-name').fill(name)
    await choose(s.locator('#inc-day'), '10')
    await s.locator('#inc-amount').fill('150000')
    await saveSheet(page, '수입 추가')
    const [made] = await mine()
    expect(made).toMatchObject({ name, cycle: 'monthly', month: null, day: 10, amount: 150_000, accountId: null })
    const row = page.getByTestId(`inc-row-${made!.id}`)
    await expect(row).toContainText(name)
    await expect(row).toContainText('매달 10일')
    await expect(row.getByTestId('received')).toHaveText('—')
    await expect(page.getByTestId('sum-expected')).toHaveText(won(exp0 + 150_000))
    await expect(page.getByTestId(`reg-${made!.id}`)).toContainText('₩150,000')

    // monthly → yearly in another month: it leaves this month's table and the list says when it comes next
    const other = ymAdd(ym, 2)
    const title = `수입 수정 · ${name}`
    await page.getByRole('button', { name: `${name} 고치기` }).click()
    const e = sheet(page, title)
    await expect(e.locator('#inc-name')).toHaveValue(name)
    await e.getByRole('group', { name: '주기' }).getByRole('button', { name: '해마다' }).click()
    await choose(e.locator('#inc-month'), String(Number(other.slice(5, 7))))
    await e.locator('#inc-amount').fill('1000000')
    await saveSheet(page, title)
    const [edited] = await mine()
    expect(edited).toMatchObject({ cycle: 'yearly', month: Number(other.slice(5, 7)), day: 10, amount: 1_000_000 })
    await expect(row).toHaveCount(0)
    await expect(page.getByTestId('sum-expected')).toHaveText(won(exp0))
    const reg = page.getByTestId(`reg-${made!.id}`)
    await expect(reg).toContainText('해마다')
    await expect(reg).toContainText(`다음: ${other.slice(0, 4)}년 ${monthKo(other)}`)

    // a receipt for it (in its month) goes with it, and the question says so
    expect((await api(request, 'POST', '/api/income-receipts', { itemId: made!.id, ym: other, amount: 900_000, date: null, note: MARK })).status).toBe(201)
    await page.reload()
    await expect(page.locator('header.ph h1')).toHaveText('수입')
    await page.getByRole('button', { name: `${name} 고치기` }).click()
    await sheet(page, title).getByRole('button', { name: '삭제' }).click()
    await expect(page.getByRole('alertdialog')).toContainText('받은 금액 1건도 같이 지워져요')
    await page.getByRole('alertdialog').getByRole('button', { name: '그대로 두기' }).click()
    await deleteInSheet(page, title)
    expect(await mine()).toHaveLength(0)
    expect((await state(request)).incomeReceipts.filter((r) => r.itemId === made!.id)).toHaveLength(0)
    await expect(page.getByTestId(`reg-${made!.id}`)).toHaveCount(0)
  } finally {
    for (const x of await mine()) await api(request, 'DELETE', `/api/incomes/${x.id}`)
    expect(await mine()).toHaveLength(0)
  }
})

test('(V-6, S-3) two receipts for the salary in the shown month add up; the row, the total and the summary show the sum and the difference', async ({ page, request }) => {
  const ym = thisYm()
  const st = await state(request)
  const before = new Set(st.incomeReceipts.map((r) => r.id))
  const sum0 = st.incomeReceipts.filter((r) => r.itemId === null && r.ym === ym).reduce((a, r) => a + r.amount, 0)
  const had = st.incomeReceipts.some((r) => r.itemId === null && r.ym === ym)
  const pay = st.settings.netPay
  const r1 = Math.floor(pay / 2)
  const r2 = pay - r1 + 30_000
  const title = `월급 · ${monthKo(ym)} 받은 금액`
  const made = async () => (await state(request)).incomeReceipts.filter((r) => !before.has(r.id))
  try {
    await openIncome(page)
    const total0 = digits(await page.getByTestId('sum-total').innerText())
    const used0 = had ? sum0 : pay
    const row = page.getByTestId('inc-row-salary')
    await expect(row).toContainText('월급')
    await expect(row).toContainText(`매달 ${st.settings.payDay}일`)

    // the first: with none yet the row's button writes one; with some it opens their list, which adds one
    await row.getByRole('button').click()
    if (had) await sheet(page, title).getByRole('button', { name: '+ 추가' }).click()
    await sheet(page, title).locator('#rc-amount').fill(String(r1))
    await saveSheet(page, title)
    if (had) await sheet(page, title).getByRole('button', { name: '닫기' }).last().click()
    await expect(row.getByTestId('received')).toHaveText(won(sum0 + r1))

    // the second: the row now opens the list; the editor's difference counts the first one too
    await row.getByRole('button').click()
    const list = page.getByTestId('receipt-list')
    await expect(list.locator('li')).toHaveCount((had ? st.incomeReceipts.filter((r) => r.itemId === null && r.ym === ym).length : 0) + 1)
    await sheet(page, title).getByRole('button', { name: '+ 추가' }).click()
    const e = sheet(page, title)
    await e.locator('#rc-amount').fill(String(r2))
    await expect(e.getByTestId('receipt-diff')).toContainText(signed(sum0 + r1 + r2 - pay))
    await saveSheet(page, title)
    // back on the list, with both
    await expect(page.getByTestId('receipt-list').locator('li')).toHaveCount((had ? st.incomeReceipts.filter((r) => r.itemId === null && r.ym === ym).length : 0) + 2)
    await expect(sheet(page, title)).toContainText(`합계 ${won(sum0 + r1 + r2)}`)
    await sheet(page, title).getByRole('button', { name: '닫기' }).last().click()

    const mine = await made()
    expect(mine.map((r) => ({ itemId: r.itemId, ym: r.ym, amount: r.amount })).sort((a, b) => a.amount - b.amount))
      .toEqual([{ itemId: null, ym, amount: r1 }, { itemId: null, ym, amount: r2 }].sort((a, b) => a.amount - b.amount))
    const sum = sum0 + r1 + r2
    await expect(row.getByTestId('received')).toHaveText(won(sum))
    await expect(row.getByTestId('diff')).toHaveText(signed(sum - pay))
    await expect(page.getByTestId('sum-total')).toHaveText(won(total0 - used0 + sum))
    await expect(page.getByTestId('inc-total')).toContainText(won(total0 - used0 + sum))
  } finally {
    for (const r of await made()) await api(request, 'DELETE', `/api/income-receipts/${r.id}`)
    expect(await made()).toHaveLength(0)
  }
})

test('(V-6, S-4) other income: written for today, it adds to the month and to its 여유; edited and deleted', async ({ page, request }) => {
  const name = `${MARK}-ex`
  const mine = async () => (await state(request)).incomeExtras.filter((x) => x.name.startsWith(name))
  try {
    await openIncome(page)
    const total0 = digits(await page.getByTestId('sum-total').innerText())
    const left0 = await leftOver(page)

    await page.getByRole('button', { name: '+ 기타 수입' }).first().click()
    const s = sheet(page, '기타 수입 적기')
    await s.locator('#ex-name').fill(name)
    await s.locator('#ex-amount').fill('45000')
    await saveSheet(page, '기타 수입 적기')
    const [made] = await mine()
    expect(made).toMatchObject({ name, amount: 45_000, date: todayKst() })
    const row = page.getByTestId(`inc-extra-${made!.id}`)
    await expect(row).toContainText(name)
    await expect(row).toContainText('기타')
    await expect(page.getByTestId('sum-total')).toHaveText(won(total0 + 45_000))
    expect(await leftOver(page), 'the month\'s 여유 grows by it').toBe(left0 + 45_000)

    await row.getByRole('button', { name: `${name} 고치기` }).click()
    const e = sheet(page, '기타 수입 수정')
    await expect(e.locator('#ex-name')).toHaveValue(name)
    await e.locator('#ex-amount').fill('46000')
    await saveSheet(page, '기타 수입 수정')
    expect((await mine())[0]).toMatchObject({ amount: 46_000 })
    await expect(page.getByTestId('sum-total')).toHaveText(won(total0 + 46_000))

    await row.getByRole('button', { name: `${name} 고치기` }).click()
    await deleteInSheet(page, '기타 수입 수정')
    expect(await mine()).toHaveLength(0)
    await expect(page.getByTestId('sum-total')).toHaveText(won(total0))
    expect(await leftOver(page)).toBe(left0)
  } finally {
    for (const x of await mine()) await api(request, 'DELETE', `/api/income-extras/${x.id}`)
    expect(await mine()).toHaveLength(0)
  }
})

test('(V-6, S-2) the salary\'s expected amount is Payroll\'s 월 실수령: an edit on either shows on the other; the old value saved and read back', async ({ page, request }) => {
  const st = await state(request)
  const p0 = st.settings.netPay
  const day0 = st.settings.payDay
  const salaryReg = () => page.getByTestId('reg-salary')
  const payForm = () => page.getByRole('form', { name: '분배 설정' })
  try {
    await openIncome(page)
    await expect(salaryReg()).toContainText(won(p0))
    await expect(salaryReg()).toContainText(`매달 ${day0}일`)

    // Payroll shows the same value, and an edit there shows on the income page
    await go(page, 'pay', '통장·생활비·설정')
    await expect(page.locator('#st-pay')).toHaveValue(p0.toLocaleString('en-US'))
    await page.locator('#st-pay').fill(String(p0 + 11_000))
    await payForm().getByRole('button', { name: '저장', exact: true }).click()
    await expect(payForm().getByRole('status')).toHaveText('저장했어요.')
    expect((await state(request)).settings.netPay).toBe(p0 + 11_000)
    await menu(page, '수입')
    await expect(salaryReg()).toContainText(won(p0 + 11_000))

    // an edit on the income page shows on Payroll; the day is kept as it was
    await salaryReg().getByRole('button', { name: '월급 고치기' }).click()
    const s = sheet(page, '월급')
    await expect(s.locator('#sal-amount')).toHaveValue((p0 + 11_000).toLocaleString('en-US'))
    await expect(s.locator('#sal-day')).toHaveText(`${day0}일`)
    await s.locator('#sal-amount').fill(String(p0 + 22_000))
    await saveSheet(page, '월급')
    expect((await state(request)).settings).toMatchObject({ netPay: p0 + 22_000, payDay: day0 })
    await menu(page, '월급 분배')
    await page.getByRole('tab', { name: '통장·생활비·설정' }).click()
    await expect(page.locator('#st-pay')).toHaveValue((p0 + 22_000).toLocaleString('en-US'))

    // the old value, saved from the income page, is read back the same on both
    await menu(page, '수입')
    await salaryReg().getByRole('button', { name: '월급 고치기' }).click()
    await sheet(page, '월급').locator('#sal-amount').fill(String(p0))
    await saveSheet(page, '월급')
    expect((await state(request)).settings).toMatchObject({ netPay: p0, payDay: day0 })
    await expect(salaryReg()).toContainText(won(p0))
    await expect(page.getByTestId('inc-row-salary')).toContainText(won(p0))
    await go(page, 'pay', '통장·생활비·설정')
    await expect(page.locator('#st-pay')).toHaveValue(p0.toLocaleString('en-US'))
  } finally {
    const now = (await state(request)).settings
    if (now.netPay !== p0 || now.payDay !== day0) expect((await api(request, 'PUT', '/api/settings', { ...now, netPay: p0, payDay: day0 })).status).toBe(200)
  }
})
