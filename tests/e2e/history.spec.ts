// spec 005 V-10 (W-4): the change history shows a save as one entry and can revert it.
import { expect, test } from '@playwright/test'
import { MARK, go, reload, saveSheet, sheet } from './helpers'

test('history: a save shows up, revert undoes it, the revert is listed', async ({ page }) => {
  const text = `${MARK}-hist`
  await go(page, 'home', '확인 필요')
  await page.getByRole('button', { name: '+ 확인할 것 추가' }).click()
  await sheet(page, '확인할 것 추가').getByLabel('내용').fill(text)
  await saveSheet(page, '확인할 것 추가')
  await expect(page.getByRole('checkbox', { name: text })).toBeVisible()

  await page.goto('/#history')
  const list = page.getByRole('list', { name: '변경 목록' })
  const first = list.getByRole('listitem').first()
  await expect(first).toContainText(`체크리스트 추가 · ${text}`)
  await first.getByRole('button', { name: new RegExp(text) }).click()
  await expect(first).toContainText('text')
  page.once('dialog', (d) => d.accept())
  await first.getByRole('button', { name: '되돌리기' }).click()
  await expect(page.getByRole('status')).toHaveText('되돌렸어요.')
  await expect(list.getByRole('listitem').first()).toContainText('되돌림')
  await expect(list.getByRole('listitem').nth(1)).toContainText('되돌려짐')

  await reload(page, 'home', '확인 필요')
  await expect(page.getByText(text)).toHaveCount(0)
})
