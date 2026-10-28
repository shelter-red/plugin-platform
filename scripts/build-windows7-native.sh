#!/usr/bin/env bash
set -euo pipefail

# Build the Win7-compatible MinGW artifact. The OpenSSL prefix must contain
# libraries built with Configure mingw64 and no-shared (see native-server/README.md).
openssl_root="${OPENSSL_ROOT_DIR:-}"
openssl_source="${OPENSSL_SOURCE_DIR:-}"
build_dir="${PLUGMESH_WIN7_BUILD_DIR:-$PWD/native-server/build-win7}"
out_dir="${PLUGMESH_WIN7_OUTPUT_DIR:-$PWD/dist/plugmesh-server-windows7}"
archive="${PLUGMESH_WIN7_ARCHIVE:-$PWD/dist/plugmesh-server-windows7.zip}"
[[ -n "$openssl_root" ]] || { echo 'OPENSSL_ROOT_DIR is required' >&2; exit 2; }
[[ -f "$openssl_root/lib/libssl.a" && -f "$openssl_root/lib/libcrypto.a" ]] || {
  echo 'Win7 MinGW build requires static libssl.a and libcrypto.a' >&2; exit 1;
}
[[ -n "$openssl_source" && -f "$openssl_source/LICENSE.txt" ]] || {
  echo 'OPENSSL_SOURCE_DIR must point to OpenSSL source containing LICENSE.txt' >&2; exit 1;
}
command -v x86_64-w64-mingw32-g++-posix >/dev/null || { echo 'install the MinGW-w64 POSIX toolchain first' >&2; exit 1; }
[[ -f native-ui/dist/index.html ]] || { echo 'build native-ui/dist before compiling' >&2; exit 1; }
cmake -S native-server -B "$build_dir" \
  -DCMAKE_TOOLCHAIN_FILE="$PWD/native-server/cmake/mingw-w64-toolchain.cmake" \
  -DOPENSSL_ROOT_DIR="$openssl_root" \
  -DOPENSSL_USE_STATIC_LIBS=ON \
  -DCMAKE_BUILD_TYPE=Release \
  -DPLUGMESH_REQUIRE_EMBEDDED_UI=ON
cmake --build "$build_dir" --target plugmesh-server plugmesh-plugin-host plugmesh-sample --parallel
rm -rf "$out_dir"
mkdir -p "$out_dir/plugins/sample.plugin"
cp "$build_dir/plugmesh-server.exe" "$build_dir/plugmesh-plugin-host.exe" "$out_dir/"
cp "$build_dir/libplugmesh-sample.dll" "$build_dir/plugins/sample.plugin/manifest.json" "$out_dir/plugins/sample.plugin/"
cp native-server/README.md native-server/PORT-MAPPING.md scripts/install-plugmesh-service.ps1 "$out_dir/"
cp "$openssl_source/LICENSE.txt" "$out_dir/LICENSE.openssl.txt"
( cd "$(dirname "$archive")" && rm -f "$(basename "$archive")" && zip -qr "$(basename "$archive")" "$(basename "$out_dir")" )
( cd "$(dirname "$archive")" && sha256sum "$(basename "$archive")" > "$(basename "$archive").sha256" )
printf 'Win7 MinGW package written to %s\n' "$archive"
