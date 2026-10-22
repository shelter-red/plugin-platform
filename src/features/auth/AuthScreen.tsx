import { Alert, Avatar, Button, Card, Divider, Flex, Spin, Typography } from 'antd'
import { Code2, LockKeyhole, Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppThemeMode } from '../../app/theme'

const { Title, Paragraph, Text } = Typography

function GithubMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

// 登录外壳：AntD Card 负责容器，Flex 负责垂直布局，主题变量保持明暗一致。
function AuthShell({ mode, children }: { mode: AppThemeMode; children: React.ReactNode }) {
  return (
    <div className={`auth-screen theme-${mode}`}>
      <Card className="auth-card" variant="outlined">
        <Flex vertical align="center" gap={0}>{children}</Flex>
      </Card>
    </div>
  )
}

function BrandHeader() {
  const { t } = useTranslation()
  return (
    <>
      <Flex className="auth-brand" align="center" justify="center" gap={10}>
        <Avatar className="auth-brand-mark" shape="square" size={34} icon={<Network size={18} strokeWidth={2.4} />} />
        <Flex vertical align="flex-start" gap={0}>
          <Text strong className="auth-brand-name">Plugmesh</Text>
          <Text type="secondary" className="auth-brand-caption">{t('brand.caption')}</Text>
        </Flex>
      </Flex>
      <Divider className="auth-divider" />
    </>
  )
}

export function AuthLoadingScreen({ mode }: { mode: AppThemeMode }) {
  const { t } = useTranslation()
  return (
    <AuthShell mode={mode}>
      <Avatar className="auth-brand-mark auth-loading-mark" shape="square" size={44} icon={<Network size={20} strokeWidth={2.4} />} />
      <Title level={2} className="auth-title">{t('auth.checkingTitle')}</Title>
      <Paragraph type="secondary" className="auth-copy">{t('auth.checkingBody')}</Paragraph>
      <div className="auth-spinner" role="status" aria-live="polite">
        <Spin size="large" />
        <span className="sr-only">{t('auth.checkingTitle')}</span>
      </div>
    </AuthShell>
  )
}

export function LoginPage({ mode }: { mode: AppThemeMode }) {
  const { t } = useTranslation()
  const params = new URLSearchParams(window.location.search)
  const invite = params.get('invite')
  const authError = params.get('auth_error')
  const startUrl = `/auth/github/start${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`
  return (
    <AuthShell mode={mode}>
      <BrandHeader />
      <Avatar className="auth-icon" shape="square" size={48} icon={<Code2 size={24} />} />
      <Title level={2} className="auth-title">{invite ? t('auth.inviteTitle') : t('auth.loginTitle')}</Title>
      <Paragraph type="secondary" className="auth-copy">{invite ? t('auth.inviteBody') : t('auth.loginBody')}</Paragraph>
      {authError && <Alert className="auth-alert" type="error" showIcon message={authError} />}
      <Button className="auth-submit" type="primary" size="large" block href={startUrl} icon={<GithubMark size={17} />}>{t('auth.github')}</Button>
      <Text type="secondary" className="auth-note"><LockKeyhole size={13} aria-hidden="true" />{t('auth.note')}</Text>
    </AuthShell>
  )
}
