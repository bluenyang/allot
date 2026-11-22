// spec 012 V-5, V-7: history addresses, and every hash address of 0.1.5 still leads to the same screen.
// The old forms are those App.vue's read() and Spending.vue's checkAdd accepted before (git show
// master:src/App.vue, master:src/pages/Spending.vue).
import { expect, test, type Page } from '@playwright/test'
import { sheet } from './helpers'

const ALL_SUBS = '구독 전체 보기'
const h1 = (page: Page) => page.locator('header.ph h1')
const tab = (page: Page, name: string | RegExp) => page.getByRole('tab', { name })

// [old hash, new path, page title, selected tab (or null)]
const OLD: [string, string, string | RegExp, string | RegExp | null][] = [
  ['#home', '/', /현황$/, null],
  ['#pay', '/pay', '월급 분배', null],
  ['#spend', '/spend/general', '지출', /^일반/],
  ['#spend/general', '/spend/general', '지출', /^일반/],
  ['#spend/inst', '/spend/inst', '지출', /^할부/],
  ['#spend/subs', '/spend/subs', '지출', /^구독/],
  ['#spend/nope', '/spend/general', '지출', /^일반/],
  ['#subs', '/spend/subs', '지출', /^구독/],
  ['#events', '/events', '일정', null],
  ['#pending', '/pending', '대기 중인 변경', null],
  ['#history', '/history', '변경 내역', null],
  ['#settings', '/settings/general', '설정', '일반'],
  ['#settings/general', '/settings/general', '설정', '일반'],
  ['#settings/theme', '/settings/theme', '설정', '테마'],
  ['#settings/ai', '/settings/ai', '설정', 'AI·연동'],
  ['#settings/security', '/settings/security', '설정', '로그인·보안'],
  ['#settings/nope', '/settings/general', '설정', '일반'],
  ['#account', '/settings/security', '설정', '로그인·보안'],
  ['#admin', '/admin', '관리', null],
  ['#nope', '/#nope', /현황$/, null], // not an old app address: left alone, the overview as before
]

const pathOf = (page: Page) => { const u = new URL(page.url()); return u.pathname + u.search + u.hash }

for (const [hash, path, title, selected] of OLD) {
  test(`(S-2) /${hash} opens ${path}, with one history entry`, async ({ page }) => {
    await page.goto('about:blank')
    await page.goto(`/${hash}`)
    await expect(h1(page)).toHaveText(title)
    await expect.poll(() => pathOf(page)).toBe(path)
    if (selected) await expect(tab(page, selected)).toHaveAttribute('aria-selected', 'true')
    await page.goBack()
    await expect.poll(() => page.url()).toBe('about:blank')
  })
}

test('(S-2) #dev opens /dev', async ({ page }) => {
  await page.goto('/#dev')
  await expect.poll(() => pathOf(page)).toBe('/dev')
})

test('(S-2) an old hash typed on a new address is replaced too', async ({ page }) => {
  await page.goto('/pay')
  await expect(h1(page)).toHaveText('월급 분배')
  await page.evaluate(() => { location.hash = '#settings/ai' })
  await expect.poll(() => pathOf(page)).toBe('/settings/ai')
  await expect(tab(page, 'AI·연동')).toHaveAttribute('aria-selected', 'true')
  await page.goBack()
  await expect.poll(() => pathOf(page)).toBe('/pay')
})

for (const [from, title] of [
  ['/#subs?add', '구독 추가'], ['/#spend/subs?add', '구독 추가'], ['/#spend/subs?x=1&add', '구독 추가'], ['/#subs?add-x', '구독 추가'], ['/#subs?add=1', '구독 추가'],
  ['/#spend/general?add', '지출 추가'], ['/#spend/inst?add', '할부 추가'],
  ['/spend/subs?add', '구독 추가'], ['/spend/general?add', '지출 추가'], ['/spend/inst?add', '할부 추가'],
] as const) {
  test(`(S-3) ${from} opens ${title}, and add leaves the address`, async ({ page }) => {
    await page.goto(from)
    await expect(sheet(page, title)).toBeVisible()
    await expect.poll(() => [...new URL(page.url()).searchParams.keys()].some((k) => /^add(?!\w)/.test(k))).toBe(false)
    expect(new URL(page.url()).pathname).toMatch(/^\/spend\/(general|inst|subs)$/)
  })
}

test('(S-3) the add link works on the page that is already open', async ({ page }) => {
  await page.goto('/spend/subs')
  await expect(tab(page, /^구독/)).toHaveAttribute('aria-selected', 'true')
  await page.evaluate(() => { location.hash = '#subs?add' })
  await expect(sheet(page, '구독 추가')).toBeVisible()
})

test('(S-5) an auth error that comes back to /#account shows on 로그인·보안 and leaves the address', async ({ page }) => {
  await page.goto('/?error=state_mismatch#account')
  await expect(tab(page, '로그인·보안')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByText('로그인이 중간에 끊겼어요. 다시 해 주세요.')).toBeVisible()
  await expect.poll(() => pathOf(page)).toBe('/settings/security')
  // review 1 F-1: after another tab and Back, the error is not in the address or on screen again
  await tab(page, '일반').click()
  await expect.poll(() => pathOf(page)).toBe('/settings/general')
  await page.goBack()
  await expect.poll(() => pathOf(page)).toBe('/settings/security')
  await expect(page.getByText('로그인이 중간에 끊겼어요. 다시 해 주세요.')).toHaveCount(0)
})

test('(S-5) #app-login is left alone: the hand-over screen, not the app', async ({ page }) => {
  await page.goto(`/#app-login?return=${encodeURIComponent('allot://not-listed')}`)
  await expect(page.getByRole('alert')).toBeVisible() // the server refuses an unlisted app address
  expect(new URL(page.url()).hash).toMatch(/^#app-login\?return=/)
  await expect(page.locator('aside.side')).toHaveCount(0)
})

test('(S-1) deep addresses reload to the same screen; /home, unknown addresses and missing tabs', async ({ page }) => {
  await page.goto('/settings/ai')
  await expect(tab(page, 'AI·연동')).toHaveAttribute('aria-selected', 'true')
  await page.reload()
  await expect(tab(page, 'AI·연동')).toHaveAttribute('aria-selected', 'true')
  await page.goto('/spend/inst')
  await page.reload()
  await expect(tab(page, /^할부/)).toHaveAttribute('aria-selected', 'true')
  for (const [from, to] of [['/home', '/'], ['/no/such/page', '/'], ['/spend', '/spend/general'], ['/spend/nope', '/spend/general'], ['/settings', '/settings/general'], ['/settings/nope', '/settings/general'], ['/spend/SUBS', '/spend/general'], ['/PAY', '/']]) {
    await page.goto(from)
    await expect.poll(() => pathOf(page), from).toBe(to)
    await expect(h1(page)).toBeVisible()
  }
})

test('(S-4) menu, tabs and in-page links go to new addresses; Back and Forward go between them, each from the top', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(h1(page)).toHaveText(/현황$/)
  const side = page.locator('aside.side')
  for (const [name, path] of [['월급 분배', '/pay'], ['지출', '/spend/general'], ['일정', '/events'], ['변경 내역', '/history'], ['설정', '/settings/general'], ['현황', '/']] as const) {
    const link = side.getByRole('link', { name, exact: true })
    await link.click()
    await expect.poll(() => pathOf(page), name).toBe(path)
    await expect(link).toHaveAttribute('aria-current', 'true')
  }
  await page.goto('/settings/general')
  await tab(page, 'AI·연동').click()
  await expect.poll(() => pathOf(page)).toBe('/settings/ai')
  await page.goto('/')
  await page.getByRole('link', { name: ALL_SUBS }).click()
  await expect.poll(() => pathOf(page)).toBe('/spend/subs')
  // Back and Forward, each starting at the top
  await page.goto('/spend/subs')
  await page.goto('/history')
  await page.evaluate(() => window.scrollTo(0, 400))
  await page.goBack()
  await expect.poll(() => pathOf(page)).toBe('/spend/subs')
  await expect(tab(page, /^구독/)).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.goForward()
  await expect.poll(() => pathOf(page)).toBe('/history')
  await expect(h1(page)).toHaveText('변경 내역')
})

test('(S-4) a page keeps its state when you come back; an editor closes when you leave its tab (spec 011 A-13)', async ({ page }) => {
  await page.goto('/spend/subs')
  const search = page.getByRole('searchbox', { name: '구독 검색' })
  await search.fill('E2E-router-kept')
  await page.locator('aside.side').getByRole('link', { name: '월급 분배', exact: true }).click()
  await expect(h1(page)).toHaveText('월급 분배')
  await page.goBack()
  await expect(page.getByRole('searchbox', { name: '구독 검색' })).toHaveValue('E2E-router-kept')
  await search.fill('')
  await page.getByRole('button', { name: '구독 추가', exact: true }).click()
  await expect(sheet(page, '구독 추가')).toBeVisible()
  await page.evaluate(() => { location.hash = '#spend/general' }) // to another tab of the page
  await expect.poll(() => pathOf(page)).toBe('/spend/general')
  await expect(sheet(page, '구독 추가')).toHaveCount(0)
})

test('(S-4) a page whose code cannot be loaded says so', async ({ page }) => {
  await page.route(/\/assets\/Spending-[^/]+\.js$/, (r) => r.abort())
  await page.goto('/spend/general')
  await expect(page.locator('.page-load-error')).toBeVisible()
  await expect(page.getByRole('button', { name: '새로고침' })).toBeVisible()
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('(V-7) the bottom bar and the 더보기 sheet go to new addresses, with no sideways scroll', async ({ page }) => {
    await page.goto('/')
    const bar = page.getByRole('navigation', { name: '메뉴' }).last()
    for (const [label, path] of [['예산', '/pay'], ['일정', '/events'], ['현황', '/']] as const) {
      await bar.getByRole('link', { name: label }).click()
      await expect.poll(() => pathOf(page), label).toBe(path)
      await expect(bar.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'true')
    }
    const more = page.getByRole('dialog', { name: '더보기' })
    for (const [label, path] of [['지출', '/spend/subs'], ['변경 내역', '/history'], ['설정', '/settings/general']] as const) {
      await bar.getByRole('button', { name: '더보기' }).click()
      await more.getByRole('link', { name: label }).click()
      await expect.poll(() => pathOf(page), label).toBe(path)
      await expect(more).toBeHidden()
      const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
      expect(sw, `${path} scrollWidth`).toBeLessThanOrEqual(cw)
    }
  })
})
