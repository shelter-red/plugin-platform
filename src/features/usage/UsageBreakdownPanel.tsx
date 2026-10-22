import { useTranslation } from 'react-i18next'
import type { LocalUsage, UsageBreakdownEntry } from '../../api'
import { Panel } from '../../components/Panel'
import { formatNumber } from '../../lib/format'

export function UsageBreakdownPanel({ localUsage }: { localUsage: LocalUsage | null }) {
  const { t } = useTranslation()
  return <Panel className="breakdown-panel" title={t('usage.breakdown.title')} subtitle={t('usage.breakdown.subtitle')}>
    <div className="breakdown-grid">
      <BreakdownColumn title={t('usage.breakdown.users')} rows={localUsage?.breakdown.users ?? []} />
      <BreakdownColumn title={t('usage.breakdown.plugins')} rows={localUsage?.breakdown.plugins ?? []} />
      <BreakdownColumn title={t('usage.breakdown.domains')} rows={localUsage?.breakdown.domains ?? []} />
    </div>
  </Panel>
}

function BreakdownColumn({ title, rows }: { title: string; rows: UsageBreakdownEntry[] }) {
  const { t } = useTranslation()
  return <div className="breakdown-column"><h3>{title}</h3>{rows.length === 0 ? <p className="breakdown-empty">{t('usage.breakdown.empty')}</p> : rows.map((row) => <div className="breakdown-row" key={row.id}><span title={row.label}>{row.label}</span><strong>{formatNumber(row.requests)}</strong></div>)}</div>
}
