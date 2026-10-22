import { useTranslation } from 'react-i18next'
import { Alert, Button, Typography } from 'antd'
import { Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import type { Workspace } from '../api'
import type { Page } from './routes'
import { translateError } from '../errors'

export type PageHeaderProps = {
  title: string
  description: string
  apiLive: boolean
  page: Page | null
  canWrite: boolean
  activeWorkspace: Workspace | null
  dataLoading: boolean
  dataError: string | null
  usageRefreshing: boolean
  onRefreshData: () => void
  onRefreshUsage: () => void
  onOpenProvision: (type: 'server' | 'domain' | 'plugin') => void
}

/** 页面标题区：连接态、标题描述、按页面给出的主操作，以及数据错误与只读提示。 */
export function PageHeader({ title, description, apiLive, page, canWrite, activeWorkspace, dataLoading, dataError, usageRefreshing, onRefreshData, onRefreshUsage, onOpenProvision }: PageHeaderProps) {
  const { t } = useTranslation()
  const readOnlyHint = canWrite ? undefined : t('workspace.readOnlyHint')
  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow"><span className="live-pulse" />{apiLive ? t('shell.live') : t('shell.waitingData')}</div>
          <Typography.Title level={1}>{title}</Typography.Title>
          <Typography.Paragraph type="secondary">{description}</Typography.Paragraph>
        </div>
        <div className="header-actions">
          {page === 'overview' && <Button icon={<RefreshCw size={15} />} onClick={onRefreshData} disabled={dataLoading}>{t('shell.refresh')}</Button>}
          {page === 'usage' && <Button data-testid="usage-refresh" icon={<RefreshCw size={15} />} onClick={onRefreshUsage} loading={usageRefreshing}>{t('usage.refresh')}</Button>}
          {page === 'servers' && <Button type="primary" icon={<Plus size={16} />} onClick={() => onOpenProvision('server')} disabled={!canWrite} title={readOnlyHint}>{t('shell.bindServer')}</Button>}
          {page === 'domains' && <Button type="primary" icon={<Plus size={16} />} onClick={() => onOpenProvision('domain')} disabled={!canWrite} title={readOnlyHint}>{t('shell.assignDomain')}</Button>}
          {page === 'plugins' && <Button type="primary" icon={<Plus size={16} />} onClick={() => onOpenProvision('plugin')} disabled={!canWrite} title={readOnlyHint}>{t('shell.loadPlugin')}</Button>}
        </div>
      </div>
      {dataError && <Alert className="page-alert" type="error" showIcon message={t('shell.loadFailed')} description={translateError(dataError)} action={<Button size="small" type="link" onClick={onRefreshData}>{t('shell.retry')}</Button>} />}
      {activeWorkspace && !canWrite && page !== 'settings' && page !== 'workspaces' && <Alert className="page-alert" type="info" showIcon icon={<ShieldCheck size={16} />} message={t('workspace.readOnly')} description={t('workspace.readOnlyHint')} />}
    </>
  )
}
