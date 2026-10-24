import { getCookie } from './cookies'
import type { AuthenticatedUser, Env } from './types'

const SESSION_COOKIE = 'plugmesh_session'
const ADMIN_CREDENTIAL_ID = 'primary'
export const MIN_PASSWORD_LENGTH = 12
const PASSWORD_ITERATIONS = 310000

export function sessionCookie(token: string, secure: boolean): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure ? '; Secure' : ''}`
}

export function clearSessionCookie(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

export async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

function fromBase64(value: string): Uint8Array {
  const decoded = atob(value)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index)
  return bytes
}

async function derivePassword(password: string, salt: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PASSWORD_ITERATIONS, hash: 'SHA-256' }, material, 256)
  return toBase64(new Uint8Array(bits))
}

export async function hashPassword(password: string): Promise<{ passwordHash: string; passwordSalt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return { passwordHash: await derivePassword(password, salt), passwordSalt: toBase64(salt) }
}

export async function verifyPassword(password: string, passwordHash: string, passwordSalt: string): Promise<boolean> {
  const expected = fromBase64(passwordHash)
  const actual = fromBase64(await derivePassword(password, fromBase64(passwordSalt)))
  if (expected.length !== actual.length) return false
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index]! ^ actual[index]!
  return difference === 0
}

export async function hasAdminPassword(env: Env): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM admin_credentials WHERE id = ?').bind(ADMIN_CREDENTIAL_ID).first<{ id: string }>()
  return Boolean(row)
}

async function ensureAdminUser(env: Env): Promise<string> {
  const existing = await env.DB.prepare('SELECT id FROM users WHERE role = ? ORDER BY created_at ASC LIMIT 1').bind('super_admin').first<{ id: string }>()
  if (existing) return existing.id
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await env.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, 'password-admin', 'admin@local', 'Administrator', 'super_admin', now).run()
  await env.DB.batch([
    env.DB.prepare('UPDATE workspaces SET created_by = ? WHERE id = ? AND created_by IS NULL').bind(id, 'ws_default'),
    env.DB.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role').bind('ws_default', id, 'owner', now),
  ])
  return id
}

export async function setAdminPassword(env: Env, password: string): Promise<void> {
  const { passwordHash, passwordSalt } = await hashPassword(password)
  const now = new Date().toISOString()
  const userId = await ensureAdminUser(env)
  await env.DB.batch([
    env.DB.prepare('INSERT INTO admin_credentials (id, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, password_salt = excluded.password_salt, updated_at = excluded.updated_at').bind(ADMIN_CREDENTIAL_ID, passwordHash, passwordSalt, now, now),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('DELETE FROM oauth_states'),
    env.DB.prepare('DELETE FROM invites'),
    env.DB.prepare('DELETE FROM registration_codes'),
  ])
  await env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, NULL, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), null, userId, 'setup.password.configured', JSON.stringify({ passwordPolicy: `minimum-${MIN_PASSWORD_LENGTH}` }), now).run()
}

export async function authenticatePassword(env: Env, password: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT password_hash, password_salt FROM admin_credentials WHERE id = ?').bind(ADMIN_CREDENTIAL_ID).first<{ password_hash: string; password_salt: string }>()
  if (!row || !await verifyPassword(password, row.password_hash, row.password_salt)) return null
  return ensureAdminUser(env)
}

export async function getCurrentUser(request: Request, env: Env): Promise<AuthenticatedUser | null> {
  const token = getCookie(request, SESSION_COOKIE)
  if (!token) return null
  const session = await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await digest(token), new Date().toISOString()).first<{ user_id: string }>()
  if (!session) return null
  return env.DB.prepare('SELECT id, github_id, email, display_name, role FROM users WHERE id = ?').bind(session.user_id).first<AuthenticatedUser>()
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID()
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, await digest(token), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), new Date().toISOString()).run()
  return token
}
