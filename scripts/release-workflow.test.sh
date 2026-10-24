#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORKFLOW="$ROOT/.github/workflows/release.yml"

grep -Fq 'Copy-Item native-server/build-win/Release/plugmesh-plugin-host.exe dist/plugmesh-server/' "$WORKFLOW"
grep -Fq 'Copy-Item native-server/include/plugmesh/plugin_api.h dist/plugmesh-server/' "$WORKFLOW"
grep -Fq 'cp native-server/build/plugmesh-plugin-host dist/plugmesh-server/' "$WORKFLOW"
grep -Fq 'cp native-server/include/plugmesh/plugin_api.h dist/plugmesh-server/' "$WORKFLOW"

node - "$WORKFLOW" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const workflow = fs.readFileSync(process.argv[2], 'utf8')

for (const marker of [
  'Copy-Item native-server/build-win/Release/plugmesh-server.exe dist/plugmesh-server/',
  'cp native-server/build/plugmesh-server dist/plugmesh-server/',
  'Copy-Item native-server/include/plugmesh/plugin_api.h dist/plugmesh-server/',
  'cp native-server/include/plugmesh/plugin_api.h dist/plugmesh-server/',
]) assert.ok(workflow.includes(marker), `正式 Release 缺少可执行包内容：${marker}`)

assert.ok(workflow.indexOf('plugmesh-plugin-host.exe') > workflow.indexOf('Copy-Item native-server/build-win/Release/plugmesh-server.exe'), 'Windows 宿主复制必须位于服务器复制之后')
assert.ok(workflow.indexOf('plugmesh-plugin-host dist/plugmesh-server/') > workflow.indexOf('cp native-server/build/plugmesh-server dist/plugmesh-server/'), 'macOS 宿主复制必须位于服务器复制之后')
console.log('release workflow package contract passed')
NODE
