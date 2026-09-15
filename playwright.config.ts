import { defineConfig, devices } from '@playwright/test'

// Browser smoke tests (e2e/). They run against a production build:
//   npm run build && npm run test:e2e
// The config starts `next start` itself on a port no dev server uses.
const PORT = process.env.SMOKE_PORT ?? '3499'
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Pages are built from the live site's public data in CI, so one retry
  // absorbs a transient network hiccup without hiding a real failure.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The page checks again at a phone size; the API and routing checks do
    // not depend on the viewport, so they run once.
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /public pages/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE_URL}/api/v1`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
