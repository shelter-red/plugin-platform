#!/usr/bin/env bash
set -euo pipefail

script="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/build-termux-native.sh"
workflow="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/.github/workflows/release.yml"
read_script=$(<"$script")
read_workflow=$(<"$workflow")

for required in \
  'id: prebuilt' \
  'ref="termux-release-${RELEASE_TAG}"' \
  'test "$(cat termux-prebuilt/SOURCE_COMMIT)" = "$GITHUB_SHA"' \
  'sha256sum -c plugmesh-server-termux.tar.gz.sha256'; do
  grep -Fq -- "$required" <<<"$read_workflow" || { echo "missing Termux release contract: $required" >&2; exit 1; }
done

for required in \
  'CMAKE_C_COMPILER="$CC"' \
  'CMAKE_CXX_COMPILER="$CXX"' \
  'CMAKE_PREFIX_PATH="$PREFIX"' \
  'OPENSSL_ROOT_DIR="$PREFIX"' \
  '-DPLUGMESH_TERMUX=ON' \
  'Android Termux' \
  'TERMUX-README.txt' \
  'Native UI is optional' \
  'tar -C "$dist_dir" -czf' \
  'sha256sum "$archive_name" > "$archive_name.sha256"'; do
  grep -Fq -- "$required" <<<"$read_script" || { echo "missing Termux build contract: $required" >&2; exit 1; }
done

if grep -Fq '/etc/apt' <<<"$read_script" || grep -Fq 'linux-x86_64' <<<"$read_script" || grep -Fq 'GLIBC_' <<<"$read_script"; then
  echo 'Termux build must not depend on Debian apt, x86_64 OpenSSL, or glibc checks' >&2
  exit 1
fi

cmake_file="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/native-server/CMakeLists.txt"
grep -Fq 'NOT PLUGMESH_TERMUX' "$cmake_file" || { echo 'CMake must exclude Termux from Linux runtime flags' >&2; exit 1; }

printf '%s\n' 'Termux build contract passed'
