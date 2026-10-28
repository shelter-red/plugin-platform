#!/usr/bin/env bash
set -euo pipefail

artifact_type=ALL
build_type=Release
package_name=plugmesh-server
archive_name=plugmesh-server-linux.zip
archive_format=zip

while (($#)); do
  case "$1" in
    --artifact-type) artifact_type="$2"; shift 2 ;;
    --build-type) build_type="$2"; shift 2 ;;
    --package-name) package_name="$2"; shift 2 ;;
    --archive-name) archive_name="$2"; shift 2 ;;
    --archive-format) archive_format="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ "$artifact_type" != ALL && "$artifact_type" != EXECUTABLE && "$artifact_type" != SHARED ]]; then
  echo "invalid artifact type: $artifact_type" >&2
  exit 2
fi
if [[ "$archive_format" != zip && "$archive_format" != tar ]]; then
  echo "invalid archive format: $archive_format" >&2
  exit 2
fi

if [[ "$artifact_type" != SHARED ]]; then
  [[ -f native-ui/dist/index.html ]] || { echo 'native-ui/dist/index.html must be built before compiling the server' >&2; exit 1; }
  require_embedded_ui=ON
else
  require_embedded_ui=OFF
fi

export DEBIAN_FRONTEND=noninteractive
# Debian 11 is the glibc 2.31 compatibility baseline. It is archived now,
# so use the immutable archive endpoints instead of the retired security mirror.
printf '%s\n' \
  'deb http://archive.debian.org/debian bullseye main' \
  'deb http://archive.debian.org/debian bullseye-updates main' \
  'deb http://archive.debian.org/debian-security bullseye-security main' \
  > /etc/apt/sources.list
rm -f /etc/apt/sources.list.d/debian.sources
printf '%s\n' 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99plugmesh-archive
apt-get update
apt-get install -y --no-install-recommends \
  build-essential ca-certificates cmake curl file make perl zlib1g-dev zip binutils

openssl_version=3.0.20
openssl_prefix=/opt/plugmesh-openssl
openssl_source=/tmp/openssl-$openssl_version
if [[ ! -x "$openssl_prefix/bin/openssl" ]]; then
  rm -rf "$openssl_source"
  curl --fail --location --retry 3 --output "/tmp/openssl-$openssl_version.tar.gz" \
    "https://deb.debian.org/debian/pool/main/o/openssl/openssl_${openssl_version}.orig.tar.gz"
  tar -xzf "/tmp/openssl-$openssl_version.tar.gz" -C /tmp
  cd "$openssl_source"
  ./Configure linux-x86_64 shared no-tests --prefix="$openssl_prefix"
  make -j"$(nproc)"
  make install_sw
fi

cd /src
build_dir=/src/native-server/build-linux-baseline
openssl_libdir=$(dirname "$(find "$openssl_prefix" -type f -name 'libssl.so.3' -print -quit)")
[[ -f "$openssl_libdir/libssl.so.3" && -f "$openssl_libdir/libcrypto.so.3" ]] || {
  echo "OpenSSL 3 libraries were not installed under $openssl_prefix" >&2
  exit 1
}
cmake -S native-server -B "$build_dir" \
  -DCMAKE_BUILD_TYPE="$build_type" \
  -DPLUGMESH_BUILD_ARTIFACT="$artifact_type" \
  -DOPENSSL_ROOT_DIR="$openssl_prefix" \
  -DOPENSSL_INCLUDE_DIR="$openssl_prefix/include" \
  -DOPENSSL_SSL_LIBRARY="$openssl_libdir/libssl.so.3" \
  -DOPENSSL_CRYPTO_LIBRARY="$openssl_libdir/libcrypto.so.3" \
  -DOPENSSL_USE_STATIC_LIBS=OFF \
  -DPLUGMESH_REQUIRE_EMBEDDED_UI="$require_embedded_ui"

if [[ "$artifact_type" == SHARED ]]; then
  cmake --build "$build_dir" --target plugmesh-server-shared plugmesh-plugin-host plugmesh-sample --parallel
else
  cmake --build "$build_dir" --target plugmesh-server plugmesh-plugin-host plugmesh-sample --parallel
fi
if [[ "$artifact_type" == ALL ]]; then
  cmake --build "$build_dir" --target plugmesh-server-shared --parallel
fi

check_abi() {
  local file="$1"
  local highest
  highest=$(readelf --version-info "$file" 2>/dev/null | grep -oE 'GLIBC_[0-9]+\.[0-9]+' | sort -Vu | tail -n 1 || true)
  if [[ -n "$highest" ]] && [[ "$(printf '%s\n' GLIBC_2.31 "$highest" | sort -V | tail -n 1)" != GLIBC_2.31 ]]; then
    echo "glibc baseline exceeded by $file: $highest" >&2
    exit 1
  fi
  if readelf --version-info "$file" 2>/dev/null | grep -qE 'GLIBCXX_|CXXABI_'; then
    echo "C++ runtime ABI leaked into $file" >&2
    exit 1
  fi
}

mkdir -p "/src/dist/$package_name/sdk"
if [[ "$artifact_type" != SHARED ]]; then
  cp "$build_dir/plugmesh-server" "/src/dist/$package_name/"
  check_abi "$build_dir/plugmesh-server"
fi
if [[ "$artifact_type" != EXECUTABLE ]]; then
  mkdir -p "/src/dist/$package_name/sdk/lib"
  cp "$build_dir/libplugmesh-server.so" "/src/dist/$package_name/"
  cp "$build_dir/libplugmesh-server.so" "/src/dist/$package_name/sdk/lib/"
  cp "$openssl_libdir/libssl.so.3" "$openssl_libdir/libcrypto.so.3" "/src/dist/$package_name/sdk/lib/"
  check_abi "$build_dir/libplugmesh-server.so"
fi
cp "$build_dir/plugmesh-plugin-host" "/src/dist/$package_name/"
mkdir -p "/src/dist/$package_name/sdk/plugins/sample.plugin"
cp "$build_dir/libplugmesh-sample.so" "$build_dir/plugins/sample.plugin/manifest.json" "/src/dist/$package_name/sdk/plugins/sample.plugin/"
check_abi "$build_dir/plugmesh-plugin-host"
for library in libssl.so.3 libcrypto.so.3; do
  library_path="$openssl_libdir/$library"
  [[ -f "$library_path" ]] || { echo "missing $library_path" >&2; exit 1; }
  cp -L "$library_path" "/src/dist/$package_name/"
  check_abi "$library_path"
done

mkdir -p "/src/dist/$package_name/sdk/include/plugmesh"
cp native-server/include/plugmesh/server_api.h native-server/include/plugmesh/plugin_api.h "/src/dist/$package_name/sdk/include/plugmesh/"
cp native-server/examples/sample_plugin.cpp "/src/dist/$package_name/sdk/"
cp native-server/PORT-MAPPING.md "/src/dist/$package_name/PORT-MAPPING.md"
cp native-server/README.md "/src/dist/$package_name/README.md"
cp scripts/plugmesh-service.sh "/src/dist/$package_name/plugmesh-service.sh"
chmod +x "/src/dist/$package_name/plugmesh-service.sh"
cp /etc/ssl/certs/ca-certificates.crt "/src/dist/$package_name/ca-certificates.crt"

printf '类型：%s\n平台：Linux x86_64\n构建类型：%s\n' "${artifact_type,,}" "$build_type" > "/src/dist/$package_name/BUILD-INFO.txt"
if [[ "$archive_format" == zip ]]; then
  (cd /src/dist && zip -qr "$archive_name" "$package_name")
  (cd /src/dist && sha256sum "$archive_name" > SHA256SUMS)
else
  tar -C /src/dist -czf "/src/dist/$archive_name" "$package_name"
  (cd /src/dist && sha256sum "$archive_name" > SHA256SUMS)
fi
