import { useTranslation } from 'react-i18next'
import { Card, Progress } from 'antd'
import type { LucideIcon } from 'lucide-react'

// 单张额度卡：当前用量、上限与显式百分比。
// percent 为 null 表示该项不设上限（平台请求计数），undefined 表示上限尚未读取。
export function UsageResourceCard({ title, current, limit, unit, percent, note, icon: Icon }: {
  title: string
  current: string
  limit: string
  unit: string
  percent: number | null | undefined
  note?: string
  icon: LucideIcon
}) {
  const { t } = useTranslation()
  const ratio = percent === null || percent === undefined ? null : Math.round(percent)
  return <Card className="resource-card" variant="outlined">
    <div className="resource-card-head"><div className="resource-card-icon"><Icon size={17} /></div><span>{title}</span></div>
    <strong>{current}</strong>
    <div className="resource-card-limit">
      {percent === null
        ? <span>{t('usage.card.unlimited')}</span>
        : <><span>{t('common.upperLimit', { limit })}</span>{ratio === null ? null : <span className="resource-card-percent">{t('usage.card.usedPercent', { percent: ratio })}</span>}</>}
      {unit ? <span>{unit}</span> : null}
    </div>
    {note ? <p className="resource-card-note">{note}</p> : null}
    {ratio === null ? null : <Progress percent={ratio} showInfo={false} size="small" aria-label={title} />}
  </Card>
}
