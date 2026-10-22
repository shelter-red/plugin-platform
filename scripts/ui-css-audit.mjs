#!/usr/bin/env node
// 样式死代码审计：styles.css 里的每个类选择器都必须能在 TSX/HTML 的字符串字面量里找到，
// 否则说明控件已迁到 AntD、旧手写皮肤却还留着。AntD 自身的 .ant-* 类不在审计范围内。
// 同时拦截“同一选择器重复定义”，避免后写的规则静默覆盖前面（历史上 .toggle 定义过两次）。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

// 组件用属性值拼接出来的修饰类，逐条写明原因。
const ALLOW = new Map([
  ['warning', 'StatusBadge 的 tone="warning" 拼在 className 里'],
  ['blue', 'Overview 指标卡的 tone 属性拼在 className 里'],
  ['purple', 'Overview 指标卡的 tone 属性拼在 className 里'],
  ['amber', 'Overview 指标卡的 tone 属性拼在 className 里'],
])

const root = resolve(process.argv[2] ?? 'src')
const cssPath = join(root, 'styles.css')
const css = readFileSync(cssPath, 'utf8')
const tokens = collectTokens(root)
const rules = parseRules(css)
const violations = []

for (const rule of rules) {
  for (const selector of rule.selector.split(',')) {
    for (const name of selector.matchAll(/\.([A-Za-z][\w-]*)/g)) {
      const className = name[1]
      if (className.startsWith('ant-')) continue
      if (ALLOW.has(className) || tokens.has(className)) continue
      violations.push({ at: `${relative(process.cwd(), cssPath)}:${rule.line}`, rule: 'dead-class', message: `类 .${className} 在 ${rule.selector.trim()} 中已无任何 TSX 引用，请删除该规则` })
    }
  }
}

const seen = new Map()
for (const rule of rules) {
  const key = `${rule.context} ${rule.selector.replace(/\s+/g, ' ').trim()}`
  const previous = seen.get(key)
  if (previous) {
    violations.push({ at: `${relative(process.cwd(), cssPath)}:${rule.line}`, rule: 'duplicate-selector', message: `选择器 ${rule.selector.replace(/\s+/g, ' ').trim()} 已在第 ${previous} 行定义过，请合并为一条规则` })
  } else {
    seen.set(key, rule.line)
  }
}

const unique = [...new Map(violations.map((item) => [`${item.rule}:${item.message}`, item])).values()]
if (unique.length === 0) {
  console.log(`ui:css-audit 通过：${rules.length} 条规则，0 处死代码/重复定义`)
  process.exit(0)
}
for (const item of unique) console.error(`${item.at} [${item.rule}] ${item.message}`)
console.error(`\nui:css-audit 失败：${unique.length} 处问题（审计 ${rules.length} 条规则）`)
process.exit(1)

function collectTokens(dir) {
  const tokens = new Set()
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const child = join(path, entry.name)
      if (statSync(child).isDirectory()) walk(child)
      else if (entry.name.endsWith('.tsx')) scan(readFileSync(child, 'utf8'))
      else if (entry.name.endsWith('.html')) scanHtml(readFileSync(child, 'utf8'))
    }
  }
  // 只从 className / rowClassName / rootClassName / classList.* 取值，
  // 避免把文案里恰好出现的英文单词当成类名（会把死规则误判为存活）。
  const scan = (source) => {
    for (const match of source.matchAll(/(?:className|rowClassName|rootClassName|overlayClassName|wrapClassName)\s*=\s*/g)) {
      let index = match.index + match[0].length
      const first = source[index]
      if (first === '"' || first === "'") {
        const end = source.indexOf(first, index + 1)
        addTokens(source.slice(index + 1, end))
      } else if (first === '{') {
        const end = matchBrace(source, index)
        for (const literal of source.slice(index + 1, end).matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) addTokens(literal[1] ?? literal[2] ?? literal[3] ?? '')
      }
    }
    for (const match of source.matchAll(/classList\.(?:add|remove|toggle)\(([^)]*)\)/g)) {
      for (const literal of match[1].matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) addTokens(literal[1] ?? literal[2] ?? literal[3] ?? '')
    }
  }
  const scanHtml = (source) => {
    for (const match of source.matchAll(/class\s*=\s*"([^"]*)"/g)) addTokens(match[1])
  }
  const addTokens = (raw) => {
    for (const part of raw.split('${{')) {
      for (const token of part.split(/[\s{}?:+()'"`,;/]+/)) if (token) tokens.add(token)
    }
  }
  walk(dir)
  return tokens
}

// 返回与 source[start] 处 '{' 配对的 '}' 下标。
function matchBrace(source, start) {
  let depth = 0
  let quote = null
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (char === '\\') index += 1
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === '{') depth += 1
    else if (char === '}') { depth -= 1; if (depth === 0) return index }
  }
  return source.length
}

// 只解析顶层与 @media 内的规则：.ant-* / 元素选择器也一并收集，便于重复定义检查。
// 同一选择器在不同 @media 里各写一次是正常的，因此重复判定按 @media 上下文分组。
function parseRules(source) {
  const rules = []
  const stack = []
  let buffer = ''
  let line = 1
  let bufferLine = 1
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\n') { line += 1; continue }
    if (char === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2)
      const comment = source.slice(index, end === -1 ? source.length : end + 2)
      line += (comment.match(/\n/g) ?? []).length
      index = end === -1 ? source.length : end + 1
      continue
    }
    if (char === '{') {
      const selector = buffer.trim()
      const parent = stack.at(-1)
      const context = parent ? parent.childContext : ''
      stack.push({ selector, line: bufferLine, context, childContext: selector.startsWith('@') ? `${context}|${selector}` : context })
      buffer = ''
      continue
    }
    if (char === '}') {
      const block = stack.pop()
      if (block && block.selector && !block.selector.startsWith('@') && !block.context.includes('@keyframes')) rules.push(block)
      buffer = ''
      continue
    }
    if (!buffer.trim()) bufferLine = line
    buffer += char
  }
  return rules
}
