import { Avatar, Button, Flex, Typography } from 'antd'
import { Code2, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppThemeMode } from '../../app/theme'
import { AuthFrame } from './AuthFrame'
import { GithubMark } from './GithubMark'

const { Title, Paragraph, Text } = Typography

/** 登录入口：只有 GitHub OAuth 一种方式，邀请链接直接带进 start 参数。 */
export function LoginPage({ mode }: { mode: AppThemeMode }) {
  const { t } = useTranslation()
  const params = new URLSearchParams(window.location.search)
  const invite = params.get('invite')
  const startUrl = `/auth/github/start${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`
  const title = invite ? t('auth.inviteTitle') : t('auth.loginTitle')
  return <AuthFrame mode={mode} heading={title}>
    <Avatar className="auth-icon" shape="square" size={48} icon={<Code2 size={24} />} />
    <Title level={1} className="auth-title">{title}</Title>
    <Paragraph type="secondary" className="auth-copy">{invite ? t('auth.inviteBody') : t('auth.loginBody')}</Paragraph>
    <Button className="auth-submit" type="primary" size="large" block href={startUrl} icon={<GithubMark size={17} />}>{t('auth.github')}</Button>
    <Flex className="auth-notes" vertical gap={6}>
      <Text type="secondary" className="auth-note"><LockKeyhole size={13} aria-hidden="true" />{t('auth.note')}</Text>
      <Text type="secondary" className="auth-note"><ShieldCheck size={13} aria-hidden="true" />{t('auth.inviteOnly')}</Text>
    </Flex>
  </AuthFrame>
}
