import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  outputDir: '/tmp/plugmesh-playwright',
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4183',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4183 --strictPort',
    url: 'http://127.0.0.1:4183',
    env: { VITE_AUTH_ENABLED: 'false' },
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
