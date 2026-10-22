import { Avatar, Spin, Typography } from 'antd'
import { Network } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppThemeMode } from '../../app/theme'
import { AuthFrame } from './AuthFrame'

const { Title, Paragraph } = Typography

/** 会话探测中：与登录页同壳，只换正文，避免首屏闪出一张不同的卡片。 */
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
