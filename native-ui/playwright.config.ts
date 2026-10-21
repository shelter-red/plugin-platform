import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  testDir: '.',
  testMatch: ['session-ui.spec.ts', 'setup-ui.spec.ts'],
  outputDir: join(tmpdir(), 'plugmesh-native-ui-playwright'),
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:18771',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node run-smoke-server.mjs authenticated 18771',
      url: 'http://127.0.0.1:18771/api/session',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'node run-smoke-server.mjs setup 18772',
      url: 'http://127.0.0.1:18772/api/session',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
