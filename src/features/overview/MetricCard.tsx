import { Card, Statistic } from 'antd'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'

// 指标卡整卡可点：鼠标点击、Enter 与空格等价，避免出现只有指针可用的卡片。
export function MetricCard({ label, value, note, icon: Icon, tone, onClick }: { label: string; value: string; note: string; icon: LucideIcon; tone: string; onClick: () => void }) {
  return <Card className="metric-card" hoverable onClick={onClick} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick() } }}>
    <div className={`metric-icon ${tone}`}><Icon size={17} /></div>
    <div className="metric-label">{label}<ArrowUpRight size={13} /></div>
    <Statistic className="metric-number" value={value} />
    <div className="metric-note"><span className="status-dot green" />{note}</div>
  </Card>
}
