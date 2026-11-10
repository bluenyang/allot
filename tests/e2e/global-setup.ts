import { chromium, type FullConfig } from '@playwright/test'

// Sign in once (the login rate limit is 5/min) and share the session with every test.
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set')
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ baseURL })
  await page.goto('/')
  await page.getByLabel('이메일').fill(ADMIN_EMAIL)
  await page.getByLabel('비밀번호').fill(ADMIN_PASSWORD)
  await page.getByRole('button', { name: '로그인' }).click()
  await page.getByRole('tab', { name: '이번 달' }).waitFor({ timeout: 15_000 })
  await page.context().storageState({ path: 'tests/e2e/.auth.json' })
  await browser.close()
}
