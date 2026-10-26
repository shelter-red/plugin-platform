#!/usr/bin/env bash
set -euo pipefail

artifact_type=ALL
build_type=Release
package_name=plugmesh-server-termux
archive_name=plugmesh-server-termux.tar.gz

while (($#)); do
  case "$1" in
    --artifact-type) artifact_type="$2"; shift 2 ;;
    --build-type) build_type="$2"; shift 2 ;;
    --package-name) package_name="$2"; shift 2 ;;
    --archive-name) archive_name="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$artifact_type" != ALL && "$artifact_type" != EXECUTABLE && "$artifact_type" != SHARED ]]; then
  echo "invalid artifact type: $artifact_type" >&2
  exit 2
fi
[[ "$archive_name" == *.tar.gz ]] || { echo 'Termux archive must use .tar.gz' >&2; exit 2; }

: "${PREFIX:?Termux PREFIX is required; run this script inside Termux}"
for command in cmake clang++ tar sha256sum; do
  command -v "$command" >/dev/null || { echo "missing command: $command (install it with pkg)" >&2; exit 1; }
done
[[ -f "$PREFIX/include/openssl/ssl.h" ]] || { echo "missing Termux OpenSSL headers under $PREFIX" >&2; exit 1; }
[[ -f "$PREFIX/lib/libssl.so" || -f "$PREFIX/lib/libssl.so.3" ]] || { echo "missing Termux OpenSSL library under $PREFIX" >&2; exit 1; }

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/.." && pwd)
require_embedded_ui=ON
if [[ "$artifact_type" == SHARED ]]; then
  require_embedded_ui=OFF
else
  [[ -f "$repo_root/native-ui/dist/index.html" ]] || { echo 'native-ui/dist/index.html must be built before compiling the Termux server' >&2; exit 1; }
fi
build_dir="$repo_root/native-server/build-termux"
dist_dir="$repo_root/dist"
package_dir="$dist_dir/$package_name"
rm -rf "$package_dir"
mkdir -p "$dist_dir"

export CXX="${CXX:-clang++}"
cmake -S "$repo_root/native-server" -B "$build_dir" \
  -DCMAKE_BUILD_TYPE="$build_type" \
  -DPLUGMESH_BUILD_ARTIFACT="$artifact_type" \
  -DCMAKE_CXX_COMPILER="$CXX" \
  -DCMAKE_PREFIX_PATH="$PREFIX" \
  -DOPENSSL_ROOT_DIR="$PREFIX" \
  -DOPENSSL_USE_STATIC_LIBS=OFF \
  -DPLUGMESH_TERMUX=ON \
  -DPLUGMESH_REQUIRE_EMBEDDED_UI="$require_embedded_ui"

if [[ "$artifact_type" != SHARED ]]; then
  cmake --build "$build_dir" --target plugmesh-server --parallel
fi
cmake --build "$build_dir" --target plugmesh-plugin-host plugmesh-sample --parallel
if [[ "$artifact_type" == ALL || "$artifact_type" == SHARED ]]; then
  cmake --build "$build_dir" --target plugmesh-server-shared --parallel
fi

mkdir -p "$package_dir/plugins/sample.plugin"
if [[ "$artifact_type" != SHARED ]]; then
  cp "$build_dir/plugmesh-server" "$package_dir/"
fi
cp "$build_dir/plugmesh-plugin-host" "$package_dir/"
cp "$build_dir/libplugmesh-sample.so" "$build_dir/plugins/sample.plugin/manifest.json" "$package_dir/plugins/sample.plugin/"
if [[ "$artifact_type" == ALL || "$artifact_type" == SHARED ]]; then
  cp "$build_dir/libplugmesh-server.so" "$package_dir/"
fi
cp "$repo_root/native-server/README.md" "$repo_root/native-server/PORT-MAPPING.md" "$package_dir/"

printf '类型：%s\n平台：Android Termux (%s)\n构建类型：%s\n依赖：Termux clang/cmake/openssl/zlib\n' \
  "${artifact_type,,}" "$(uname -m)" "$build_type" > "$package_dir/BUILD-INFO.txt"
if [[ "$artifact_type" == SHARED ]]; then
  cat > "$package_dir/TERMUX-README.txt" <<'EOF'
Plugmesh Android Termux shared library package

This package contains the Plugmesh server shared library, plugin host, and
sample plugin for Termux. It does not include the plugmesh-server executable
or an embedded Native UI. Build an EXECUTABLE or ALL package to run the server.

The package uses Termux's native OpenSSL and zlib libraries. It is not an APK
and not an Android app.
EOF
else
  cat > "$package_dir/TERMUX-README.txt" <<'EOF'
Plugmesh Android Termux CLI

Install the native dependencies in Termux:
  pkg update
  pkg install clang cmake make openssl zlib tar coreutils

Run the server from this directory:
  ./plugmesh-server

The package uses Termux's native OpenSSL and zlib libraries. It is a
command-line Linux-like Termux build, not an APK and not an Android app.
The Native UI is embedded in plugmesh-server and refreshed on every start
under the Termux user's data directory. No separate UI directory is needed.
Keep plugmesh-server, plugmesh-plugin-host, and the plugins directory together.
EOF
fi

rm -f "$dist_dir/$archive_name"
tar -C "$dist_dir" -czf "$dist_dir/$archive_name" "$package_name"
(cd "$dist_dir" && sha256sum "$archive_name" > "$archive_name.sha256")
printf 'Termux package written to %s\n' "$dist_dir/$archive_name"
