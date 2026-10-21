import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'
import { outboundStub } from './worker/runtime/outbound-stub.ts'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './worker/wrangler.toml' },
      miniflare: {
        outboundService: outboundStub,
        bindings: {
          PLUGIN_DOMAIN_SUFFIX: 'plugins.example.com',
          SESSION_SECRET: 'runtime-test-session-secret',
          SETUP_TOKEN: 'runtime-setup-token',
          GITHUB_CLIENT_ID: 'runtime-github-client',
          GITHUB_CLIENT_SECRET: 'runtime-github-secret',
          GITHUB_REDIRECT_URI: 'https://console.example.com/auth/github/callback',
          GITHUB_ALLOWLIST: 'runtime-admin',
          CLOUDFLARE_OAUTH_CLIENT_ID: 'cf-test-client',
          CLOUDFLARE_OAUTH_CLIENT_SECRET: 'cf-test-secret',
          CLOUDFLARE_OAUTH_REDIRECT_URI: 'https://console.example.com/auth/cloudflare/callback',
          CLOUDFLARE_OAUTH_SCOPE: 'workers-platform.read workers-platform.write',
          TEST_MIGRATIONS: await readD1Migrations(path.join(root, 'worker/migrations')),
        },
      },
    }),
  ],
  test: {
    include: ['worker/runtime/**/*.test.ts'],
    setupFiles: ['worker/runtime/setup.ts'],
    globalSetup: ['worker/runtime/smtp-sink.setup.ts'],
  },
}))
