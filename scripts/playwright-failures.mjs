#!/usr/bin/env node
// 把 Playwright 的 JSON 报告转成 GitHub Actions 注解（::error）。
// 这样失败用例的名字与报错会出现在公开可读的 check-run annotation 里，
// 不必登录 GitHub 也能定位 CI 失败原因。
import { readFile } from 'node:fs/promises'

const file = process.argv[2]
if (!file) {
  console.error('用法：node scripts/playwright-failures.mjs <results.json>')
  process.exit(0)
}

const escape = (value) => String(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

let report
try {
  report = JSON.parse(await readFile(file, 'utf8'))
} catch (error) {
  console.log(`::error::无法读取 Playwright JSON 报告 ${file}：${escape(error.message)}`)
  process.exit(0)
}

const failures = []
const walk = (suite, trail) => {
  const path = [...trail, suite.title].filter(Boolean)
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const results = test.results ?? []
      const failed = results.filter((result) => result.status !== 'passed' && result.status !== 'skipped')
      if (results.some((result) => result.status === 'passed') && failed.length === 0) continue
      if (failed.length === 0) continue
      const message = failed
        .flatMap((result) => (result.errors ?? []).map((error) => error.message ?? error.value ?? ''))
        .join('\n')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)[0] ?? `状态：${failed.map((result) => result.status).join(', ')}`
      failures.push({ title: [...path, spec.title].join(' › '), file: spec.file, line: spec.line, message })
    }
  }
  for (const child of suite.suites ?? []) walk(child, path)
}

for (const suite of report.suites ?? []) walk(suite, [])

if (failures.length === 0) {
  console.log('::error::Playwright 以非零码退出，但 JSON 报告里没有失败用例（可能是 webServer 启动失败）。')
  process.exit(0)
}

for (const failure of failures) {
  const location = failure.file ? ` file=${failure.file},line=${failure.line ?? 1}` : ''
  console.log(`::error${location}::${escape(`${failure.title} — ${failure.message}`)}`)
}
console.log(`共 ${failures.length} 个失败用例。`)
