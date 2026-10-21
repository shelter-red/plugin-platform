#!/usr/bin/env bash
# 用 Wine 运行 Windows 构建的本地 UI smoke 服务器，并对它执行 native-ui Playwright 用例。
# 用法：native-ui/run-wine-smoke.sh [windows-build-directory]
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
build=${1:-"$root/native-server/build-win"}
server="$build/plugmesh-local-ui-smoke-server.exe"
if [ ! -f "$server" ]; then
  echo "missing $server；请先按 native-server/README.md「Windows 构建」交叉编译" >&2
  exit 1
fi

export WINEPREFIX=${WINEPREFIX:-"$HOME/.wine-plugmesh"}
export WINEDEBUG=${WINEDEBUG:--all}
export PLUGMESH_SMOKE_PLUGIN_DIRECTORY
PLUGMESH_SMOKE_PLUGIN_DIRECTORY=$(winepath -w "$build/plugins")
ui_directory=$(winepath -w "$root/native-ui/dist")

logs=$(mktemp -d)
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap cleanup EXIT

start() {
  wine64 "$server" "$1" "$ui_directory" "$2" >"$logs/$2.log" 2>&1 &
  pids+=($!)
}

wait_for() {
  local code
  for _ in $(seq 1 150); do
    code=$(curl -s -o /dev/null -m 1 -w '%{http_code}' "http://127.0.0.1:$1/api/session" || true)
    if [ "$code" != "000" ] && [ -n "$code" ]; then return 0; fi
    sleep 0.2
  done
  return 1
}

start 18771 authenticated
start 18772 setup
wait_for 18771 || { echo 'authenticated smoke server did not start' >&2; cat "$logs/authenticated.log" >&2; exit 1; }
wait_for 18772 || { echo 'setup smoke server did not start' >&2; cat "$logs/setup.log" >&2; exit 1; }

PLUGMESH_NATIVE_UI_SMOKE_URL=http://127.0.0.1:18771 \
PLUGMESH_NATIVE_UI_SETUP_URL=http://127.0.0.1:18772 \
  npx playwright test --config "$root/native-ui/playwright.config.ts"
