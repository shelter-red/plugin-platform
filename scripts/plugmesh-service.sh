#!/usr/bin/env bash
set -euo pipefail

name="plugmesh-server"
executable=""
env_file=""
command_name="install"

usage() {
  cat <<'EOF'
Usage: plugmesh-service.sh <install|uninstall|start|stop|status> [options]

Options:
  --name NAME          Service name (default: plugmesh-server)
  --executable PATH    Absolute path to plugmesh-server
  --env-file PATH      Optional KEY=VALUE environment file
EOF
}

while (($#)); do
  case "$1" in
    install|uninstall|start|stop|status) command_name="$1" ;;
    --name) shift; name="${1:?missing service name}" ;;
    --executable) shift; executable="${1:?missing executable path}" ;;
    --env-file) shift; env_file="${1:?missing environment file}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ -z "$executable" ]]; then
  executable="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/native-server/build/plugmesh-server"
fi
executable="$(readlink -f "$executable")"
unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_file="$unit_dir/$name.service"
plist="$HOME/Library/LaunchAgents/com.shelter-red.$name.plist"
termux_service_dir="${PREFIX:-$HOME/.termux}/var/service/$name"
boot_file="$HOME/.termux/boot/$name"

quote_systemd() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

install_linux() {
  mkdir -p "$unit_dir"
  {
    echo '[Unit]'
    echo 'Description=Plugmesh native plugin server'
    echo 'After=network-online.target'
    echo 'Wants=network-online.target'
    echo
    echo '[Service]'
    echo 'Type=simple'
    printf 'ExecStart="%s"\n' "$(quote_systemd "$executable")"
    printf 'WorkingDirectory="%s"\n' "$(quote_systemd "$(dirname "$executable")")"
    echo 'Restart=on-failure'
    echo 'RestartSec=3s'
    [[ -n "$env_file" ]] && printf 'EnvironmentFile=-%s\n' "$(quote_systemd "$env_file")"
    echo
    echo '[Install]'
    echo 'WantedBy=default.target'
  } > "$unit_file"
  systemctl --user daemon-reload
  systemctl --user enable --now "$name.service"
}

install_macos() {
  mkdir -p "$(dirname "$plist")"
  python3 - "$plist" "$executable" "$name" "$env_file" <<'PY'
import plistlib, sys
path, executable, name, env_file = sys.argv[1:]
data = {
    'Label': f'com.shelter-red.{name}',
    'ProgramArguments': [executable],
    'WorkingDirectory': executable.rsplit('/', 1)[0],
    'RunAtLoad': True,
    'KeepAlive': True,
    'ThrottleInterval': 3,
    'ProcessType': 'Background',
}
if env_file:
    data['EnvironmentVariables'] = {'PLUGMESH_SERVICE_ENV_FILE': env_file}
with open(path, 'wb') as f:
    plistlib.dump(data, f)
PY
  launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  launchctl enable "gui/$(id -u)/com.shelter-red.$name"
}

install_termux() {
  if [[ -d "${PREFIX:-}/var/service" && -x "$(command -v sv || true)" ]]; then
    mkdir -p "$termux_service_dir/log"
    cat > "$termux_service_dir/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
exec 2>&1
cd "$(dirname "$executable")"
exec "$executable"
EOF
    cat > "$termux_service_dir/log/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
mkdir -p "${PREFIX:-$HOME/.termux}/var/log/$name"
exec svlogd "${PREFIX:-$HOME/.termux}/var/log/$name"
EOF
    chmod +x "$termux_service_dir/run" "$termux_service_dir/log/run"
    sv up "$name"
  else
    mkdir -p "$(dirname "$boot_file")"
    cat > "$boot_file" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
cd "$(dirname "$executable")"
exec "$executable"
EOF
    chmod +x "$boot_file"
    echo "installed Termux:Boot launcher: $boot_file"
  fi
}

uninstall() {
  if [[ "$OSTYPE" == linux-android* || -n "${TERMUX_VERSION:-}" ]]; then
    if [[ -x "$(command -v sv || true)" ]]; then sv down "$name" 2>/dev/null || true; fi
    rm -rf "$termux_service_dir"
    rm -f "$boot_file"
  elif [[ "$OSTYPE" == darwin* ]]; then
    launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
    rm -f "$plist"
  else
    systemctl --user disable --now "$name.service" 2>/dev/null || true
    rm -f "$unit_file"
    systemctl --user daemon-reload 2>/dev/null || true
  fi
}

if [[ "$command_name" == uninstall ]]; then uninstall; exit 0; fi
if [[ "$OSTYPE" == linux-android* || -n "${TERMUX_VERSION:-}" ]]; then
  case "$command_name" in install) install_termux ;; start|stop|status) sv "$command_name" "$name" ;; esac
elif [[ "$OSTYPE" == darwin* ]]; then
  case "$command_name" in install) install_macos ;; start) launchctl kickstart -k "gui/$(id -u)/com.shelter-red.$name" ;; stop) launchctl kill TERM "gui/$(id -u)/com.shelter-red.$name" ;; status) launchctl print "gui/$(id -u)/com.shelter-red.$name" ;; esac
else
  case "$command_name" in install) install_linux ;; start|stop|status) systemctl --user "$command_name" "$name.service" ;; esac
fi
