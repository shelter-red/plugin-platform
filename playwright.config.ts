import { defineConfig } from '@playwright/test'

const previewUrl = 'http://127.0.0.1:4183'
const workerMockUrl = 'http://127.0.0.1:4184'
const authUrl = 'http://127.0.0.1:4185'

export default defineConfig({
  outputDir: '/tmp/plugmesh-playwright',
  reporter: 'line',
  use: {
    trace: 'retain-on-failure',
  },
  // 像素基线在不同 Ubuntu/字体环境下会有 1%-3% 的抗锯齿差异（CJK 回退字体不同），
  // 放任 0 容差会让 CI 频繁误报；结构性回归仍然远高于该比例。
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.05, threshold: 0.3 },
  },
  projects: [
    { name: 'preview', testMatch: /console-ui\.spec\.ts/, use: { baseURL: previewUrl } },
    { name: 'a11y', testMatch: /console-a11y\.spec\.ts/, use: { baseURL: previewUrl } },
    { name: 'screenshots', testMatch: /console-screenshots\.spec\.ts/, use: { baseURL: previewUrl } },
    { name: 'worker-mock', testMatch: /console-worker\.spec\.ts/, use: { baseURL: workerMockUrl } },
    { name: 'auth', testMatch: /console-auth\.spec\.ts/, use: { baseURL: authUrl } },
  ],
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4183 --strictPort',
      url: previewUrl,
      env: { VITE_AUTH_ENABLED: 'false' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4184 --strictPort',
      url: workerMockUrl,
      env: { VITE_AUTH_ENABLED: 'false', VITE_API_BASE: workerMockUrl },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4185 --strictPort',
      url: authUrl,
      env: { VITE_AUTH_ENABLED: 'true' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
})
