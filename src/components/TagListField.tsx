import { Select } from 'antd'
import type { KeyboardEvent } from 'react'

/** 标签输入：回车、逗号、空格、分号均可提交，自动去重（可选转小写）。 */
export function TagListField({ label, value, onChange, hint, placeholder, lowercase = true, disabled }: { label: string; value: string[]; onChange: (value: string[]) => void; hint?: string; placeholder?: string; lowercase?: boolean; disabled?: boolean }) {
  const normalize = (entries: string[]) => {
    const seen = new Set<string>()
    return entries.map((entry) => entry.trim()).filter((entry) => {
      const key = lowercase ? entry.toLowerCase() : entry
      if (!entry || seen.has(key)) return false
      seen.add(key)
      return true
    }).map((entry) => lowercase ? entry.toLowerCase() : entry)
  }
  const submitOnSpace = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== ' ') return
    const input = (event.target as HTMLInputElement)
    if (!input.value.trim()) return
    event.preventDefault()
    onChange(normalize([...value, input.value]))
    input.value = ''
  }
  return <div className="field">
    <span className="field-label">{label}</span>
    <Select mode="tags" value={value} onChange={(next) => onChange(normalize(next))} onInputKeyDown={submitOnSpace} tokenSeparators={[',', ';']} placeholder={placeholder} disabled={disabled} aria-label={label} />
    {hint && <span className="field-hint">{hint}</span>}
  </div>
}
