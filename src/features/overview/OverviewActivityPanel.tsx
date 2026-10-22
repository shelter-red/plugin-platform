import { useTranslation } from 'react-i18next'
import { Button, List } from 'antd'
import { Activity, ArrowUpRight, Check } from 'lucide-react'
import type { ApiAudit } from '../../api'
import type { Page } from '../../app/routes'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { auditActionLabel, auditDetail } from '../../lib/audit'
import { formatDateTime } from '../../lib/format'

// 最近活动只取 3 条：总览给的是「刚发生了什么」的读数，完整列表在审计页。
export function OverviewActivityPanel({ audits, onNavigate }: { audits: ApiAudit[]; onNavigate: (page: Page) => void }) {
  const { t } = useTranslation()
  return <Panel title={t('overview.activity.title')} subtitle={t('overview.activity.subtitle')} extra={<Button type="link" size="small" onClick={() => onNavigate('audit')}>{t('overview.activity.viewAll')} <ArrowUpRight size={14} /></Button>}>
    {audits.length > 0
      ? <List className="activity-list" dataSource={audits.slice(0, 3)} rowKey="id" renderItem={(item) => <List.Item className="activity-item"><div className="activity-mark success"><Check size={13} /></div><div className="activity-copy"><strong>{auditActionLabel(item.action)}</strong><span>{auditDetail(item)}</span></div><time>{formatDateTime(item.created_at)}</time></List.Item>} />
      : <EmptyState icon={<Activity size={20} />} title={t('overview.activity.emptyTitle')} body={t('overview.activity.emptyBody')} />}
  </Panel>
}
