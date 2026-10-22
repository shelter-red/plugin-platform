#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'src')
const files = collect(root).sort()
const violations = []

const RAW_INPUT_TYPES = new Set(['date', 'datetime-local', 'month', 'time', 'week', 'color'])

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  const tags = scanTags(source)
  const dropdownRanges = findDropdownRanges(tags)

  for (const tag of tags) {
    const { name, text, offset } = tag
    if (!tag.open) continue
    const at = `${relative(process.cwd(), file)}:${lineAt(source, offset)}`

    if (name === 'select' || name === 'option') {
      report(at, 'raw-select', `禁止使用原生 <${name}>，请改用 AntD Select`)
    }
    if (name === 'input' && RAW_INPUT_TYPES.has(attrValue(text, 'type') ?? '')) {
      report(at, 'raw-input', '禁止使用原生日期/时间/颜色输入，请改用 AntD 控件')
    }
    if (name === 'a' && !hasAttr(text, 'href') && !hasAttr(text, 'onClick')) {
      report(at, 'dead-control', '原生 <a> 必须有 href 或 onClick')
    }
    if (name === 'button' && !isLiveButton(text) && !inRanges(offset, dropdownRanges)) {
      report(at, 'dead-control', '原生 <button> 必须有 onClick/disabled/type="submit"，或作为 Dropdown 触发器')
    }
    if (name === 'Button' && !isLiveButton(text) && !hasAttr(text, 'href') && !inRanges(offset, dropdownRanges)) {
      report(at, 'dead-control', 'AntD <Button> 必须有 onClick/href/disabled/htmlType="submit"，或作为 Dropdown 触发器')
    }
    if (name === 'Link' && !hasAttr(text, 'to') && !hasAttr(text, 'href') && !hasAttr(text, 'onClick')) {
      report(at, 'dead-link', '<Link> 必须有 to/href/onClick')
    }
    if (name === 'Input' || name === 'input') {
      const placeholder = literalAttr(text, 'placeholder')
      const urlLike = placeholder !== null && /(^|\s)(https?:\/\/|:\/\/)/i.test(placeholder)
      if (urlLike && !hasAttr(text, 'value') && !hasAttr(text, 'defaultValue')) {
        report(at, 'placeholder-only', 'URL/固定值不得只放在 placeholder，必须用 value/defaultValue 可见展示')
      }
    }
    if (/onClick=\{\s*\(\s*\)\s*=>\s*(\{\s*\}|undefined)\s*\}/.test(text)) {
      report(at, 'dead-control', 'onClick 不得为空实现')
    }
  }
}

if (violations.length === 0) {
  console.log(`ui:conventions 通过：${files.length} 个 TSX 文件，0 处违规`)
  process.exit(0)
}
for (const item of violations) console.error(`${item.at} [${item.rule}] ${item.message}`)
console.error(`\nui:conventions 失败：${violations.length} 处违规（扫描 ${files.length} 个 TSX 文件）`)
process.exit(1)

function report(at, rule, message) {
  violations.push({ at, rule, message })
}

function collect(dir) {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry.startsWith('.')) return []
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? collect(path) : path.endsWith('.tsx') ? [path] : []
  })
}

function lineAt(source, offset) {
  let line = 1
  for (let index = 0; index < offset; index += 1) if (source[index] === '\n') line += 1
  return line
}

// 只收集 JSX 开标签；扫描时跳过引号与 {} 表达式内部的 >。
function scanTags(source) {
  const tags = []
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '<') continue
    const match = /^<(\/?)([A-Za-z][\w.]*)/.exec(source.slice(index))
    if (!match) continue
    const closing = match[1] === '/'
    const name = match[2]
    if (closing) {
      tags.push({ name, text: '', offset: index, open: false, closing: true, selfClosing: false })
      index += match[0].length - 1
      continue
    }
    const end = findTagEnd(source, index + match[0].length)
    if (end === -1) continue
    const text = source.slice(index + match[0].length, end)
    tags.push({ name, text, offset: index, open: true, closing: false, selfClosing: text.trimEnd().endsWith('/') })
    index = end
  }
  return tags
}

function findTagEnd(source, start) {
  let quote = null
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (depth > 0 && char === '/' && source[index + 1] === '/') {
      const newline = source.indexOf('\n', index)
      index = newline === -1 ? source.length : newline
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '{') { depth += 1; continue }
    if (char === '}') { depth = Math.max(0, depth - 1); continue }
    if (char === '>' && depth === 0) return index
  }
  return -1
}

function findDropdownRanges(tags) {
  const ranges = []
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index]
    if (tag.name !== 'Dropdown' || !tag.open) continue
    if (tag.selfClosing) continue
    const close = tags.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.name === 'Dropdown' && candidate.closing)
    if (close !== -1) ranges.push([tag.offset, tags[close].offset])
  }
  return ranges
}

function inRanges(offset, ranges) {
  return ranges.some(([start, end]) => offset > start && offset < end)
}

function hasAttr(text, name) {
  return new RegExp(`\\s${name}\\s*=`).test(text)
}

function attrValue(text, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(text)
  return match?.[1] ?? null
}

function literalAttr(text, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 's').exec(text)
  return match?.[2] ?? null
}

function isLiveButton(text) {
  if (hasAttr(text, 'onClick') || hasAttr(text, 'disabled') || hasAttr(text, 'formAction')) return true
  const type = attrValue(text, 'type') ?? attrValue(text, 'htmlType')
  return type === 'submit' || type === 'reset'
}
