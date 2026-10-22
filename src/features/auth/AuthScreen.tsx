import { Avatar, Button, Card, Flex, Spin, Typography } from 'antd'
import { Activity, Box, Code2, LockKeyhole, Network, Server, ShieldCheck } from 'lucide-react'
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

function Brand() {
  const { t } = useTranslation()
  return <Flex className="auth-brand" align="center" gap={10}>
    <Avatar className="auth-brand-mark" shape="square" size={30} icon={<Network size={17} strokeWidth={2.4} />} />
    <Flex vertical gap={0}>
      <Text strong className="auth-brand-name">Plugmesh</Text>
      <Text type="secondary" className="auth-brand-caption">{t('brand.caption')}</Text>
    </Flex>
  </Flex>
}

// 登录外壳与控制台共用同一套结构：左侧品牌栏 + 右侧顶栏与内容区，避免再出现独立旧版卡片页。
function AuthFrame({ mode, heading, children }: { mode: AppThemeMode; heading: string; children: React.ReactNode }) {
  const { t } = useTranslation()
  return <div className={`auth-screen theme-${mode}`}>
    <aside className="auth-aside">
      <Brand />
      <div className="auth-aside-copy">
        <Title level={2} className="auth-aside-title">{t('auth.asideTitle')}</Title>
        <Paragraph className="auth-aside-body">{t('auth.asideBody')}</Paragraph>
      </div>
      <ul className="auth-points">
        <li><span className="auth-point-icon"><Server size={15} /></span><div><strong>{t('auth.points.servers')}</strong><span>{t('auth.points.serversHint')}</span></div></li>
        <li><span className="auth-point-icon"><Box size={15} /></span><div><strong>{t('auth.points.plugins')}</strong><span>{t('auth.points.pluginsHint')}</span></div></li>
        <li><span className="auth-point-icon"><Activity size={15} /></span><div><strong>{t('auth.points.usage')}</strong><span>{t('auth.points.usageHint')}</span></div></li>
      </ul>
      <Text className="auth-aside-foot">{t('auth.asideFoot')}</Text>
    </aside>
    <main className="auth-main">
      <header className="auth-topbar"><span>{t('shell.console')}</span><span aria-hidden="true">/</span><strong>{heading}</strong></header>
      <div className="auth-main-body">
        <Card className="auth-panel" variant="outlined">
          <Flex vertical gap={0}>{children}</Flex>
        </Card>
      </div>
    </main>
  </div>
}

export function AuthLoadingScreen({ mode }: { mode: AppThemeMode }) {
  const { t } = useTranslation()
  return <AuthFrame mode={mode} heading={t('auth.checkingTitle')}>
    <Avatar className="auth-icon" shape="square" size={44} icon={<Network size={20} strokeWidth={2.4} />} />
    <Title level={1} className="auth-title">{t('auth.checkingTitle')}</Title>
    <Paragraph type="secondary" className="auth-copy">{t('auth.checkingBody')}</Paragraph>
    <div className="auth-spinner" role="status" aria-live="polite">
      <Spin size="large" />
      <span className="sr-only">{t('auth.checkingTitle')}</span>
    </div>
  </AuthFrame>
}

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
