import { defineConfig } from '@playwright/test'

// End-to-end tests drive the built Electron app (out/), so run `npm run build` first
// (`npm run test:e2e` does both). One worker: each test launches its own app window.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
})
