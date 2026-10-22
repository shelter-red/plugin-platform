import { useTranslation } from 'react-i18next'
import { Progress } from 'antd'
import type { LucideIcon } from 'lucide-react'

// 单条额度：右侧上限、显式百分比，进度条只做视觉刻度（`showInfo={false}`）。
// percent 为 null 表示该项不设上限（平台请求计数），undefined 表示上限尚未读取。
export function ResourceRow({ label, value, limit, percent, icon: Icon }: { label: string; value: string; limit: string; percent?: number | null; icon: LucideIcon }) {
  const { t } = useTranslation()
  const ratio = percent === null || percent === undefined ? null : Math.round(percent)
  return <div className="resource">
    <div className="resource-top"><div className="resource-label"><Icon size={15} />{label}</div><strong>{value}</strong></div>
    {ratio === null ? null : <Progress percent={ratio} showInfo={false} size="small" aria-label={label} />}
    <div className="resource-bottom">
      {percent === null ? <span>{t('usage.card.unlimited')}</span> : ratio === null ? <span>{t('common.currentUsage')}</span> : <span>{t('usage.card.usedPercent', { percent: ratio })}</span>}
      <span>{limit}</span>
    </div>
  </div>
}
