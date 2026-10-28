#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORKFLOW="$ROOT/.github/workflows/release.yml"
MANUAL_WORKFLOW="$ROOT/.github/workflows/build-plugin-server.yml"

grep -Fq 'name: 发布原生端' "$WORKFLOW"
grep -Fq 'actions/checkout@v4' "$WORKFLOW"
grep -Fq 'run: bash scripts/release-workflow.test.sh' "$WORKFLOW"
grep -Fq 'run: bash scripts/termux-build.test.sh' "$WORKFLOW"
grep -Fq 'run: bash scripts/service-install.test.sh' "$WORKFLOW"
grep -Fq 'c80a01dfc70ece4dc21168932c37739042d404d46ccc81a5986dd75314ecda6f' "$WORKFLOW"
grep -Fq 'Copy-Item native-server/build-win/Release/plugmesh-plugin-host.exe dist/plugmesh-server/' "$WORKFLOW"
grep -Fq 'cp native-server/build/plugmesh-plugin-host dist/plugmesh-server/' "$WORKFLOW"
grep -Fq -- '- os: macos-14' "$WORKFLOW"
grep -Fq 'runs-on: macos-14' "$ROOT/.github/workflows/platform-ci.yml"
tag_pattern='^v[0-9]+([.][0-9]+)*(-[0-9A-Za-z.-]+)?([+][0-9A-Za-z.-]+)?$'
grep -Fq "RELEASE_TAG\" =~ $tag_pattern" "$WORKFLOW"
for tag in v0.3.3 v0.3.2.1 v1.2.3-rc.1+build.4; do
  [[ "$tag" =~ $tag_pattern ]] || { echo "valid release tag rejected: $tag" >&2; exit 1; }
done
for tag in 'v0.3.3/*' 'v1.*' 'v$(id)' 'v1.2.3+'; do
  if [[ "$tag" =~ $tag_pattern ]]; then echo "unsafe release tag accepted: $tag" >&2; exit 1; fi
done
! grep -Fq 'native-ui/dist/' "$WORKFLOW"
! grep -Fq -- '--include-ui' "$WORKFLOW"
! grep -Fq 'plugmesh-port-mapper' "$WORKFLOW"
grep -Fq 'name: 构建 Windows 7 兼容包' "$WORKFLOW"
grep -Fq 'needs: [build, termux, windows7]' "$WORKFLOW"
grep -Fq 'scripts/build-windows7-native.sh' "$WORKFLOW"
grep -Fq -- '--libdir=lib' "$WORKFLOW"
grep -Fq 'OPENSSL_SOURCE_DIR: ${{ runner.temp }}/openssl-3.0.20' "$WORKFLOW"
grep -Fq 'OPENSSL_SOURCE_DIR' "$ROOT/scripts/build-windows7-native.sh"
grep -Fq 'LICENSE.openssl.txt' "$ROOT/scripts/build-windows7-native.sh"
grep -Fq 'plugmesh-server-windows7-${{ env.RELEASE_TAG }}.zip' "$WORKFLOW"
! grep -Fq 'add_executable(plugmesh-port-mapper ' "$ROOT/native-server/CMakeLists.txt"
grep -Fq 'name: 手动构建插件服务器' "$MANUAL_WORKFLOW"
grep -Fq 'matrix.target_platform' "$MANUAL_WORKFLOW"
! grep -Fq 'plugmesh-port-mapper' "$MANUAL_WORKFLOW"

node - "$WORKFLOW" "$ROOT/scripts/build-linux-native.sh" "$MANUAL_WORKFLOW" <<'NODE'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const workflow = fs.readFileSync(process.argv[2], 'utf8')

for (const marker of [
  'Copy-Item native-server/build-win/Release/plugmesh-server.exe dist/plugmesh-server/',
  'cp native-server/build/plugmesh-server dist/plugmesh-server/',
  'Copy-Item native-server/include/plugmesh/*.h dist/plugmesh-server/sdk/include/plugmesh/',
  'cp native-server/include/plugmesh/*.h dist/plugmesh-server/sdk/include/plugmesh/',
  'native-server/build-win/Release/plugmesh-server.dll dist/plugmesh-server/',
  'native-server/build/libplugmesh-server.dylib dist/plugmesh-server/sdk/lib/',
  'libssl.3.dylib',
]) assert.ok(workflow.includes(marker), `正式 Release 缺少可执行包内容：${marker}`)
assert.ok(workflow.includes('name: 构建 Windows 7 兼容包'), 'Release 必须构建独立 Win7 包')
assert.ok(workflow.includes('needs: [build, termux, windows7]'), 'Release 发布必须等待 Win7 包')
assert.ok(workflow.includes('scripts/build-windows7-native.sh'), 'Win7 job 必须调用交叉构建脚本')
assert.ok(workflow.includes('--libdir=lib'), '静态 OpenSSL 必须安装到 CMake 查找的 lib 目录')
assert.ok(workflow.includes('name: plugmesh-server-windows7-${{ env.RELEASE_TAG }}'), 'Win7 ZIP artifact 名必须包含 release tag')
for (const marker of [
  'plugmesh-server-linux-${RELEASE_TAG}.zip',
  'plugmesh-server-windows-$env:RELEASE_TAG.zip',
  'plugmesh-server-macos-${RELEASE_TAG}.zip',
  'plugmesh-server-windows7-${{ env.RELEASE_TAG }}.zip',
  'plugmesh-server-termux-${RELEASE_TAG}.tar.gz',
  'dist/*.sha256',
]) assert.ok(workflow.includes(marker), `Release 资产名/校验文件缺少版本标记：${marker}`)
for (const marker of [
  'plugmesh-server-linux.zip',
  'plugmesh-server-windows.zip',
  'plugmesh-server-windows7.zip',
  'plugmesh-server-macos.zip',
  'plugmesh-server-termux.tar.gz',
]) assert.ok(!workflow.includes(marker), `Release 不得产生无版本归档名：${marker}`)
for (const marker of [
  '`plugmesh-server-linux-${{ env.RELEASE_TAG }}.zip`',
  '`plugmesh-server-windows-${{ env.RELEASE_TAG }}.zip`',
  '`plugmesh-server-windows7-${{ env.RELEASE_TAG }}.zip`',
  '`plugmesh-server-macos-${{ env.RELEASE_TAG }}.zip`',
  '`plugmesh-server-termux-${{ env.RELEASE_TAG }}.tar.gz`',
]) assert.ok(workflow.includes(marker), `Release 页面必须显示实际版本归档名：${marker}`)
assert.ok(!workflow.includes('plugmesh-port-mapper'), 'Release 不得打包独立映射程序')

assert.ok(workflow.indexOf('plugmesh-plugin-host.exe') > workflow.indexOf('Copy-Item native-server/build-win/Release/plugmesh-server.exe'), 'Windows 宿主复制必须位于服务器复制之后')
assert.ok(workflow.indexOf('plugmesh-plugin-host dist/plugmesh-server/') > workflow.indexOf('cp native-server/build/plugmesh-server dist/plugmesh-server/'), 'macOS 宿主复制必须位于服务器复制之后')
const linux = fs.readFileSync(process.argv[3], 'utf8')
for (const marker of ['sdk/lib/', 'server_api.h', 'plugin_api.h', 'ca-certificates.crt', 'plugins/sample.plugin/manifest.json', 'PLUGMESH_REQUIRE_EMBEDDED_UI', 'native-ui/dist/index.html must be built before compiling the server']) {
  assert.ok(linux.includes(marker), `Linux Release 缺少必要内容：${marker}`)
}
assert.ok(!linux.includes('/native-ui/dist/'), 'Linux Release 不得复制外置 native-ui/dist')
const manual = fs.readFileSync(process.argv[4], 'utf8')
assert.ok(manual.includes("matrix.target_platform == 'macos' && 'macos-14'"), '手动 macOS 构建必须固定到 macos-14')
for (const marker of [
  '          - all',
  '          - executable',
  '          - shared',
  'matrix.target_platform',
  'sdk/include/plugmesh',
  'sdk/lib',
  'sdk/examples',
  'sdk/plugins/sample.plugin',
  'PORT-MAPPING.md',
  'plugmesh-plugin-host',
]) assert.ok(manual.includes(marker), `手动构建 workflow 缺少必要内容：${marker}`)
assert.ok(manual.includes('-DPLUGMESH_REQUIRE_EMBEDDED_UI=ON'), '手动可执行构建必须要求嵌入 UI')
assert.ok(!manual.includes('native-ui/dist/'), '手动构建 workflow 不得复制外置 native-ui/dist')
assert.ok(!manual.includes('--include-ui'), '手动构建 workflow 不得使用可选 UI 参数')
assert.ok(!manual.includes('plugmesh-port-mapper'), '手动构建 workflow 不得提供独立映射程序')
const root = require('node:path').dirname(require('node:path').dirname(require('node:path').dirname(process.argv[2])))
const cmake = fs.readFileSync(require('node:path').join(root, 'native-server/CMakeLists.txt'), 'utf8')
const mingw = fs.readFileSync(require('node:path').join(root, 'native-server/cmake/mingw-w64-toolchain.cmake'), 'utf8')
assert.ok(cmake.includes('_WIN32_WINNT=0x0601') && cmake.includes('WINVER=0x0601'), 'Windows 原生目标必须固定 Win7 API 版本')
assert.ok(cmake.includes('--major-subsystem-version,6,--minor-subsystem-version,1') && cmake.includes('/SUBSYSTEM:CONSOLE,6.01'), 'Windows 可执行文件必须固定 Win7 PE subsystem 版本')
assert.ok(mingw.includes('CMAKE_SYSTEM_VERSION 6.1'), 'MinGW 工具链必须固定 Windows 7 系统版本')
const readme = fs.readFileSync(require('node:path').join(root, 'native-server/README.md'), 'utf8')
for (const marker of ['--help', 'PLUGMESH_DEBUG_TLS', 'Worker 的实际 HTTPS 主机名', 'LICENSE.openssl.txt']) {
  assert.ok(readme.includes(marker), `原生 README 缺少 CLI/TLS 用法说明：${marker}`)
}
assert.ok(fs.readFileSync(require('node:path').join(root, 'native-server/src/main.cpp'), 'utf8').includes('std::string(argv[1]) == "--help"'), 'CLI 必须提供 --help')
console.log('release workflow package contract passed')
NODE
