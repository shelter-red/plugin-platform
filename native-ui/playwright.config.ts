import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 设置 PLUGMESH_NATIVE_UI_SMOKE_URL 时复用已在运行的服务（例如 Windows 构建产物在 Wine 下运行）。
const externalBaseUrl = process.env.PLUGMESH_NATIVE_UI_SMOKE_URL

export default defineConfig({
  testDir: '.',
  testMatch: ['session-ui.spec.ts', 'setup-ui.spec.ts'],
  outputDir: join(tmpdir(), 'plugmesh-native-ui-playwright'),
  reporter: 'line',
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:18771',
    trace: 'retain-on-failure',
  },
  webServer: externalBaseUrl ? undefined : [
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
