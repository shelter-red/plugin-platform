import { useTranslation } from 'react-i18next'
import { Segmented } from 'antd'
import { Activity } from 'lucide-react'
import type { UsageSnapshot } from '../../api'
import { Panel } from '../../components/Panel'
import { currentLocale, formatNumber } from '../../lib/format'

export type TrendRange = '24h' | '7d' | '30d'

// 面板外壳与区间切换放在这里，页面只传数据与 setter。
export function RequestTrendPanel({ range, setRange, snapshots }: { range: TrendRange; setRange: (value: TrendRange) => void; snapshots: UsageSnapshot[] }) {
  const { t } = useTranslation()
  return <Panel title={t('overview.trend.title')} subtitle={t('overview.trend.subtitle')} extra={<Segmented size="small" value={range} onChange={(value) => setRange(value as TrendRange)} options={['24h', '7d', '30d']} />}>
    <RequestTrend range={range} snapshots={snapshots} />
  </Panel>
}

// 趋势柱状图：快照可能多达成百条，超过 24 根时按等宽桶取桶末值，保持柱子可辨认。
function RequestTrend({ range, snapshots }: { range: TrendRange; snapshots: UsageSnapshot[] }) {
  const { t } = useTranslation()
  const sampled = sampleUsageSnapshots(snapshots)
  if (sampled.length === 0) return <div className="empty-chart chart-empty-state"><Activity size={20} /><strong>{t('overview.trend.emptyTitle')}</strong><span>{t('overview.trend.emptyBody')}</span></div>
  const maximum = Math.max(...sampled.map((snapshot) => snapshot.request_count), 1)
  const first = sampled[0]
  const last = sampled[sampled.length - 1]
  return <div className="empty-chart" role="img" aria-label={t('overview.trend.aria', { range })}><div className="chart-grid-lines"><span /><span /><span /><span /></div><div className="chart-bars">{sampled.map((snapshot) => <div className="bar-wrap" key={snapshot.captured_at}><div className="chart-bar accent" style={{ height: `${Math.max(6, snapshot.request_count / maximum * 100)}%` }} title={t('overview.trend.tooltip', { time: formatTrendTime(snapshot.captured_at), count: formatNumber(snapshot.request_count) })} /></div>)}</div><div className="chart-axis"><span>{formatTrendTime(first.captured_at)}</span><span>{formatTrendTime(last.captured_at)}</span></div><div className="chart-footnote"><span><span className="legend-dot" />{t('overview.trend.series')}</span><span>{t('overview.trend.summary', { range, count: formatNumber(last.request_count) })}</span></div></div>
}

function sampleUsageSnapshots(snapshots: UsageSnapshot[], limit = 24): UsageSnapshot[] {
  if (snapshots.length <= limit) return snapshots
  const bucketSize = Math.ceil(snapshots.length / limit)
  return Array.from({ length: Math.ceil(snapshots.length / bucketSize) }, (_, index) => snapshots[Math.min((index + 1) * bucketSize - 1, snapshots.length - 1)])
}

function formatTrendTime(value: string): string {
  return new Date(value).toLocaleString(currentLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
