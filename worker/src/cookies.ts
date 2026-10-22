/** 读取单个 Cookie；写入端使用 encodeURIComponent，因此读取时对称解码。 */
export function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key !== name) continue
    const raw = value.join('=')
    if (!raw) return null
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }
  return null
}
