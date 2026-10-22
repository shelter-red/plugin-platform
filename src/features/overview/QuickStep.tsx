import { Button } from 'antd'
import { ArrowUpRight, Check } from 'lucide-react'

// 快速开始三步骤：按钮整体可点，完成后用对勾替换序号。
export function QuickStep({ number, title, detail, done, onClick }: { number: string; title: string; detail: string; done?: boolean; onClick: () => void }) {
  return <Button type="text" block className="quick-step" onClick={onClick}><span className={`step-number ${done ? 'done' : ''}`}>{done ? <Check size={13} /> : number}</span><span className="step-copy"><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={14} /></Button>
}
