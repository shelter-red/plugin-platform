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
  'require_embedded_ui=ON' \
  'if [[ "$artifact_type" == SHARED ]]; then' \
  'require_embedded_ui=OFF' \
  '-DPLUGMESH_REQUIRE_EMBEDDED_UI="$require_embedded_ui"' \
  'native-ui/dist/index.html must be built before compiling the Termux server' \
  'Android Termux' \
  'TERMUX-README.txt' \
  'does not include the plugmesh-server executable' \
  'Native UI is embedded in plugmesh-server' \
  'tar -C "$dist_dir" -czf' \
  'sha256sum "$archive_name" > "$archive_name.sha256"'; do
  grep -Fq -- "$required" <<<"$read_script" || { echo "missing Termux build contract: $required" >&2; exit 1; }
done

tmp_root=$(mktemp -d)
trap 'rm -rf "$tmp_root"' EXIT
sim_repo="$tmp_root/repo"
fake_bin="$tmp_root/bin"
prefix="$tmp_root/prefix"
mkdir -p "$sim_repo/scripts" "$sim_repo/native-server" "$fake_bin" "$prefix/include/openssl" "$prefix/lib"
cp "$script" "$sim_repo/scripts/build-termux-native.sh"
printf '%s\n' 'README fixture' > "$sim_repo/native-server/README.md"
printf '%s\n' 'Port mapping fixture' > "$sim_repo/native-server/PORT-MAPPING.md"
printf '%s\n' 'header fixture' > "$prefix/include/openssl/ssl.h"
printf '%s\n' 'library fixture' > "$prefix/lib/libssl.so"
cat > "$fake_bin/cmake" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TERMUX_CMAKE_LOG"
if [[ "${1:-}" == --build ]]; then
  build_dir="$2"
  mkdir -p "$build_dir/plugins/sample.plugin"
  printf '%s\n' 'binary fixture' > "$build_dir/plugmesh-plugin-host"
  printf '%s\n' 'library fixture' > "$build_dir/libplugmesh-sample.so"
  printf '%s\n' 'manifest fixture' > "$build_dir/plugins/sample.plugin/manifest.json"
  printf '%s\n' 'shared fixture' > "$build_dir/libplugmesh-server.so"
fi
EOF
cat > "$fake_bin/clang++" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$fake_bin/cmake" "$fake_bin/clang++"
TERMUX_CMAKE_LOG="$tmp_root/cmake.log" PREFIX="$prefix" PATH="$fake_bin:$PATH" \
  bash "$sim_repo/scripts/build-termux-native.sh" --artifact-type SHARED --archive-name shared.tar.gz
if ! grep -Fq -- '-DPLUGMESH_REQUIRE_EMBEDDED_UI=OFF' "$tmp_root/cmake.log"; then
  echo 'Termux SHARED build did not disable the embedded UI requirement' >&2
  exit 1
fi
if [[ -e "$sim_repo/dist/plugmesh-server-termux/plugmesh-server" ]] || \
   ! grep -Fq -- 'does not include the plugmesh-server executable' "$sim_repo/dist/plugmesh-server-termux/TERMUX-README.txt"; then
  echo 'Termux SHARED package contract incorrectly advertises a server executable' >&2
  exit 1
fi

if grep -Fq -- '--include-ui' <<<"$read_script" || grep -Fq 'package_dir/native-ui/dist' <<<"$read_script"; then
  echo 'Termux CLI must embed UI and must not ship an external native-ui/dist directory' >&2
  exit 1
fi

if grep -Fq '/etc/apt' <<<"$read_script" || grep -Fq 'linux-x86_64' <<<"$read_script" || grep -Fq 'GLIBC_' <<<"$read_script"; then
  echo 'Termux build must not depend on Debian apt, x86_64 OpenSSL, or glibc checks' >&2
  exit 1
fi

cmake_file="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/native-server/CMakeLists.txt"
grep -Fq 'NOT PLUGMESH_TERMUX' "$cmake_file" || { echo 'CMake must exclude Termux from Linux runtime flags' >&2; exit 1; }

printf '%s\n' 'Termux build contract passed'
