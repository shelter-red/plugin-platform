import type { ReactNode } from 'react'
import { Card, Flex, Typography } from 'antd'
import { Activity, Box, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AppThemeMode } from '../../app/theme'
import { AuthBrand } from './AuthBrand'

const { Title, Paragraph, Text } = Typography

/** 登录外壳与控制台共用同一套结构：左侧品牌栏 + 右侧顶栏与内容区。 */
export function AuthFrame({ mode, heading, children }: { mode: AppThemeMode; heading: string; children: ReactNode }) {
  const { t } = useTranslation()
  return <div className={`auth-screen theme-${mode}`}>
    <aside className="auth-aside">
      <AuthBrand />
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
