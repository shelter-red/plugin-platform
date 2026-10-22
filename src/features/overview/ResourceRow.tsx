import { useTranslation } from 'react-i18next'
import { Progress } from 'antd'
import type { LucideIcon } from 'lucide-react'

// 单条配额：左侧当前用量、右侧上限，进度条只做视觉刻度（`showInfo={false}`）。
export function ResourceRow({ label, value, limit, percent, icon: Icon }: { label: string; value: string; limit: string; percent: number; icon: LucideIcon }) {
  const { t } = useTranslation()
  return <div className="resource"><div className="resource-top"><div className="resource-label"><Icon size={15} />{label}</div><strong>{value}</strong></div><Progress percent={Math.round(percent)} showInfo={false} size="small" aria-label={label} /><div className="resource-bottom"><span>{t('common.currentUsage')}</span><span>{limit}</span></div></div>
}
