import { defineConfig } from '@playwright/test'

const previewUrl = 'http://127.0.0.1:4183'
const workerMockUrl = 'http://127.0.0.1:4184'
const authUrl = 'http://127.0.0.1:4185'

export default defineConfig({
  outputDir: '/tmp/plugmesh-playwright',
  // CI 上偶发的超时/竞态用 1 次重试兜底；同时保留 HTML 报告与 trace 便于定位。
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: '/tmp/plugmesh-playwright-report', open: 'never' }], ['json', { outputFile: '/tmp/plugmesh-playwright-report/results.json' }]]
    : 'line',
  use: {
    trace: 'retain-on-failure',
  },
  // CI 容器里 Playwright 会并行跑多个 project，共用一台 Vite dev server 做冷启动，
  // 加上 AntD 首屏渲染，实测单次页面加载能到 6s 以上，断言偶发在 5s 内还等不到 DOM。
  // 这些断言检查的是「最终呈现什么」而不是「多快出现」，所以 CI 放宽到 15s：慢不再
  // 误报成坏，缺功能或状态错仍然会失败。
  expect: {
    timeout: process.env.CI ? 15_000 : 5_000,
    // 像素基线在不同 Ubuntu/字体环境下会有 1%-3% 的抗锯齿差异（CJK 回退字体不同），
    // 放任 0 容差会让 CI 频繁误报；结构性回归仍然远高于该比例。
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
