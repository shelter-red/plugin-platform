// 本地 SMTP 收件端配置：收件人 → 主题关键字。sink 拒绝不匹配的邮件，
// 因此接口返回成功即证明邮件确实经真实 SMTP 会话投递且内容正确。
export const SMTP_SINK = {
  host: '127.0.0.1',
  port: 2526,
  username: 'sink-user',
  password: 'sink-password',
  from: 'mailer@example.com',
  expectations: {
    'ops@example.com': 'SMTP 测试',
    'invitee@example.com': '平台邀请',
    'admin@example.com': '维护模式',
  } as Record<string, string>,
}

export const smtpSinkSettings = {
  host: SMTP_SINK.host,
  port: SMTP_SINK.port,
  secure: false,
  username: SMTP_SINK.username,
  password: SMTP_SINK.password,
  authType: 'plain' as const,
  from: SMTP_SINK.from,
  fromName: 'Plugmesh',
}
