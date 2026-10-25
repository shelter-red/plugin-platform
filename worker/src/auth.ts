import { getCookie } from './cookies'
import type { AuthenticatedUser, Env } from './types'

const SESSION_COOKIE = 'plugmesh_session'
const ADMIN_CREDENTIAL_ID = 'primary'
export const MIN_PASSWORD_LENGTH = 12
export const MAX_PASSWORD_LENGTH = 1024
const PASSWORD_HASH_ALGORITHM = 'pbkdf2-sha256'
const PASSWORD_ITERATIONS = 100000
const LEGACY_PASSWORD_ITERATIONS = 310000

export type AdminPasswordState = 'configured' | 'unconfigured' | 'migration_required'
export type AdminPasswordSetupErrorCode = 'password_derivation_failed' | 'database_write_failed'

export class AdminPasswordSetupError extends Error {
  constructor(readonly code: AdminPasswordSetupErrorCode, cause: unknown) {
    super(code, { cause })
    this.name = 'AdminPasswordSetupError'
  }
}

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

async function derivePassword(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' }, material, 256)
  return toBase64(new Uint8Array(bits))
}

export async function hashPassword(password: string): Promise<{ passwordHash: string; passwordSalt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const derived = await derivePassword(password, salt, PASSWORD_ITERATIONS)
  return { passwordHash: `${PASSWORD_HASH_ALGORITHM}$${PASSWORD_ITERATIONS}$${derived}`, passwordSalt: toBase64(salt) }
}

export async function verifyPassword(password: string, passwordHash: string, passwordSalt: string): Promise<boolean> {
  try {
    const parts = passwordHash.split('$')
    const versioned = parts.length === 3 && parts[0] === PASSWORD_HASH_ALGORITHM
    const iterations = versioned ? Number(parts[1]) : LEGACY_PASSWORD_ITERATIONS
    const encodedHash = versioned ? parts[2]! : passwordHash
    if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > LEGACY_PASSWORD_ITERATIONS) return false
    const expected = fromBase64(encodedHash)
    const actual = fromBase64(await derivePassword(password, fromBase64(passwordSalt), iterations))
    if (expected.length !== actual.length) return false
    let difference = 0
    for (let index = 0; index < expected.length; index += 1) difference |= expected[index]! ^ actual[index]!
    return difference === 0
  } catch {
    return false
  }
}

export async function getAdminPasswordState(env: Env): Promise<AdminPasswordState> {
  try {
    const row = await env.DB.prepare('SELECT id FROM admin_credentials WHERE id = ?').bind(ADMIN_CREDENTIAL_ID).first<{ id: string }>()
    return row ? 'configured' : 'unconfigured'
  } catch (error) {
    const table = await env.DB.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?").bind('admin_credentials').first<{ present: number }>()
    if (!table) return 'migration_required'
    throw error
  }
}

async function findAdminUser(env: Env): Promise<{ id: string; role: string } | null> {
  const existing = await env.DB.prepare('SELECT id FROM users WHERE role = ? ORDER BY created_at ASC LIMIT 1').bind('super_admin').first<{ id: string }>()
  if (existing) return { id: existing.id, role: 'super_admin' }
  return env.DB.prepare('SELECT id, role FROM users WHERE github_id = ? LIMIT 1').bind('password-admin').first<{ id: string; role: string }>()
}

function adminProvisioningStatements(env: Env, existing: { id: string; role: string } | null, userId: string, now: string): D1PreparedStatement[] {
  return [
    existing
      ? env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind('super_admin', userId)
      : env.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(userId, 'password-admin', 'admin@local', 'Administrator', 'super_admin', now),
    env.DB.prepare('UPDATE workspaces SET created_by = ? WHERE id = ? AND created_by IS NULL').bind(userId, 'ws_default'),
    env.DB.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role').bind('ws_default', userId, 'owner', now),
  ]
}

async function ensureAdminUser(env: Env): Promise<string> {
  const existing = await findAdminUser(env)
  if (existing?.role === 'super_admin') return existing.id
  const now = new Date().toISOString()
  const userId = existing?.id ?? crypto.randomUUID()
  await env.DB.batch(adminProvisioningStatements(env, existing, userId, now))
  return userId
}

export async function setAdminPassword(env: Env, password: string): Promise<void> {
  let credential: Awaited<ReturnType<typeof hashPassword>>
  try {
    credential = await hashPassword(password)
  } catch (error) {
    throw new AdminPasswordSetupError('password_derivation_failed', error)
  }

  const now = new Date().toISOString()
  try {
    const existing = await findAdminUser(env)
    const userId = existing?.id ?? crypto.randomUUID()
    await env.DB.batch([
      ...adminProvisioningStatements(env, existing, userId, now),
      env.DB.prepare('INSERT INTO admin_credentials (id, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, password_salt = excluded.password_salt, updated_at = excluded.updated_at').bind(ADMIN_CREDENTIAL_ID, credential.passwordHash, credential.passwordSalt, now, now),
      env.DB.prepare('DELETE FROM sessions'),
      env.DB.prepare('DELETE FROM oauth_states'),
      env.DB.prepare('DELETE FROM invites'),
      env.DB.prepare('DELETE FROM registration_codes'),
      env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, 'setup.password.configured', JSON.stringify({ passwordPolicy: `minimum-${MIN_PASSWORD_LENGTH}` }), now),
    ])
  } catch (error) {
    throw new AdminPasswordSetupError('database_write_failed', error)
  }
}

export async function changeAdminPassword(env: Env, currentPassword: string, nextPassword: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT password_hash, password_salt FROM admin_credentials WHERE id = ?').bind(ADMIN_CREDENTIAL_ID).first<{ password_hash: string; password_salt: string }>()
  if (!row || !await verifyPassword(currentPassword, row.password_hash, row.password_salt)) return false
  const { passwordHash, passwordSalt } = await hashPassword(nextPassword)
  const now = new Date().toISOString()
  const userId = await ensureAdminUser(env)
  await env.DB.batch([
    env.DB.prepare('UPDATE admin_credentials SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').bind(passwordHash, passwordSalt, now, ADMIN_CREDENTIAL_ID),
    env.DB.prepare('DELETE FROM sessions'),
    env.DB.prepare('INSERT INTO audit_log (id, workspace_id, user_id, action, detail_json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, 'auth.password.changed', JSON.stringify({ passwordPolicy: `minimum-${MIN_PASSWORD_LENGTH}` }), now),
  ])
  return true
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
  return env.DB.prepare('SELECT id, email, display_name, role FROM users WHERE id = ?').bind(session.user_id).first<AuthenticatedUser>()
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID()
  await env.DB.prepare('INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(crypto.randomUUID(), userId, await digest(token), new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), new Date().toISOString()).run()
  return token
}
