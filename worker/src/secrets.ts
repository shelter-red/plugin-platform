function toBase64(bytes: Uint8Array): string {
  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

async function deriveKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, usages)
}

export async function encryptSecret(secret: string, value: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveKey(secret, ['encrypt']), new TextEncoder().encode(value))
  return { ciphertext: toBase64(new Uint8Array(encrypted)), iv: toBase64(iv) }
}

function fromBase64(value: string): Uint8Array {
  const decoded = atob(value)
  const bytes = new Uint8Array(decoded.length)
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index)
  return bytes
}

export async function decryptSecret(secret: string, ciphertext: string, iv: string): Promise<string> {
  const ivBytes = fromBase64(iv)
  const ciphertextBytes = fromBase64(ciphertext)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes as unknown as BufferSource }, await deriveKey(secret, ['decrypt']), ciphertextBytes as unknown as BufferSource)
  return new TextDecoder().decode(decrypted)
}
