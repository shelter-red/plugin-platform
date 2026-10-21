import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests',
  outputDir: '/tmp/plugmesh-playwright-multi-isolate',
  reporter: 'line',
  timeout: 60_000,
  workers: 1,
  testMatch: /multi-isolate-stack\.spec\.ts/,
})
