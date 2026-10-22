import { useTranslation } from 'react-i18next'
import type { Page } from '../../app/routes'
import { Panel } from '../../components/Panel'
import { QuickStep } from './QuickStep'

// 快速开始：把「绑定服务器 → 加载插件 → 分配域名」三步直接接到对应页面。
export function QuickStartPanel({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  return <Panel className="quick-panel" title={t('overview.quick.title')} subtitle={t('overview.quick.subtitle')}>
    <QuickStep number="01" title={t('overview.quick.bindTitle')} detail={t('overview.quick.bindDetail')} onClick={() => onNavigate('servers')} />
    <QuickStep number="02" title={t('overview.quick.loadTitle')} detail={t('overview.quick.loadDetail')} onClick={() => onNavigate('plugins')} />
    <QuickStep number="03" title={t('overview.quick.domainTitle')} detail={t('overview.quick.domainDetail')} onClick={() => onNavigate('domains')} />
  </Panel>
}
