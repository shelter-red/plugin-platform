#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service="$root/scripts/plugmesh-service.sh"
windows="$root/scripts/install-plugmesh-service.ps1"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

[[ -x "$service" ]] || { echo 'plugmesh service script must be executable' >&2; exit 1; }
bash -n "$service"
grep -Fq 'systemd/user' "$service"
grep -Fq 'LaunchAgents' "$service"
grep -Fq '"$name" != "." && "$name" != ".."' "$service"
! grep -Fq 'python3 -' "$service"
grep -Fq 'var/service' "$service"
grep -Fq 'sv_termux up' "$service"
grep -Fq 'sv_termux down' "$service"
grep -Fq 'sv_termux status' "$service"
grep -Fq 'schtasks.exe' "$windows"
grep -Fq "Join-Path \$PSScriptRoot 'plugmesh-server.exe'" "$windows"
grep -Fq '<LogonTrigger>' "$windows"
grep -Fq 'EnvironmentFile is not supported' "$windows"
grep -Fq '<RestartOnFailure>' "$windows"
grep -Fq '<Interval>PT1M</Interval>' "$windows"
grep -Fq '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>' "$windows"
grep -Fq '$task = "Plugmesh-$Name"' "$windows"
grep -Fq '$legacyTask = "Plugmesh' "$windows"
grep -Fq "or \$Name -in @('.', '..')" "$windows"
grep -Fq 'CMAKE_SYSTEM_VERSION 6.1' "$root/native-server/cmake/mingw-w64-toolchain.cmake"
grep -Fq 'OPENSSL_ROOT_DIR' "$root/scripts/build-windows7-native.sh"
grep -Fq 'plugmesh-service.sh' "$root/native-server/src/main.cpp"
grep -Fq 'install-plugmesh-service.ps1' "$root/native-server/src/main.cpp"
grep -Fq 'plugmesh-service.sh' "$root/.github/workflows/release.yml"
grep -Fq 'install-plugmesh-service.ps1' "$root/.github/workflows/release.yml"
grep -Fq 'plugmesh-service.sh' "$root/scripts/build-linux-native.sh"
grep -Fq 'plugmesh-service.sh' "$root/scripts/build-termux-native.sh"

mkdir -p "$tmp/bin"
cat > "$tmp/bin/systemctl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$SYSTEMCTL_LOG"
EOF
cat > "$tmp/bin/launchctl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "$LAUNCHCTL_LOG"
EOF
cat > "$tmp/bin/sv" <<'EOF'
#!/bin/sh
printf 'SVDIR=%s %s\n' "$SVDIR" "$*" >> "$SV_LOG"
EOF
chmod +x "$tmp/bin/systemctl" "$tmp/bin/launchctl" "$tmp/bin/sv"

cat > "$tmp/fake-server" <<'EOF'
#!/bin/sh
printf '%s\n' "$PLUGMESH_TEST_VALUE" > "$PLUGMESH_TEST_CAPTURE"
EOF
chmod +x "$tmp/fake-server"
for invalid_name in . ..; do
  if invalid_output="$(TERMUX_VERSION=1 PREFIX="$tmp/termux-prefix" HOME="$tmp" bash "$service" status --name "$invalid_name" --executable "$tmp/fake-server" 2>&1)"; then
    echo "unsafe service name unexpectedly accepted: $invalid_name" >&2
    exit 1
  fi
  [[ "$invalid_output" == *'invalid service name'* ]] || { echo "$invalid_output" >&2; exit 1; }
done
printf 'PLUGMESH_TEST_VALUE="value with spaces=and equals"\nPLUGMESH_TEST_CAPTURE=%s\nPLUGMESH_TEST_XML="value & <xml>"\n' "$tmp/captured-value" > "$tmp/service config.env"

linux_home="$tmp/linux-home"
mkdir -p "$linux_home"
SYSTEMCTL_LOG="$tmp/systemctl.log" HOME="$linux_home" PATH="$tmp/bin:$PATH" bash "$service" install --name linux-test --executable "$tmp/fake-server" --env-file "$tmp/service config.env"
unit="$linux_home/.config/systemd/user/linux-test.service"
grep -Fq "ExecStart=\"$tmp/fake-server\"" "$unit"
grep -Fq "EnvironmentFile=-${tmp}/service\\x20config.env" "$unit"
grep -Fq "WorkingDirectory=$tmp" "$unit"
! grep -Fq 'WorkingDirectory="' "$unit"
grep -Fq 'enable --now linux-test.service' "$tmp/systemctl.log"
for action in start stop status; do
  SYSTEMCTL_LOG="$tmp/systemctl.log" HOME="$linux_home" PATH="$tmp/bin:$PATH" bash "$service" "$action" --name linux-test --executable "$tmp/fake-server"
done
grep -Fq 'start linux-test.service' "$tmp/systemctl.log"
grep -Fq 'stop linux-test.service' "$tmp/systemctl.log"
grep -Fq 'status linux-test.service' "$tmp/systemctl.log"
SYSTEMCTL_LOG="$tmp/systemctl.log" HOME="$linux_home" PATH="$tmp/bin:$PATH" bash "$service" uninstall --name linux-test --executable "$tmp/fake-server"
[[ ! -e "$unit" ]]

mac_home="$tmp/mac home"
mkdir -p "$mac_home"
LAUNCHCTL_LOG="$tmp/launchctl.log" HOME="$mac_home" PATH="$tmp/bin:$PATH" env -u TERMUX_VERSION -u PREFIX OSTYPE=darwin-test bash "$service" install --name mac-test --executable "$tmp/fake-server" --env-file "$tmp/service config.env"
plist="$mac_home/Library/LaunchAgents/com.shelter-red.mac-test.plist"
python3 - "$plist" "$tmp" <<'PY'
import plistlib, sys
with open(sys.argv[1], "rb") as source:
    plist = plistlib.load(source)
assert plist["EnvironmentVariables"]["PLUGMESH_TEST_VALUE"] == "value with spaces=and equals"
assert plist["EnvironmentVariables"]["PLUGMESH_TEST_CAPTURE"] == sys.argv[2] + "/captured-value"
assert plist["EnvironmentVariables"]["PLUGMESH_TEST_XML"] == "value & <xml>"
assert "PLUGMESH_SERVICE_ENV_FILE" not in plist.get("EnvironmentVariables", {})
assert plist["KeepAlive"] is True and plist["RunAtLoad"] is True
PY
LAUNCHCTL_LOG="$tmp/launchctl.log" HOME="$mac_home" PATH="$tmp/bin:$PATH" env -u TERMUX_VERSION -u PREFIX OSTYPE=darwin-test bash "$service" start --name mac-test --executable "$tmp/fake-server"
grep -Fq 'kickstart -k' "$tmp/launchctl.log"
LAUNCHCTL_LOG="$tmp/launchctl.log" HOME="$mac_home" PATH="$tmp/bin:$PATH" env -u TERMUX_VERSION -u PREFIX OSTYPE=darwin-test bash "$service" uninstall --name mac-test --executable "$tmp/fake-server"
[[ ! -e "$plist" ]]

runit_home="$tmp/termux-runit-home"
runit_prefix="$tmp/termux-runit-prefix"
mkdir -p "$runit_home" "$runit_prefix/bin" "$runit_prefix/var/service"
ln -s /bin/sh "$runit_prefix/bin/sh"
SV_LOG="$tmp/sv.log" TERMUX_VERSION=1 PREFIX="$runit_prefix" HOME="$runit_home" PATH="$tmp/bin:$PATH" bash "$service" install --name runit-test --executable "$tmp/fake-server" --env-file "$tmp/service config.env"
runit="$runit_prefix/var/service/runit-test"
"$runit_prefix/bin/sh" -n "$runit/run"
"$runit_prefix/bin/sh" "$runit/run"
[[ "$(<"$tmp/captured-value")" == 'value with spaces=and equals' ]]
for action in start stop status; do
  SV_LOG="$tmp/sv.log" TERMUX_VERSION=1 PREFIX="$runit_prefix" HOME="$runit_home" PATH="$tmp/bin:$PATH" bash "$service" "$action" --name runit-test --executable "$tmp/fake-server"
done
SV_LOG="$tmp/sv.log" TERMUX_VERSION=1 PREFIX="$runit_prefix" HOME="$runit_home" PATH="$tmp/bin:$PATH" bash "$service" uninstall --name runit-test --executable "$tmp/fake-server"
grep -Fq 'up runit-test' "$tmp/sv.log"
grep -Fq 'down runit-test' "$tmp/sv.log"
grep -Fq 'status runit-test' "$tmp/sv.log"
[[ ! -e "$runit" ]]

fallback_home="$tmp/termux-boot-home"
fallback_prefix="$tmp/termux-boot-prefix"
mkdir -p "$fallback_home" "$fallback_prefix/bin"
ln -s /bin/sh "$fallback_prefix/bin/sh"
cat > "$tmp/termux-server" <<'EOF'
#!/bin/sh
printf '%s\n' "$PLUGMESH_TEST_VALUE" > "$PLUGMESH_TEST_CAPTURE"
while :; do sleep 1; done
EOF
chmod +x "$tmp/termux-server"
SV_LOG="$tmp/sv.log" TERMUX_VERSION=1 PREFIX="$fallback_prefix" HOME="$fallback_home" PATH="$tmp/bin:$PATH" bash "$service" install --name boot-test --executable "$tmp/termux-server" --env-file "$tmp/service config.env"
boot="$fallback_home/.termux/boot/boot-test"
"$fallback_prefix/bin/sh" -n "$boot"
[[ "$(<"$tmp/captured-value")" == 'value with spaces=and equals' ]]
SV_LOG="$tmp/sv.log" TERMUX_VERSION=1 PREFIX="$fallback_prefix" HOME="$fallback_home" PATH="$tmp/bin:$PATH" bash "$service" status --name boot-test --executable "$tmp/termux-server"
SV_LOG="$tmp/sv.log" TERMUX_VERSION=1 PREFIX="$fallback_prefix" HOME="$fallback_home" PATH="$tmp/bin:$PATH" bash "$service" stop --name boot-test --executable "$tmp/termux-server"
if TERMUX_VERSION=1 PREFIX="$fallback_prefix" HOME="$fallback_home" PATH="$tmp/bin:$PATH" bash "$service" status --name boot-test --executable "$tmp/termux-server"; then
  echo 'stopped Termux:Boot fallback still reports running' >&2
  exit 1
fi
TERMUX_VERSION=1 PREFIX="$fallback_prefix" HOME="$fallback_home" PATH="$tmp/bin:$PATH" bash "$service" uninstall --name boot-test --executable "$tmp/termux-server"
[[ ! -e "$boot" ]]

echo 'native service installation contract passed'
