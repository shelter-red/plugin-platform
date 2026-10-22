import type { ReactNode } from 'react'
import { Card } from 'antd'

// 统一的面板外壳：AntD Card 负责容器与主题，保留 .panel 供布局与测试复用。
export function Panel({ id, title, subtitle, extra, heading, className = '', padded = false, children }: { id?: string; title?: ReactNode; subtitle?: ReactNode; extra?: ReactNode; heading?: ReactNode; className?: string; padded?: boolean; children: ReactNode }) {
  return (
    <Card id={id} className={`panel ${className}`.trim()} variant="outlined" styles={{ body: { padding: padded ? 18 : 0 } }}>
      {heading && heading}
      {(title || extra) && !heading && (
        <div className="panel-header">
          <div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>
          {extra}
        </div>
      )}
      {children}
    </Card>
  )
}
