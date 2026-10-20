export type PublicRequestMode = 'http' | 'sse' | 'file' | 'websocket'

type RequestCapabilities = {
  http: boolean
  websocket: boolean
  sse: boolean
  fileStream: boolean
}

export function selectPublicRequestMode(request: Request, manifestJson: string): PublicRequestMode | null {
  const capabilities = readCapabilities(manifestJson)
  if (!capabilities) return null
  if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return capabilities.websocket ? 'websocket' : null
  if (request.headers.get('accept')?.toLowerCase().includes('text/event-stream')) return capabilities.sse ? 'sse' : null
  if (request.headers.get('x-plugmesh-file-stream')?.toLowerCase() === 'true') return capabilities.fileStream ? 'file' : null
  if (capabilities.http) return 'http'
  return capabilities.fileStream ? 'file' : null
}

function readCapabilities(manifestJson: string): RequestCapabilities | null {
  try {
    const value = JSON.parse(manifestJson) as { capabilities?: unknown }
    if (!value || typeof value !== 'object' || !value.capabilities || typeof value.capabilities !== 'object') return null
    const capabilities = value.capabilities as Partial<RequestCapabilities>
    if (typeof capabilities.http !== 'boolean' || typeof capabilities.websocket !== 'boolean' || typeof capabilities.sse !== 'boolean' || typeof capabilities.fileStream !== 'boolean') return null
    return capabilities as RequestCapabilities
  } catch {
    return null
  }
}
