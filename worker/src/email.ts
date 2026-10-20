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
  await sendEmail(settings, {
    subject: 'Plugmesh SMTP 测试邮件',
    text: '这是一封来自 Plugmesh 的 SMTP 测试邮件。',
    to,
  })
}

export async function sendInviteEmail(settings: SmtpSettings, to: string, inviteUrl: string, expiresAt: string): Promise<void> {
  await sendEmail(settings, {
    subject: 'Plugmesh 平台邀请',
    text: `你已被邀请加入 Plugmesh 插件平台。\n\n请在邀请有效期内打开以下链接完成 GitHub 身份验证：\n${inviteUrl}\n\n邀请有效至：${expiresAt}`,
    to,
  })
}

export async function sendMaintenanceEmail(settings: SmtpSettings, to: string, reason: string): Promise<void> {
  await sendEmail(settings, {
    subject: 'Plugmesh 平台已进入维护模式',
    text: `Plugmesh 平台已自动进入维护模式。\n\n触发原因：${reason}\n\n请登录管理端检查平台用量与配额。`,
    to,
  })
}

async function sendEmail(settings: SmtpSettings, message: { subject: string; text: string; to: string }): Promise<void> {
  const { WorkerMailer } = await import('worker-mailer')
  await WorkerMailer.send({ host: settings.host, port: settings.port, secure: settings.secure, authType: settings.authType, credentials: { username: settings.username, password: settings.password } }, {
    from: settings.fromName ? { email: settings.from, name: settings.fromName } : settings.from,
    to: message.to,
    ...(settings.replyTo ? { reply: settings.replyTo } : {}),
    subject: message.subject,
    text: message.text,
  })
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
