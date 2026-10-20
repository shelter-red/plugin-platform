export type SmtpAuthType = 'plain' | 'login' | 'cram-md5'

export interface SmtpSettings {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  authType: SmtpAuthType
  from: string
  fromName?: string
  replyTo?: string
}

export function parseSmtpSettings(value: unknown): SmtpSettings | null {
  if (!value || typeof value !== 'object') return null
  const input = value as Partial<SmtpSettings>
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  const port = typeof input.port === 'number' ? input.port : Number(input.port)
  const authType = input.authType
  const username = typeof input.username === 'string' ? input.username.trim() : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const from = typeof input.from === 'string' ? input.from.trim() : ''
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 25) return null
  if (authType !== 'plain' && authType !== 'login' && authType !== 'cram-md5') return null
  if (!username || !password || !isEmail(from)) return null
  return { host, port, secure: Boolean(input.secure), username, password, authType, from, ...(input.fromName?.trim() ? { fromName: input.fromName.trim() } : {}), ...(input.replyTo?.trim() ? { replyTo: input.replyTo.trim() } : {}) }
}

export function publicSmtpSettings(settings: SmtpSettings, updatedAt: string) {
  return { configured: true, host: settings.host, port: settings.port, secure: settings.secure, username: settings.username, authType: settings.authType, from: settings.from, fromName: settings.fromName ?? null, replyTo: settings.replyTo ?? null, updatedAt }
}

export async function sendSmtpTest(settings: SmtpSettings, to: string): Promise<void> {
  const { WorkerMailer } = await import('worker-mailer')
  await WorkerMailer.send({ host: settings.host, port: settings.port, secure: settings.secure, authType: settings.authType, credentials: { username: settings.username, password: settings.password } }, {
    from: settings.fromName ? { email: settings.from, name: settings.fromName } : settings.from,
    to,
    ...(settings.replyTo ? { reply: settings.replyTo } : {}),
    subject: 'Plugmesh SMTP 测试邮件',
    text: '这是一封来自 Plugmesh 的 SMTP 测试邮件。',
  })
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
