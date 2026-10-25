#!/usr/bin/env bash
set -euo pipefail

script="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)/scripts/build-termux-native.sh"
read_script=$(<"$script")

for required in \
  'CMAKE_C_COMPILER="$CC"' \
  'CMAKE_CXX_COMPILER="$CXX"' \
  'CMAKE_PREFIX_PATH="$PREFIX"' \
  'OPENSSL_ROOT_DIR="$PREFIX"' \
  'Android Termux' \
  'TERMUX-README.txt' \
  'tar -C "$dist_dir" -czf'; do
  grep -Fq "$required" <<<"$read_script" || { echo "missing Termux build contract: $required" >&2; exit 1; }
done

if grep -Fq '/etc/apt' <<<"$read_script" || grep -Fq 'linux-x86_64' <<<"$read_script" || grep -Fq 'GLIBC_' <<<"$read_script"; then
  echo 'Termux build must not depend on Debian apt, x86_64 OpenSSL, or glibc checks' >&2
  exit 1
fi

bash -n "$script"
printf '%s\n' 'Termux build contract passed'
