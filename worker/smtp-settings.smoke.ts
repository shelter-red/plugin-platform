import { strict as assert } from 'node:assert'
import { smtpSettingsApi, smtpTestApi } from './src/index.ts'
import { decryptSecret } from './src/secrets.ts'
import type { AuthenticatedUser, Env } from './src/types.ts'

const user: AuthenticatedUser = { id: 'admin-1', github_id: '1', email: 'admin@example.test', display_name: 'Admin', role: 'super_admin' }
const secret = 'smtp-settings-smoke-secret'
const payload = { host: 'smtp.example.test', port: 587, secure: false, username: 'mailer', password: 'first-secret', authType: 'plain', from: 'noreply@example.test', fromName: 'Plugmesh', replyTo: '' }

function createEnvironment() {
  let stored: { ciphertext: string; iv: string; updated_at: string } | null = null
  const audits: Array<{ action: string; detail: string }> = []
  const database = {
    prepare(sql: string) {
      let values: unknown[] = []
      const query = {
        bind: (...next: unknown[]) => {
          values = next
          return query
        },
        first: async <T>() => (sql.includes('FROM smtp_settings') ? stored as T : null as T),
        run: async () => {
          if (sql.startsWith('INSERT INTO smtp_settings')) stored = { ciphertext: String(values[1]), iv: String(values[2]), updated_at: String(values[3]) }
          if (sql.startsWith('DELETE FROM smtp_settings')) stored = null
          if (sql.includes('INSERT INTO audit_log')) audits.push({ action: String(values[2]), detail: String(values[3]) })
          return { meta: { changes: 1 } }
        },
      }
      return query
    },
  }
  return { env: { DB: database, SESSION_SECRET: secret } as unknown as Env, audits, readStored: () => stored }
}

const request = (path: string, method: string, body: unknown) => new Request(`https://console.example.test${path}`, { method, body: JSON.stringify(body) })
const readStoredSettings = async (stored: { ciphertext: string; iv: string }) => JSON.parse(await decryptSecret(secret, stored.ciphertext, stored.iv)) as Record<string, unknown>

{
  // 首次保存：密码写入密文，响应不回显密码。
  const { env, audits, readStored } = createEnvironment()
  const response = await smtpSettingsApi(request('/api/settings/smtp', 'PUT', payload), env, user)
  assert.equal(response.status, 200)
  const body = await response.json() as Record<string, unknown>
  assert.equal(body.configured, true)
  assert.equal(body.password, undefined)
  assert.equal((await readStoredSettings(readStored()!)).password, 'first-secret')
  assert.equal(audits[0].action, 'smtp.settings.updated')
  assert.equal(audits[0].detail.includes('first-secret'), false)

  // 空密码二次保存：沿用已存密钥，其余字段允许修改。
  const second = await smtpSettingsApi(request('/api/settings/smtp', 'PUT', { ...payload, username: 'mailer-2', password: '' }), env, user)
  assert.equal(second.status, 200)
  const stored = await readStoredSettings(readStored()!) as Record<string, unknown>
  assert.equal(stored.password, 'first-secret')
  assert.equal(stored.username, 'mailer-2')
}

{
  // 无历史密钥时，空密码返回字段级 400。
  const { env } = createEnvironment()
  const response = await smtpSettingsApi(request('/api/settings/smtp', 'PUT', { ...payload, password: '' }), env, user)
  assert.equal(response.status, 400)
  assert.equal((await response.json() as Record<string, unknown>).field, 'password')
}

{
  // 其它字段错误同样带 field，前端可定位输入框。
  const { env } = createEnvironment()
  for (const [override, field] of [[{ port: 25 }, 'port'], [{ from: 'not-an-email' }, 'from'], [{ host: 'bad host' }, 'host']] as const) {
    const response = await smtpSettingsApi(request('/api/settings/smtp', 'PUT', { ...payload, ...override }), env, user)
    assert.equal(response.status, 400)
    assert.equal((await response.json() as Record<string, unknown>).field, field)
  }
}

{
  // 测试接口接收未保存的表单配置：校验失败在发送前返回，不需要真实 SMTP。
  const { env } = createEnvironment()
  const invalidHost = await smtpTestApi(request('/api/settings/smtp/test', 'POST', { to: 'ops@example.test', settings: { ...payload, host: 'bad host' } }), env, user)
  assert.equal(invalidHost.status, 400)
  assert.equal((await invalidHost.json() as Record<string, unknown>).field, 'host')

  const missingPassword = await smtpTestApi(request('/api/settings/smtp/test', 'POST', { to: 'ops@example.test', settings: { ...payload, password: '' } }), env, user)
  assert.equal(missingPassword.status, 400)
  assert.equal((await missingPassword.json() as Record<string, unknown>).field, 'password')

  const invalidRecipient = await smtpTestApi(request('/api/settings/smtp/test', 'POST', { to: 'nope' }), env, user)
  assert.equal(invalidRecipient.status, 400)
  assert.equal((await invalidRecipient.json() as Record<string, unknown>).field, 'to')

  const unconfigured = await smtpTestApi(request('/api/settings/smtp/test', 'POST', { to: 'ops@example.test' }), env, user)
  assert.equal(unconfigured.status, 409)
}

console.log('smtp-settings smoke passed')
