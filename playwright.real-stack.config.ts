import { defineConfig } from '@playwright/test'

const baseURL = process.env.PLUGMESH_REAL_STACK_URL ?? 'http://127.0.0.1:18889'

export default defineConfig({
  outputDir: '/tmp/plugmesh-playwright-real-stack',
  reporter: 'line',
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  testMatch: /console-real-stack\.spec\.ts/,
})
