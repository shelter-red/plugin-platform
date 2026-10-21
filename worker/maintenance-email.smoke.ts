import { strict as assert } from 'node:assert'
import { encryptSecret } from './src/secrets.ts'
import type { Env, PlatformSettings } from './src/types.ts'
import { activateMaintenance, defaultPlatformSettings } from './src/usage.ts'

type Audit = { action: string; detail: string }

async function createEnvironment() {
  const secret = 'maintenance-email-smoke-secret'
  const smtpPassword = 'smtp-password-not-for-logs'
  const encrypted = await encryptSecret(secret, JSON.stringify({
    host: 'smtp.example.test',
    port: 465,
    secure: true,
    username: 'mailer',
    password: smtpPassword,
    authType: 'plain',
    from: 'noreply@example.test',
  }))
  const settings: PlatformSettings = { ...defaultPlatformSettings, maintenance: false }
  const audits: Audit[] = []
  const database = {
    prepare(sql: string) {
      let values: unknown[] = []
      const query = {
        bind: (...nextValues: unknown[]) => {
          values = nextValues
          return query
        },
        first: async <T>() => {
          if (sql.includes('FROM platform_settings')) return { value_json: JSON.stringify(settings) } as T
          if (sql.includes('FROM smtp_settings')) return encrypted as T
          return null as T
        },
        all: async <T>() => {
          if (sql.includes('FROM users')) return { results: [{ id: 'admin-1', email: 'admin@example.test' }] as T[] }
          return { results: [] }
        },
        run: async () => {
          if (sql.startsWith('UPDATE platform_settings')) {
            if (settings.maintenance) return { meta: { changes: 0 } }
            settings.maintenance = true
            return { meta: { changes: 1 } }
          }
          if (sql.includes('INSERT INTO audit_log')) audits.push({ action: String(values[2]), detail: String(values[3]) })
          return { meta: { changes: 1 } }
        },
      }
      return query
    },
  }
  return { env: { DB: database, SESSION_SECRET: secret } as unknown as Env, audits, settings, smtpPassword }
}

{
  const { env, audits, settings, smtpPassword } = await createEnvironment()
  let attempts = 0
  await activateMaintenance(env, 'request quota reached', async (smtp, to, reason) => {
    attempts += 1
    assert.equal(smtp.password, smtpPassword)
    assert.equal(to, 'admin@example.test')
    assert.equal(reason, 'request quota reached')
    if (attempts < 3) throw new Error('temporary SMTP failure')
  })

  assert.equal(settings.maintenance, true)
  assert.equal(attempts, 3)
  assert.equal(audits.length, 1)
  assert.equal(audits[0].action, 'maintenance.email.sent')
  assert.deepEqual(JSON.parse(audits[0].detail), { reason: 'request quota reached', administratorId: 'admin-1', attempts: 3 })
  assert.equal(audits[0].detail.includes(smtpPassword), false)
}

{
  const { env, audits, smtpPassword } = await createEnvironment()
  let attempts = 0
  await activateMaintenance(env, 'R2 storage quota reached', async () => {
    attempts += 1
    throw new Error('permanent SMTP failure')
  })

  assert.equal(attempts, 3)
  assert.equal(audits.length, 1)
  assert.equal(audits[0].action, 'maintenance.email.failed')
  assert.deepEqual(JSON.parse(audits[0].detail), { reason: 'R2 storage quota reached', administratorId: 'admin-1', attempts: 3 })
  assert.equal(audits[0].detail.includes(smtpPassword), false)
}

console.log('maintenance email retry smoke test passed')
