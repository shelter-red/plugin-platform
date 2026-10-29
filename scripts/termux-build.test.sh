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
  'archive="plugmesh-server-termux-${RELEASE_TAG}.tar.gz"' \
  'sha256sum -c "$archive.sha256"'; do
  grep -Fq -- "$required" <<<"$read_workflow" || { echo "missing Termux release contract: $required" >&2; exit 1; }
done

for required in \
  'CMAKE_CXX_COMPILER="$CXX"' \
  '"-DCMAKE_PREFIX_PATH=${termux_static_prefix:+$termux_static_prefix:}$PREFIX"' \
  '"-DOPENSSL_ROOT_DIR=${termux_static_prefix:-$PREFIX}"' \
  '"-DOPENSSL_USE_STATIC_LIBS=$([[ "$termux_static_deps" == ON ]] && echo ON || echo OFF)"' \
  '-DPLUGMESH_TERMUX=ON' \
  '"-DPLUGMESH_TERMUX_STATIC_DEPS=$termux_static_deps"' \
  '"-DPLUGMESH_TERMUX_STATIC_PREFIX=$termux_static_prefix"' \
  'PLUGMESH_TERMUX_STATIC_PREFIX is required for static Termux dependencies' \
  'libc++.a' \
  'libc++abi.a' \
  'libunwind.a' \
  'libssl.a' \
  'libcrypto.a' \
  'require_embedded_ui=ON' \
  'if [[ "$artifact_type" == SHARED ]]; then' \
  'require_embedded_ui=OFF' \
  '"-DPLUGMESH_REQUIRE_EMBEDDED_UI=$require_embedded_ui"' \
  'native-ui/dist/index.html must be built before compiling the Termux server' \
  'Android Termux' \
  'TERMUX-README.txt' \
  'does not include the plugmesh-server executable' \
  'current Termux CA store' \
  'Native UI is embedded in plugmesh-server' \
  'libc++_shared.so' \
  'missing Termux libc++ runtime' \
  'ca_bundle="$PREFIX/etc/tls/cert.pem"' \
  'ca-certificates.crt' \
  'PLUGMESH_CA_BUNDLE is not readable' \
  '\$PREFIX/etc/tls/cert.pem' \
  '\$PREFIX/etc/tls/certs/ca-bundle.crt' \
  '\$script_dir/ca-certificates.crt' \
  'missing Termux CA bundle' \
  'write_local_launcher' \
  'LD_LIBRARY_PATH' \
  'local binary="$package_dir/$name.bin"' \
  'exec "\$script_dir/$name.bin"' \
  'chmod 0755' \
  'plugmesh-service.sh' \
  'tar -C "$dist_dir" -czf' \
  'sha256sum "$archive_name" > "$archive_name.sha256"'; do
  grep -Fq -- "$required" <<<"$read_script" || { echo "missing Termux build contract: $required" >&2; exit 1; }
done

tmp_root=$(mktemp -d)
trap 'rm -rf "$tmp_root"' EXIT
sim_repo="$tmp_root/repo"
fake_bin="$tmp_root/bin"
prefix="$tmp_root/prefix"
mkdir -p "$sim_repo/native-ui/dist"
mkdir -p "$sim_repo/scripts" "$sim_repo/native-server" "$fake_bin" "$prefix/include/openssl" "$prefix/lib" "$prefix/etc/tls"
cp "$script" "$sim_repo/scripts/build-termux-native.sh"
cp "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/plugmesh-service.sh" "$sim_repo/scripts/plugmesh-service.sh"
printf '%s\n' 'README fixture' > "$sim_repo/native-server/README.md"
printf '%s\n' 'Port mapping fixture' > "$sim_repo/native-server/PORT-MAPPING.md"
printf '%s\n' 'header fixture' > "$prefix/include/openssl/ssl.h"
printf '%s\n' 'library fixture' > "$prefix/lib/libssl.so"
printf '%s\n' 'libc++ fixture' > "$prefix/lib/libc++_shared.so"
printf '%s\n' 'CA bundle fixture' > "$prefix/etc/tls/cert.pem"
printf '%s\n' 'UI fixture' > "$sim_repo/native-ui/dist/index.html"
cat > "$fake_bin/cmake" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TERMUX_CMAKE_LOG"
if [[ "${1:-}" == --build ]]; then
  build_dir="$2"
  mkdir -p "$build_dir/plugins/sample.plugin"
  cat > "$build_dir/plugmesh-server" <<'SERVER'
#!/usr/bin/env bash
printf '%s' "${PLUGMESH_CA_BUNDLE:-}" > "$TERMUX_CA_CAPTURE"
SERVER
  chmod +x "$build_dir/plugmesh-server"
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

TERMUX_CMAKE_LOG="$tmp_root/cmake.log" PREFIX="$prefix" PATH="$fake_bin:$PATH" \
  TERMUX_CA_CAPTURE="$tmp_root/selected-ca" bash "$sim_repo/scripts/build-termux-native.sh" \
  --artifact-type EXECUTABLE --package-name launcher-test --archive-name launcher-test.tar.gz
launcher="$sim_repo/dist/launcher-test/plugmesh-server"
rm "$sim_repo/dist/launcher-test/libc++_shared.so"
run_launcher() {
  env -u PLUGMESH_CA_BUNDLE PREFIX="$prefix" TERMUX_CA_CAPTURE="$tmp_root/selected-ca" "$launcher"
}
run_launcher
[[ "$(<"$tmp_root/selected-ca")" == "$prefix/etc/tls/cert.pem" ]] || {
  echo 'Termux launcher did not prefer the current Termux CA store' >&2
  exit 1
}
printf '%s\n' 'custom CA fixture' > "$tmp_root/custom-ca.pem"
PLUGMESH_CA_BUNDLE="$tmp_root/custom-ca.pem" PREFIX="$prefix" TERMUX_CA_CAPTURE="$tmp_root/selected-ca" "$launcher"
[[ "$(<"$tmp_root/selected-ca")" == "$tmp_root/custom-ca.pem" ]] || {
  echo 'Termux launcher did not preserve the explicit PLUGMESH_CA_BUNDLE override' >&2
  exit 1
}
set +e
PLUGMESH_CA_BUNDLE="$tmp_root/missing-ca.pem" PREFIX="$prefix" TERMUX_CA_CAPTURE="$tmp_root/selected-ca" "$launcher" >/dev/null 2>&1
status=$?
set -e
[[ $status -eq 2 ]] || { echo 'Termux launcher accepted a missing explicit CA bundle' >&2; exit 1; }
mv "$prefix/etc/tls/cert.pem" "$tmp_root/cert.pem.saved"
mkdir -p "$prefix/etc/tls/certs"
printf '%s\n' 'Termux CA fallback fixture' > "$prefix/etc/tls/certs/ca-bundle.crt"
run_launcher
[[ "$(<"$tmp_root/selected-ca")" == "$prefix/etc/tls/certs/ca-bundle.crt" ]] || {
  echo 'Termux launcher did not use the alternate runtime CA path' >&2
  exit 1
}
rm "$prefix/etc/tls/certs/ca-bundle.crt"
run_launcher
[[ "$(<"$tmp_root/selected-ca")" == "$sim_repo/dist/launcher-test/ca-certificates.crt" ]] || {
  echo 'Termux launcher did not fall back to the packaged CA bundle' >&2
  exit 1
}

if grep -Fq -- '--include-ui' <<<"$read_script" || grep -Fq 'package_dir/native-ui/dist' <<<"$read_script"; then
  echo 'Termux CLI must embed UI and must not ship an external native-ui/dist directory' >&2
  exit 1
fi

if grep -Fq '/etc/apt' <<<"$read_script" || grep -Fq 'linux-x86_64' <<<"$read_script" || grep -Fq 'GLIBC_' <<<"$read_script"; then
  echo 'Termux build must not depend on Debian apt, x86_64 OpenSSL, or glibc checks' >&2
  exit 1
fi

main_file="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/native-server/src/main.cpp"
for required in \
  'android_executable_path(const char* argv0)' \
  '#elif defined(__ANDROID__)' \
  'executable_directory(argc > 0 ? argv[0] : nullptr)' \
  'directories.find'; do
  grep -Fq -- "$required" "$main_file" || { echo "missing Android executable path contract: $required" >&2; exit 1; }
done

cmake_file="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/native-server/CMakeLists.txt"
grep -Fq 'NOT PLUGMESH_TERMUX' "$cmake_file" || { echo 'CMake must exclude Termux from Linux runtime flags' >&2; exit 1; }
grep -Fq 'elseif (PLUGMESH_TERMUX)' "$cmake_file" || { echo 'CMake must configure Termux runtime lookup' >&2; exit 1; }
grep -Fq 'set(CMAKE_SKIP_RPATH TRUE)' "$cmake_file" || { echo 'Termux build must disable CMake host RPATH injection' >&2; exit 1; }
grep -Fq 'SKIP_BUILD_RPATH TRUE' "$cmake_file" || { echo 'Termux build must not retain host PREFIX RPATH' >&2; exit 1; }
grep -Fq 'PLUGMESH_TERMUX_FORCE_IPV4' "$cmake_file" || { echo 'Termux build must force IPv4 DNS resolution' >&2; exit 1; }
grep -Fq 'PLUGMESH_TERMUX_STATIC_DEPS' "$cmake_file" || { echo 'Termux CMake must expose static dependency mode' >&2; exit 1; }
grep -Fq 'target_link_options(${target_name}' "$cmake_file" && grep -Fq -- '-nostdlib++' "$cmake_file" || { echo 'Termux static mode must suppress shared libc++' >&2; exit 1; }
grep -Fq '"${PLUGMESH_TERMUX_LIBCXX}" "${PLUGMESH_TERMUX_LIBCXXABI}"' "$cmake_file" || { echo 'Termux static mode must link libc++ and libc++abi archives explicitly' >&2; exit 1; }
grep -Fq '"${PLUGMESH_TERMUX_LIBUNWIND}" dl m c' "$cmake_file" || { echo 'Termux static mode must link libunwind explicitly' >&2; exit 1; }

printf '%s\n' 'Termux build contract passed'
