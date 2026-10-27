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
termux_static_deps="${PLUGMESH_TERMUX_STATIC_DEPS:-OFF}"
termux_static_prefix="${PLUGMESH_TERMUX_STATIC_PREFIX:-}"
if [[ "$termux_static_deps" == ON ]]; then
  [[ -n "$termux_static_prefix" ]] || { echo 'PLUGMESH_TERMUX_STATIC_PREFIX is required for static Termux dependencies' >&2; exit 1; }
  [[ -f "$termux_static_prefix/lib/libc++.a" ]] || { echo 'missing static libc++ under PLUGMESH_TERMUX_STATIC_PREFIX' >&2; exit 1; }
  [[ -f "$termux_static_prefix/lib/libc++abi.a" ]] || { echo 'missing static libc++abi under PLUGMESH_TERMUX_STATIC_PREFIX' >&2; exit 1; }
  [[ -f "$termux_static_prefix/lib/libunwind.a" ]] || { echo 'missing static libunwind under PLUGMESH_TERMUX_STATIC_PREFIX' >&2; exit 1; }
  [[ -f "$termux_static_prefix/include/c++/v1/cstddef" ]] || { echo 'missing static libc++ headers under PLUGMESH_TERMUX_STATIC_PREFIX' >&2; exit 1; }
  [[ -f "$termux_static_prefix/lib/libssl.a" && -f "$termux_static_prefix/lib/libcrypto.a" ]] || { echo 'missing static OpenSSL archives under PLUGMESH_TERMUX_STATIC_PREFIX' >&2; exit 1; }
else
  [[ -f "$PREFIX/lib/libssl.so" || -f "$PREFIX/lib/libssl.so.3" ]] || { echo "missing Termux OpenSSL library under $PREFIX" >&2; exit 1; }
  [[ -f "$PREFIX/lib/libc++_shared.so" ]] || { echo "missing Termux libc++ runtime under $PREFIX/lib" >&2; exit 1; }
fi

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
cmake_args=(
  -DCMAKE_BUILD_TYPE="$build_type"
  -DPLUGMESH_BUILD_ARTIFACT="$artifact_type"
  -DCMAKE_CXX_COMPILER="$CXX"
  "-DCMAKE_PREFIX_PATH=${termux_static_prefix:+$termux_static_prefix:}$PREFIX"
  "-DOPENSSL_ROOT_DIR=${termux_static_prefix:-$PREFIX}"
  "-DOPENSSL_USE_STATIC_LIBS=$([[ "$termux_static_deps" == ON ]] && echo ON || echo OFF)"
  -DPLUGMESH_TERMUX=ON
  "-DPLUGMESH_TERMUX_STATIC_DEPS=$termux_static_deps"
  "-DPLUGMESH_TERMUX_STATIC_PREFIX=$termux_static_prefix"
  "-DPLUGMESH_REQUIRE_EMBEDDED_UI=$require_embedded_ui"
)
if [[ "$termux_static_deps" == ON ]]; then
  cmake_args+=(
    "-DOPENSSL_INCLUDE_DIR=$termux_static_prefix/include"
    "-DOPENSSL_SSL_LIBRARY=$termux_static_prefix/lib/libssl.a"
    "-DOPENSSL_CRYPTO_LIBRARY=$termux_static_prefix/lib/libcrypto.a"
  )
fi
cmake -S "$repo_root/native-server" -B "$build_dir" "${cmake_args[@]}"

if [[ "$artifact_type" != SHARED ]]; then
  cmake --build "$build_dir" --target plugmesh-server --parallel
fi
cmake --build "$build_dir" --target plugmesh-plugin-host plugmesh-sample --parallel
if [[ "$artifact_type" == ALL || "$artifact_type" == SHARED ]]; then
  cmake --build "$build_dir" --target plugmesh-server-shared --parallel
fi

mkdir -p "$package_dir/plugins/sample.plugin"
write_local_launcher() {
  local name="$1"
  local binary="$package_dir/$name.bin"
  local launcher="$package_dir/$name"
  mv "$package_dir/$name" "$binary"
  cat > "$launcher" <<EOF
#!/usr/bin/env bash
set -euo pipefail
script_dir=\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
export LD_LIBRARY_PATH="\$script_dir\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
export LD_PRELOAD="\$script_dir/libc++_shared.so\${LD_PRELOAD:+:\$LD_PRELOAD}"
exec "\$script_dir/$name.bin" "\$@"
EOF
  chmod 0755 "$launcher"
}
install_termux_binary() {
  local name="$1"
  cp "$build_dir/$name" "$package_dir/$name"
  if [[ "$termux_static_deps" != ON ]]; then
    write_local_launcher "$name"
  fi
}
if [[ "$artifact_type" != SHARED ]]; then
  install_termux_binary plugmesh-server
fi
install_termux_binary plugmesh-plugin-host
cp "$build_dir/libplugmesh-sample.so" "$build_dir/plugins/sample.plugin/manifest.json" "$package_dir/plugins/sample.plugin/"
if [[ "$artifact_type" == ALL || "$artifact_type" == SHARED ]]; then
  cp "$build_dir/libplugmesh-server.so" "$package_dir/"
fi
if [[ "$termux_static_deps" != ON ]]; then
  cp "$PREFIX/lib/libc++_shared.so" "$package_dir/"
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

This shared package uses the Termux native OpenSSL and zlib libraries.
It is not an APK and not an Android app.
EOF
elif [[ "$termux_static_deps" == ON ]]; then
  cat > "$package_dir/TERMUX-README.txt" <<'EOF'
Plugmesh Android Termux CLI (static C++/OpenSSL build)

Run the server from this directory:
  ./plugmesh-server

The server and plugin host statically carry libc++ and OpenSSL. The executable
only requires Android system libraries, so it does not use the device's global
libc++_shared.so and is not affected by an older Termux C++ runtime.
It is a command-line Linux-like Termux build, not an APK and not an Android app.
Keep the executable and plugins directory together.
EOF
else
  cat > "$package_dir/TERMUX-README.txt" <<'EOF'
Plugmesh Android Termux CLI

Install the native dependencies in Termux:
  pkg update
  pkg install clang cmake make openssl zlib tar coreutils

Run the server from this directory:
  ./plugmesh-server

The package uses the Termux native OpenSSL and zlib libraries and carries the
matching libc++_shared.so runtime beside its binaries. The plugmesh-server and
plugmesh-plugin-host launchers put this directory first in LD_LIBRARY_PATH before
starting their .bin ELF files, so an older global Termux libc++ is not selected.
It is a command-line Linux-like Termux build, not an APK and not an Android app.
The Native UI is embedded in plugmesh-server and refreshed on every start
under the Termux user's data directory. Keep the launchers, their .bin files,
libc++_shared.so, and the plugins directory together.
EOF
fi

rm -f "$dist_dir/$archive_name"
tar -C "$dist_dir" -czf "$dist_dir/$archive_name" "$package_name"
(cd "$dist_dir" && sha256sum "$archive_name" > "$archive_name.sha256")
printf 'Termux package written to %s\n' "$dist_dir/$archive_name"
