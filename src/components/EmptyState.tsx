import type { ReactNode } from 'react'
import { Empty } from 'antd'

// 统一空态：AntD Empty 提供结构，标题仍渲染为 h3 以保留可访问名称。
export function EmptyState({ icon, title, body, className = '' }: { icon?: ReactNode; title: ReactNode; body?: ReactNode; className?: string }) {
  return (
    <Empty
      className={`empty-panel ${className}`.trim()}
      image={icon ? <div className="empty-illustration">{icon}</div> : undefined}
      description={<div className="empty-copy"><h3>{title}</h3>{body && <p>{body}</p>}</div>}
    />
  )
}
