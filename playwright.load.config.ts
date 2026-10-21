import { defineConfig } from '@playwright/test'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL ?? 'http://127.0.0.1:18888'

export default defineConfig({
  testDir: 'tests',
  outputDir: '/tmp/plugmesh-playwright-load',
  reporter: 'line',
  timeout: 600_000,
  workers: 1,
  use: { baseURL },
  testMatch: /load-stack\.spec\.ts/,
})
