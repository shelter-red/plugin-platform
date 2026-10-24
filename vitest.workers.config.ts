import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'
import { outboundStub } from './worker/runtime/outbound-stub.ts'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        outboundService: outboundStub,
        bindings: {
          PLUGIN_DOMAIN_SUFFIX: 'plugins.example.com',
          CONSOLE_HOSTNAME: 'console.example.com',
          SESSION_SECRET: 'runtime-test-session-secret',
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
