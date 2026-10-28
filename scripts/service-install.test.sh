#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
service="$root/scripts/plugmesh-service.sh"
windows="$root/scripts/install-plugmesh-service.ps1"
[[ -x "$service" ]] || { echo 'plugmesh service script must be executable' >&2; exit 1; }
bash -n "$service"
grep -Fq 'systemd/user' "$service"
grep -Fq 'LaunchAgents' "$service"
grep -Fq 'var/service' "$service"
grep -Fq 'schtasks.exe' "$windows"
grep -Fq "Join-Path \$PSScriptRoot 'plugmesh-server.exe'" "$windows"
grep -Fq 'ONLOGON' "$windows"
grep -Fq 'CMAKE_SYSTEM_VERSION 6.1' "$root/native-server/cmake/mingw-w64-toolchain.cmake"
grep -Fq 'OPENSSL_ROOT_DIR' "$root/scripts/build-windows7-native.sh"
grep -Fq 'plugmesh-service.sh' "$root/native-server/src/main.cpp"
grep -Fq 'install-plugmesh-service.ps1' "$root/native-server/src/main.cpp"
grep -Fq 'plugmesh-service.sh' "$root/.github/workflows/release.yml"
grep -Fq 'install-plugmesh-service.ps1' "$root/.github/workflows/release.yml"
grep -Fq 'plugmesh-service.sh' "$root/scripts/build-linux-native.sh"
grep -Fq 'plugmesh-service.sh' "$root/scripts/build-termux-native.sh"
echo 'native service installation contract passed'
