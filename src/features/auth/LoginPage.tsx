import { Avatar, Button, Flex, Input, Typography } from 'antd'
import { Code2, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppThemeMode } from '../../app/theme'
import { AuthFrame } from './AuthFrame'
import { loginWithPassword } from '../../api'
import { errorMessage } from '../../errors'

const { Title, Paragraph, Text } = Typography

/** 登录入口：管理员密码登录。 */
export function LoginPage({ mode }: { mode: AppThemeMode }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await loginWithPassword(password)
      window.location.assign('/')
    } catch (cause) {
      setError(errorMessage(cause, 'auth.loginFailed'))
    } finally {
      setLoading(false)
    }
  }
  const title = t('auth.loginTitle')
  return <AuthFrame mode={mode} heading={title}>
    <Avatar className="auth-icon" shape="square" size={48} icon={<Code2 size={24} />} />
    <Title level={1} className="auth-title">{title}</Title>
    <Paragraph type="secondary" className="auth-copy">{t('auth.loginBody')}</Paragraph>
    {error && <Paragraph type="danger" role="alert">{error}</Paragraph>}
    <form onSubmit={(event) => void submit(event)}>
      <Input.Password aria-label={t('auth.password')} value={password} onChange={(event) => setPassword(event.target.value)} autoFocus />
      <Button className="auth-submit" htmlType="submit" type="primary" size="large" block loading={loading} icon={<LockKeyhole size={17} />}>{t('auth.login')}</Button>
    </form>
    <Flex className="auth-notes" vertical gap={6}>
      <Text type="secondary" className="auth-note"><LockKeyhole size={13} aria-hidden="true" />{t('auth.note')}</Text>
      <Text type="secondary" className="auth-note"><ShieldCheck size={13} aria-hidden="true" />{t('auth.passwordOnly')}</Text>
    </Flex>
  </AuthFrame>
}
