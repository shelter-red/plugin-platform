import { strict as assert } from 'node:assert'
import { oauthSettingsApi } from './src/oauth-settings.ts'
import type { AuthenticatedUser, Env } from './src/types.ts'

const admin: AuthenticatedUser = { id: 'admin-1', github_id: '1', email: 'admin@example.test', display_name: 'Admin', role: 'super_admin' }
const member: AuthenticatedUser = { id: 'member-1', github_id: '2', email: 'member@example.test', display_name: 'Member', role: 'member' }

function createEnvironment() {
  let stored: { ciphertext: string; iv: string; updated_at: string } | null = null
  const audits: string[] = []
  const database = {
    prepare(sql: string) {
      let values: unknown[] = []
      const query = {
        bind: (...next: unknown[]) => {
          values = next
          return query
        },
        first: async <T>() => (sql.includes('FROM oauth_settings') ? stored as T : null as T),
        run: async () => {
          if (sql.startsWith('INSERT INTO oauth_settings')) stored = { ciphertext: String(values[1]), iv: String(values[2]), updated_at: String(values[3]) }
          if (sql.startsWith('DELETE FROM oauth_settings')) stored = null
          if (sql.includes('INSERT INTO audit_log')) audits.push(String(values[2]))
          return { meta: { changes: 1 } }
        },
      }
      return query
    },
  }
  const env = {
    DB: database,
    SESSION_SECRET: 'oauth-settings-smoke-secret',
  } as unknown as Env
  return { env, audits }
}

const request = (method: string, body?: unknown) => new Request('https://console.example.test/api/settings/oauth', { method, body: body === undefined ? undefined : JSON.stringify(body) })

{
  const { env, audits } = createEnvironment()
  const initial = await oauthSettingsApi(request('GET'), env, admin)
  assert.equal(initial.status, 200)
  const initialBody = await initial.json() as Record<string, unknown>
  assert.equal((initialBody.github as Record<string, unknown>).configured, false)
  assert.equal(Object.hasOwn(initialBody, 'cloudflare'), false)

  const forbidden = await oauthSettingsApi(request('GET'), env, member)
  assert.equal(forbidden.status, 403)

  const saved = await oauthSettingsApi(request('PUT', {
    github: {
      clientId: 'github-client',
      clientSecret: 'github-secret',
      redirectUri: 'https://console.example.test/auth/github/callback',
      allowlist: 'admin@example.test',
    },
  }), env, admin)
  assert.equal(saved.status, 200)
  assert.equal(JSON.stringify(await saved.json()).includes('github-secret'), false)
  assert.deepEqual(audits, ['oauth.settings.updated'])
}

{
  const { env } = createEnvironment()
  const cloudflare = await oauthSettingsApi(request('PUT', {
    cloudflare: { clientId: 'old-client', clientSecret: 'old-secret' },
  }), env, admin)
  assert.equal(cloudflare.status, 400)
}

console.log('OAuth settings smoke test passed')
