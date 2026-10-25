import { env, SELF } from 'cloudflare:test'
import { makeFrame } from '../src/protocol'
import type { ControlFrame, Env, PluginManifest } from '../src/types'

export const testEnv = env as unknown as Env
export const CONTROL_TOKEN = 'runtime-control-token'
const SERVER_ID = 'server-runtime'
const PLUGIN_INSTANCE_ID = 'plugin-runtime'
const PLUGIN_ID = 'sample.runtime'
export const DEFAULT_WORKSPACE_ID = 'ws_default'

export const manifest: PluginManifest = {
  id: PLUGIN_ID,
  name: 'Runtime sample',
  version: '1.2.0',
  abiVersion: '1',
  library: 'libsample.so',
  capabilities: { http: true, websocket: true, sse: true, fileStream: true },
  permissions: [],
  healthPath: '/health',
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function resetDatabase(): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare('DELETE FROM workspace_members'),
    testEnv.DB.prepare('DELETE FROM workspaces'),
    testEnv.DB.prepare('DELETE FROM request_logs'),
    testEnv.DB.prepare('DELETE FROM domains'),
    testEnv.DB.prepare('DELETE FROM plugin_instances'),
    testEnv.DB.prepare('DELETE FROM servers'),
    testEnv.DB.prepare('DELETE FROM registration_codes'),
    testEnv.DB.prepare('DELETE FROM audit_log'),
    testEnv.DB.prepare('DELETE FROM temp_objects'),
    testEnv.DB.prepare('DELETE FROM usage_snapshots'),
    testEnv.DB.prepare('DELETE FROM usage_cache'),
    testEnv.DB.prepare('DELETE FROM platform_usage'),
    testEnv.DB.prepare('DELETE FROM platform_settings'),
    testEnv.DB.prepare('DELETE FROM sessions'),
    testEnv.DB.prepare('DELETE FROM oauth_states'),
    testEnv.DB.prepare('DELETE FROM invites'),
    testEnv.DB.prepare('DELETE FROM smtp_settings'),
    testEnv.DB.prepare('DELETE FROM admin_credentials'),
    testEnv.DB.prepare('DELETE FROM oauth_settings'),
    testEnv.DB.prepare('DELETE FROM cloudflare_credentials'),
    testEnv.DB.prepare('DELETE FROM users'),
  ])
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare("INSERT INTO workspaces (id, name, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(DEFAULT_WORKSPACE_ID, '默认工作区', 'default', null, now, now),
    testEnv.DB.prepare("INSERT INTO admin_credentials (id, password_hash, password_salt, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind('primary', 'AA==', 'AA==', now, now),
  ])
}

export async function addWorkspaceMember(userId: string, role: 'owner' | 'operator' | 'viewer' = 'owner', workspaceId = DEFAULT_WORKSPACE_ID): Promise<void> {
  await testEnv.DB.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role')
    .bind(workspaceId, userId, role, new Date().toISOString()).run()
}

export async function seedServer(options: { pluginState?: string; domainStatus?: string } = {}): Promise<string> {
  const hostname = `runtime-${crypto.randomUUID().slice(0, 8)}.plugins.example.com`
  const now = new Date().toISOString()
  await testEnv.DB.batch([
    testEnv.DB.prepare('INSERT INTO users (id, github_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('user-runtime', 'gh-runtime', 'owner@example.com', 'Runtime Owner', 'member', now),
    testEnv.DB.prepare('INSERT INTO workspace_members (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').bind(DEFAULT_WORKSPACE_ID, 'user-runtime', 'owner', now),
    testEnv.DB.prepare('INSERT INTO servers (id, user_id, workspace_id, name, token_hash, status, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(SERVER_ID, 'user-runtime', DEFAULT_WORKSPACE_ID, 'Runtime server', await hashToken(CONTROL_TOKEN), 'offline', null, now),
    testEnv.DB.prepare('INSERT INTO plugin_instances (id, user_id, workspace_id, server_id, plugin_id, name, version, state, desired_state, manifest_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(PLUGIN_INSTANCE_ID, 'user-runtime', DEFAULT_WORKSPACE_ID, SERVER_ID, PLUGIN_ID, manifest.name, manifest.version, options.pluginState ?? 'enabled', 'enabled', JSON.stringify(manifest), now, now),
    testEnv.DB.prepare('INSERT INTO domains (id, user_id, workspace_id, plugin_instance_id, hostname, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('domain-runtime', 'user-runtime', DEFAULT_WORKSPACE_ID, PLUGIN_INSTANCE_ID, hostname, options.domainStatus ?? 'online', now),
  ])
  return hostname
}

async function waitForServerStatus(expected: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = await testEnv.DB.prepare('SELECT status FROM servers WHERE id = ?').bind(SERVER_ID).first<{ status: string }>()
    if (row?.status === expected) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`server status did not become ${expected}`)
}

export function connectControl(token = CONTROL_TOKEN): Promise<WebSocket> {
  return SELF.fetch(`https://console.example.com/control/connect?serverId=${SERVER_ID}`, {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${token}` },
  }).then((response) => {
    if (response.status !== 101 || !response.webSocket) throw new Error(`control connection failed with ${response.status}: ${response.statusText}`)
    const socket = response.webSocket
    socket.accept()
    return socket
  })
}

type FrameWaiter = {
  next: () => Promise<ControlFrame>
  close: () => void
}

function frameChannel(socket: WebSocket): FrameWaiter {
  const queued: ControlFrame[] = []
  const waiters: Array<{ resolve: (frame: ControlFrame) => void; reject: (error: Error) => void }> = []
  const listener = (event: MessageEvent) => {
    if (typeof event.data !== 'string') return
    const frame = JSON.parse(event.data) as ControlFrame
    const waiter = waiters.shift()
    if (waiter) waiter.resolve(frame)
    else queued.push(frame)
  }
  socket.addEventListener('message', listener)
  return {
    next: () => {
      const frame = queued.shift()
      if (frame) return Promise.resolve(frame)
      return new Promise<ControlFrame>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('control frame timeout')), 5_000)
        waiters.push({ resolve: (value) => { clearTimeout(timer); resolve(value) }, reject })
      })
    },
    close: () => socket.removeEventListener('message', listener),
  }
}

export function sendFrame(socket: WebSocket, type: string, payload: Record<string, unknown> = {}, requestId?: string): string {
  const frame = makeFrame(type, SERVER_ID, payload)
  if (requestId) frame.requestId = requestId
  socket.send(JSON.stringify(frame))
  return frame.requestId
}

export async function openControl(): Promise<{ socket: WebSocket; channel: FrameWaiter }> {
  const socket = await connectControl()
  const channel = frameChannel(socket)
  const hello = await channel.next()
  if (hello.type !== 'hello') throw new Error(`expected hello, received ${hello.type}`)
  sendFrame(socket, 'server.heartbeat')
  await waitForServerStatus('online')
  return { socket, channel }
}

export function reply(socket: WebSocket, frame: ControlFrame, status: number, body: string, headers: Record<string, string> = {}): void {
  const requestId = frame.requestId
  sendFrame(socket, 'request.open', { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...headers } }, requestId)
  sendFrame(socket, 'request.chunk', { data: btoa(body), encoding: 'base64' }, requestId)
  sendFrame(socket, 'request.close', {}, requestId)
}

export function publicRequest(hostname: string, path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`https://${hostname}${path}`, init)
}

export function decodeBody(payload: Record<string, unknown> | undefined): string {
  const encoded = typeof payload?.body === 'string' ? payload.body : ''
  return encoded ? atob(encoded) : ''
}
