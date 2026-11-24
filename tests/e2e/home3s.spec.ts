// spec 014 W-4 (S-1, S-7, S-11; V-6): the three-second home. The first card answers 들어올 돈 − 나갈 돈 = 여유, the two
// cards behind it and 여유 어디에 둘까 follow, and the four tabs that were the page are under '자세히'. Reads only: it writes
// no data, so it runs against any seeded stack (the PM runs it on :15174).
import { expect, test, type Page } from '@playwright/test'

const hero = (page: Page) => page.getByRole('region', { name: '이번 달 여유' })

test('(S-1) the hero shows 여유 as the biggest number, with 들어올 돈 and 나갈 돈 in its equation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(hero(page)).toBeVisible()
  await expect(page.locator('header.ph h1')).toHaveText(/^\d{4}년 \d{1,2}월$/)
  // the header line keeps the pay day and the transfer day only
  await expect(page.locator('header.ph .sub')).toContainText('월급')
  await expect(page.locator('header.ph .sub')).not.toContainText('카드 결제')
  const h = hero(page)
  await expect(h).toContainText('여유')
  await expect(h).toContainText('들어올 돈')
  await expect(h).toContainText('나갈 돈')
  await expect(h.locator('.pill').first()).toHaveText(/받은 돈 기준|월급 전 · 월급은 예상 금액으로|일부는 예상 금액으로/)
  // the big number is the 여유 cell of the equation, and it is the largest type on the card
  const big = h.getByTestId('yeo')
  await expect(big).toHaveText(await h.locator('.eqc.yc .big').innerText())
  const sizes = await h.locator('.num').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)))
  expect(parseFloat(await big.evaluate((e) => getComputedStyle(e).fontSize))).toBe(Math.max(...sizes))
  // 들어올 돈 leads to the income page
  await expect(h.getByRole('link', { name: /^들어올 돈/ })).toHaveAttribute('href', '/income')
  // the bar and its legend: one 여유 entry
  await expect(h.getByRole('img', { name: /^들어올 돈이 나뉘는 비율/ })).toBeVisible()
  await expect(h.locator('.legend')).toContainText('여유')
})

test('(S-1, S-7) 들어올 돈, 나갈 돈 and 여유 어디에 둘까 sit under the hero; every 나갈 돈 line links to its menu', async ({ page }) => {
  await page.goto('/')
  const inCard = page.getByRole('region', { name: '들어올 돈' })
  const outCard = page.getByRole('region', { name: '나갈 돈' })
  await expect(inCard).toBeVisible()
  await expect(inCard).toContainText('월급')
  await expect(inCard.getByRole('link', { name: '수입 관리 →' })).toHaveAttribute('href', '/income')
  await expect(outCard).toBeVisible()
  const lines = outCard.locator('a.lrow')
  expect(await lines.count(), 'the seed has allocation targets').toBeGreaterThan(0)
  for (const href of await lines.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
    expect(['/living', '/spend/subs', '/pay', '/saving', '/invest', '/spend/general']).toContain(href)
  }
  const place = page.getByRole('region', { name: '여유 어디에 둘까' })
  await expect(place).toBeVisible()
  await expect(place.getByRole('link', { name: '나누는 방법 고치기' })).toHaveAttribute('href', '/pay?tab=sim')
  await expect(place.getByRole('button', { name: '이번 달만 다르게' })).toHaveCount(0)
})

test('(S-11) the four old tabs are under 자세히; the card-billing date and the last sync are in the 이번 달 tab', async ({ page }) => {
  await page.goto('/')
  const details = page.getByRole('heading', { level: 2, name: '자세히' })
  await expect(details).toBeVisible()
  const tabs = page.getByRole('tablist').first()
  await expect(tabs.getByRole('tab')).toHaveText([/이번 달/, /AI 제안/, /예정/, /확인할 것/])
  const [dy, ty] = [(await details.boundingBox())!.y, (await tabs.boundingBox())!.y]
  expect(ty, 'the tabs come after 자세히').toBeGreaterThan(dy)
  const place = (await page.getByRole('region', { name: '여유 어디에 둘까' }).boundingBox())!
  expect(dy, '자세히 comes after 여유 어디에 둘까').toBeGreaterThan(place.y)
  // 이번 달 keeps the split table, the trend, the payments and the leftover box; its head has the billing date and the sync
  await expect(page.locator('.mhead')).toContainText('카드 결제')
  await expect(page.locator('.mhead')).toContainText('마지막 동기화')
  await expect(page.getByRole('heading', { level: 2, name: /자동이체 분배$/ })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '결제 예정' })).toBeVisible()
  await expect(page.getByText('이체 후 남는 금액')).toBeVisible()
  for (const name of [/AI 제안/, /예정/, /확인할 것/]) {
    await tabs.getByRole('tab', { name }).click()
    await expect(tabs.getByRole('tab', { name })).toHaveAttribute('aria-selected', 'true')
  }
  await expect(page.getByRole('button', { name: '확인할 것 추가' })).toBeVisible()
})

test('(S-1) at 390 px wide: no horizontal scroll, and the equation stacks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(hero(page)).toBeVisible()
  await page.waitForTimeout(300)
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth])
  expect(sw, 'scrollWidth').toBeLessThanOrEqual(iw)
  const cells = hero(page).locator('.eqc')
  await expect(cells).toHaveCount(3)
  const xs = await cells.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
  expect(new Set(xs).size, 'the three cells share one column').toBe(1)
})

/** Is the element's box wholly inside the first screen (the viewport, above the phone's bottom bar)? */
async function inFirstScreen(page: Page, sel: ReturnType<Page['locator']>) {
  const box = (await sel.boundingBox())!
  const vh = page.viewportSize()!.height
  const bar = await page.locator('nav.mnav').boundingBox().catch(() => null)
  const bottom = bar && bar.y < vh ? bar.y : vh
  return box.y >= 0 && box.y + box.height <= bottom
}

for (const [label, size] of [['desktop 1440×900', { width: 1440, height: 900 }], ['phone 390×844', { width: 390, height: 844 }]] as const) {
  test(`(V-7, A-16) ${label}: 여유, 들어올 돈 with its expected amount, 나갈 돈 with its parts, and where 여유 goes are all in the first screen`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.goto('/')
    const h = hero(page)
    await expect(h).toBeVisible()
    const goes = h.getByTestId('yeo-goes')
    // where it goes matches the 여유 어디에 둘까 card: every place named there with its amount
    const card = page.getByRole('region', { name: '여유 어디에 둘까' })
    for (const row of await card.locator('.lrow').all()) {
      await expect(goes).toContainText((await row.locator('.l-n b').innerText()).trim())
      await expect(goes).toContainText((await row.locator('.amt').innerText()).trim())
    }
    for (const [what, el] of [
      ['여유', h.getByTestId('yeo')],
      ['들어올 돈', h.locator('a.eqc')],
      ['나갈 돈', h.locator('.eqc').nth(1)],
      ['the parts of 나갈 돈 (legend)', h.locator('.legend')],
      ['where 여유 goes', goes],
    ] as const) expect(await inFirstScreen(page, el), `${what} is in the first screen`).toBe(true)
    await expect(h.locator('a.eqc')).toContainText('예상')
  })
}
