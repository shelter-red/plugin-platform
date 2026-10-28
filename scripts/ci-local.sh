#!/usr/bin/env bash
# 推送前本地复现 CI 的 web job：固定顺序、任一步失败立即退出。
# 之所以固定顺序：ui:conventions / ui:css-audit 秒级完成，先跑能把“死控件、死样式”
# 这类最容易在 CI 上暴露的问题挡在推送之前；ui:smoke 最慢，放最后。
# 有 docker 时用与 CI 相同的 Playwright 镜像跑 ui:smoke（像素基线对字体和发行版敏感，
# 宿主机直接跑会因 CJK 回退字体不同而误报）。
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n=== %s ===\n' "$1"; }

step 'UI 约定审计'
npm run --silent ui:conventions

step '样式死代码审计'
npm run --silent ui:css-audit

step '原生 Release 打包契约'
npm run --silent release:workflow:test

step 'Termux CLI 构建契约'
npm run --silent native:termux:test

step 'Native service lifecycle contract'
npm run --silent native:service:test

npm run --silent worker:typecheck

step '构建管理端'
npm run --silent build

step 'Worker smoke'
npm run --silent worker:smoke

step '管理端 UI smoke（含双主题×三视口像素基线）'
# CI=1 不只影响报告：playwright.config.ts 里的重试次数和断言超时都按 CI 取值，
# 不设这个变量跑出来的「全绿」并不等于 Actions 上的行为。
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker run --rm --ipc=host \
    --user "$(id -u):$(id -g)" \
    -e CI=1 -e HOME=/tmp \
    -v "$PWD:/w" -w /w \
    mcr.microsoft.com/playwright:v1.55.1-noble npm run ui:smoke
else
  echo '未检测到可用的 docker，改为在宿主机执行；像素基线可能与 CI 有差异。' >&2
  CI=1 npm run ui:smoke
fi

printf '\n全部通过：可以推送（CI 的 web job 与本脚本同序）。\n'
