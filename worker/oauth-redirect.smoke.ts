import { strict as assert } from 'node:assert'
import { normalizeOauthRedirectUri, parseGithubOAuthConfig } from './src/oauth-settings.ts'

assert.equal(normalizeOauthRedirectUri('http://platform.example.com/auth/github/callback'), 'https://platform.example.com/auth/github/callback')
assert.equal(normalizeOauthRedirectUri('https://platform.example.com/auth/github/callback'), 'https://platform.example.com/auth/github/callback')
assert.equal(normalizeOauthRedirectUri('http://localhost:8787/auth/github/callback'), 'http://localhost:8787/auth/github/callback')
assert.equal(normalizeOauthRedirectUri('http://127.0.0.1:8787/auth/github/callback'), 'http://127.0.0.1:8787/auth/github/callback')
assert.equal(normalizeOauthRedirectUri('not-a-url'), 'not-a-url')

const parsed = parseGithubOAuthConfig({ clientId: 'client', clientSecret: 'secret', redirectUri: 'http://platform.example.com/auth/github/callback', allowlist: 'admin' })
assert.equal(parsed?.redirectUri, 'https://platform.example.com/auth/github/callback')

console.log('OAuth redirect URI smoke test passed')
