import type { SmtpAuthType, SmtpSettingsInput } from '../../api'

export interface SmtpForm {
  host: string
  port: number | null
  secure: boolean
  username: string
  password: string
  authType: SmtpAuthType
  from: string
  fromName: string
  replyTo: string
  testTo: string
}

export const AUTH_TYPES: SmtpAuthType[] = ['plain', 'login', 'cram-md5']

export const emptyForm: SmtpForm = { host: '', port: 587, secure: false, username: '', password: '', authType: 'plain', from: '', fromName: '', replyTo: '', testTo: '' }

/** 测试收件人只影响测试动作，不进提交体。 */
export const toPayload = (form: SmtpForm): SmtpSettingsInput => ({
  host: form.host.trim(),
  port: form.port ?? 0,
  secure: form.secure,
  username: form.username.trim(),
  password: form.password,
  authType: form.authType,
  from: form.from.trim(),
  fromName: form.fromName.trim(),
  replyTo: form.replyTo.trim(),
})

/** 当前表单值的指纹：任一字段改动都会让上一次成功的测试失效。 */
export const signatureOf = (form: SmtpForm) => JSON.stringify(toPayload(form))
