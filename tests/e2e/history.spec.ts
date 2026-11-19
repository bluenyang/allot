// spec 005 V-10 (W-4): the change history shows a save as one entry and can revert it.
import { expect, test } from '@playwright/test'
import { MARK, go, reload, saveSheet, sheet } from './helpers'

test('history: a save shows up, revert undoes it, the revert is listed', async ({ page }) => {
  const text = `${MARK}-hist`
  await go(page, 'home', '확인할 것')
  await page.getByRole('button', { name: '확인할 것 추가' }).click()
  await sheet(page, '기록 추가').getByLabel('내용').fill(text)
  await saveSheet(page, '기록 추가')
  await expect(page.getByRole('checkbox', { name: text })).toBeVisible()

  await page.goto('/#history')
  const list = page.getByRole('list', { name: '변경 목록' })
  const first = list.getByRole('listitem').first()
  await expect(first).toContainText(`체크리스트 추가 · ${text}`)
  await first.getByRole('button', { name: new RegExp(text) }).click()
  await expect(first).toContainText('text')
  await first.getByRole('button', { name: '되돌리기', exact: true }).click()
  const ask = sheet(page, '이 변경을 되돌릴까요?')
  await expect(ask).toContainText(`체크리스트 추가 · ${text}`)
  await expect(ask).toContainText('추가하기 전으로 돌려요')
  await ask.getByRole('button', { name: '되돌리기', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: /되돌렸어요/ })).toBeVisible()
  // the revert is a set of its own, tinted and named; the original is struck through and says so
  const rev = list.getByRole('listitem').first()
  await expect(rev).toContainText(`되돌리기 · 체크리스트 추가`)
  await expect(rev).toHaveClass(/rev/)
  const orig = list.getByRole('listitem').nth(1)
  await expect(orig).toContainText('되돌림')
  await expect(orig).toContainText('되돌렸어요')
  await expect(orig.getByRole('button', { name: '되돌리기', exact: true })).toHaveCount(0)
  // D-10: a revert can be reverted again, and the data comes back
  await rev.getByRole('button', { name: '되돌리기', exact: true }).click()
  await expect(sheet(page, '이 변경을 되돌릴까요?')).toContainText('되돌린 변경을 다시 적용해요')
  await sheet(page, '이 변경을 되돌릴까요?').getByRole('button', { name: '되돌리기', exact: true }).click()
  await expect(sheet(page, '이 변경을 되돌릴까요?')).toBeHidden()
  await expect.poll(async () => ((await (await page.request.get('/api/state')).json()) as { checks: { text: string }[] }).checks.some((c) => c.text === text)).toBe(true)
  // put the data back as the test found it
  await list.getByRole('listitem').first().getByRole('button', { name: '되돌리기', exact: true }).click()
  await sheet(page, '이 변경을 되돌릴까요?').getByRole('button', { name: '되돌리기', exact: true }).click()
  await expect(sheet(page, '이 변경을 되돌릴까요?')).toBeHidden()

  await reload(page, 'home', '확인할 것')
  await expect(page.getByText(text)).toHaveCount(0)
})

test('history (spec 010 S-9): day groups, the actor and the item filters, a refused revert shows its reason', async ({ page, request }) => {
  const text = `${MARK}-grp`
  const made = (await (await request.post('/api/checks', { data: { text, done: false } })).json()) as { id: string }
  try {
    await page.goto('/#history')
    const list = page.getByRole('list', { name: '변경 목록' })
    await expect(list.getByRole('listitem').filter({ hasText: text })).toBeVisible()
    // one heading per day, with the count
    await expect(list.locator('li.day').first()).toContainText(/\(.\)/)
    await expect(list.locator('li.day').first()).toContainText(/\d+건/)
    // who: this change is mine; no AI set is listed under 직접
    const seg = page.getByRole('group', { name: '바꾼 사람으로 거르기' })
    await seg.getByRole('button', { name: /^AI 키/ }).click()
    await expect(list.getByRole('listitem').filter({ hasText: text })).toHaveCount(0)
    await seg.getByRole('button', { name: /^직접/ }).click()
    await expect(list.getByRole('listitem').filter({ hasText: text })).toBeVisible()
    await seg.getByRole('button', { name: /^전체/ }).click()
    // item type: 체크리스트 keeps it, 구독 drops it; the remainder filter is named after the remainder target kind, not 투자
    const kind = page.getByLabel('항목 종류')
    await kind.selectOption({ label: '체크리스트' })
    await expect(list.getByRole('listitem').filter({ hasText: text })).toBeVisible()
    await kind.selectOption({ label: '구독' })
    await expect(list.getByRole('listitem').filter({ hasText: text })).toHaveCount(0)
    expect(await kind.locator('option').allTextContents()).not.toContain('투자 계좌')
    expect(await kind.locator('option').allTextContents()).toContain('나머지 대상')
    await kind.selectOption({ label: '항목 전체' })
    // the same row changed since: the revert is refused and the modal shows why
    await request.delete(`/api/checks/${made.id}`)
    await page.reload()
    const row = list.getByRole('listitem').filter({ hasText: `체크리스트 추가 · ${text}` })
    await row.getByRole('button', { name: '되돌리기', exact: true }).click()
    const ask = sheet(page, '이 변경을 되돌릴까요?')
    await ask.getByRole('button', { name: '되돌리기', exact: true }).click()
    await expect(ask.getByRole('alert')).toBeVisible()
    await expect(ask).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    await request.delete(`/api/checks/${made.id}`)
  }
})
