export function parseResponseStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 599 ? value : null
}

export function responseHeaders(value: unknown): Headers {
  const headers = new Headers()
  if (!value || typeof value !== 'object') return headers
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === 'x-plugmesh-bridge-error') continue
    const values = typeof item === 'string' ? [item] : Array.isArray(item) ? item : []
    for (const headerValue of values) {
      if (typeof headerValue !== 'string') continue
      try {
        // 数组值表示重复响应头，例如多个 Set-Cookie；单值保持原有字符串协议。
        headers.append(key, headerValue)
      } catch {
        // Ignore a single malformed plugin header and preserve the response.
      }
    }
  }
  return headers
}
