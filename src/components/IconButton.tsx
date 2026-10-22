import type { ReactNode } from 'react'
import { Button } from 'antd'

// 图标按钮统一走 AntD Button，保留 .icon-button 尺寸与显隐规则。
export function IconButton({ label, children, onClick, className = '' }: { label: string; children: ReactNode; onClick?: () => void; className?: string }) {
  return <Button className={`icon-button ${className}`.trim()} type="text" size="small" aria-label={label} title={label} onClick={onClick} icon={children} />
}
