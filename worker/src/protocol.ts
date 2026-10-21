import type { ControlFrame, PluginManifest } from './types'

export const PROTOCOL_VERSION = 1 as const
export const MAX_CONTROL_FRAME_BYTES = 64 * 1024
export const SUPPORTED_PLUGIN_ABI_VERSIONS = ['2', '3'] as const

export function makeFrame(type: string, serverId: string, payload: Record<string, unknown> = {}, pluginId?: string): ControlFrame {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type,
    requestId: crypto.randomUUID(),
    serverId,
    ...(pluginId ? { pluginId } : {}),
    timestamp: new Date().toISOString(),
    nonce: crypto.randomUUID(),
    payload,
  }
}

export function parseControlFrame(raw: string): ControlFrame | null {
  if (new TextEncoder().encode(raw).byteLength > MAX_CONTROL_FRAME_BYTES) return null
  try {
    const value = JSON.parse(raw) as Partial<ControlFrame>
    if (value.protocolVersion !== PROTOCOL_VERSION || typeof value.type !== 'string' || typeof value.serverId !== 'string' || typeof value.requestId !== 'string') return null
    if (typeof value.timestamp !== 'string' || typeof value.nonce !== 'string') return null
    return value as ControlFrame
  } catch {
    return null
  }
}

export function isManifest(value: unknown): value is PluginManifest {
  if (!value || typeof value !== 'object') return false
  const manifest = value as Partial<PluginManifest>
  const capabilities = manifest.capabilities
  return typeof manifest.id === 'string' && manifest.id.length > 0 && typeof manifest.name === 'string' && manifest.name.length > 0 && typeof manifest.version === 'string' && manifest.version.length > 0 && SUPPORTED_PLUGIN_ABI_VERSIONS.includes(manifest.abiVersion as typeof SUPPORTED_PLUGIN_ABI_VERSIONS[number]) && typeof manifest.library === 'string' && manifest.library.length > 0 && typeof manifest.healthPath === 'string' && manifest.healthPath.length > 0 && !!capabilities && typeof capabilities === 'object' && ['http', 'websocket', 'sse', 'fileStream'].every((key) => typeof capabilities[key as keyof typeof capabilities] === 'boolean') && Array.isArray(manifest.permissions) && manifest.permissions.every((item) => typeof item === 'string')
}
