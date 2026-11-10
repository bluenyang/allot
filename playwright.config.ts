import { defineConfig } from '@playwright/test'

// E2E against a running stack (docker compose -f docker/compose.dev.yaml up -d --build -V --wait).
//   BASE=http://<host>:15173 ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm e2e
// Uses the system Chrome (channel: 'chrome'), so no browser download is needed.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: process.env.BASE ?? 'http://localhost:15173',
    channel: 'chrome',
    storageState: 'tests/e2e/.auth.json',
    trace: 'off',
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
  },
})
