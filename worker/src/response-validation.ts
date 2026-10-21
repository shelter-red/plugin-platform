export function parseResponseStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 200 && value <= 599 ? value : null
}

export function responseHeaders(value: unknown): Headers {
  const headers = new Headers()
  if (!value || typeof value !== 'object') return headers
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string' || key.toLowerCase() === 'x-plugmesh-bridge-error') continue
    try {
      headers.set(key, item)
    } catch {
      // Ignore a single malformed plugin header and preserve the response.
    }
  }
  return headers
}
