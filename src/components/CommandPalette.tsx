import { Input, Modal } from 'antd'
import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

export interface CommandItem {
  id: string
  group: string
  label: string
  hint?: string
  run: () => void
}

/** 命令面板：聚合页面、实体与设置分区，⌘K/Ctrl+K 打开，↑↓ 选择、Enter 跳转。 */
export function CommandPalette({ onClose, items }: { onClose: () => void; items: CommandItem[] }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) => `${item.label} ${item.hint ?? ''} ${item.group}`.toLowerCase().includes(keyword)).slice(0, 40)
  }, [items, query])

  useEffect(() => {
    if (active >= results.length) setActive(0)
  }, [active, results.length])

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [onClose])

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  const choose = (item: CommandItem | undefined) => {
    if (!item) return
    item.run()
    onClose()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((current) => results.length === 0 ? 0 : (current + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => results.length === 0 ? 0 : (current - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[active])
    }
  }

  return <Modal open onCancel={onClose} footer={null} width={560} title={null} className="command-palette" destroyOnHidden>
    <div className="command-search" onKeyDown={onKeyDown}>
      <Search size={16} />
      <Input autoFocus variant="borderless" value={query} onChange={(event) => { setQuery(event.target.value); setActive(0) }} placeholder={t('palette.placeholder')} aria-label={t('palette.title')} />
      <span className="shortcut">Esc</span>
    </div>
    <div className="command-list" role="listbox" aria-label={t('palette.title')} ref={listRef}>
      {results.length === 0 && <div className="command-empty">{t('palette.empty')}</div>}
      {results.map((item, index) => {
        const startsGroup = index === 0 || results[index - 1].group !== item.group
        return <div key={item.id}>
          {startsGroup && <div className="command-group">{item.group}</div>}
          <button type="button" role="option" aria-selected={index === active} data-active={index === active} className={`command-item ${index === active ? 'active' : ''}`} onMouseEnter={() => setActive(index)} onClick={() => choose(item)}>
            <span>{item.label}</span>
            {item.hint && <small>{item.hint}</small>}
          </button>
        </div>
      })}
    </div>
    <div className="command-hint">{t('palette.hint')}</div>
  </Modal>
}
