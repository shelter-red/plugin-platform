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

export type SmtpSettingsField = 'host' | 'port' | 'authType' | 'username' | 'password' | 'from'

export type SmtpSettingsValidation =
  | { ok: true; settings: SmtpSettings }
  | { ok: false; field: SmtpSettingsField; error: string }

/**
 * 校验 SMTP 表单。密码允许为空：空密码表示沿用已保存密钥，由调用方决定是否回退。
 * 返回 field 便于前端把错误定位到具体输入框。
 */
export function validateSmtpSettings(value: unknown): SmtpSettingsValidation {
  if (!value || typeof value !== 'object') return { ok: false, field: 'host', error: 'Invalid SMTP settings' }
  const input = value as Partial<SmtpSettings>
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  if (!/^[a-zA-Z0-9.-]+$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return { ok: false, field: 'host', error: 'SMTP host is invalid' }
  const port = typeof input.port === 'number' ? input.port : Number(input.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 25) return { ok: false, field: 'port', error: 'SMTP port is invalid' }
  const authType = input.authType
  if (authType !== 'plain' && authType !== 'login' && authType !== 'cram-md5') return { ok: false, field: 'authType', error: 'SMTP auth type is invalid' }
  const username = typeof input.username === 'string' ? input.username.trim() : ''
  if (!username) return { ok: false, field: 'username', error: 'SMTP username is required' }
  const from = typeof input.from === 'string' ? input.from.trim() : ''
  if (!isEmail(from)) return { ok: false, field: 'from', error: 'SMTP sender address is invalid' }
  const password = typeof input.password === 'string' ? input.password : ''
  return {
    ok: true,
    settings: { host, port, secure: Boolean(input.secure), username, password, authType, from, ...(input.fromName?.trim() ? { fromName: input.fromName.trim() } : {}), ...(input.replyTo?.trim() ? { replyTo: input.replyTo.trim() } : {}) },
  }
}

export function parseSmtpSettings(value: unknown): SmtpSettings | null {
  const result = validateSmtpSettings(value)
  return result.ok && result.settings.password ? result.settings : null
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
