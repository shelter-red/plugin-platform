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
  --executable PATH    Path to plugmesh-server (defaults to the sibling package binary)
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

[[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid service name: $name" >&2; exit 2; }
[[ "$name" != "." && "$name" != ".." ]] || { echo "invalid service name: $name" >&2; exit 2; }

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
absolute_path() {
  local path="$1" parent
  [[ "$path" == /* ]] || path="$PWD/$path"
  parent="$(cd "$(dirname "$path")" && pwd -P)" || return 1
  printf '%s/%s\n' "$parent" "$(basename "$path")"
}

if [[ -z "$executable" ]]; then
  if [[ -x "$script_dir/plugmesh-server" ]]; then
    executable="$script_dir/plugmesh-server"
  else
    executable="$(cd "$script_dir/.." && pwd -P)/native-server/build/plugmesh-server"
  fi
fi
executable="$(absolute_path "$executable")"
[[ -x "$executable" ]] || { echo "server executable is not executable: $executable" >&2; exit 1; }
if [[ -n "$env_file" ]]; then
  [[ -f "$env_file" && -r "$env_file" ]] || { echo "environment file is not readable: $env_file" >&2; exit 1; }
  env_file="$(absolute_path "$env_file")"
fi

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unit_file="$unit_dir/$name.service"
plist="$HOME/Library/LaunchAgents/com.shelter-red.$name.plist"
termux_prefix="${PREFIX:-/data/data/com.termux/files/usr}"
termux_shell="$termux_prefix/bin/sh"
termux_service_dir="$termux_prefix/var/service/$name"
boot_file="$HOME/.termux/boot/$name"
termux_pid_file="$HOME/.termux/run/$name.pid"
termux_log_file="$HOME/.termux/logs/$name.log"

quote_systemd() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/%/%%/g'; }
systemd_path() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value// /\\x20}"
  value="${value//\"/\\x22}"
  value="${value//%/%%}"
  printf '%s' "$value"
}
quote_sh() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}
is_termux() { [[ "$OSTYPE" == linux-android* || -n "${TERMUX_VERSION:-}" ]]; }
has_sv() { command -v sv >/dev/null 2>&1; }
termux_runit_installed() { [[ -d "$termux_service_dir" ]] && has_sv; }
sv_termux() { SVDIR="$termux_prefix/var/service" sv "$@"; }

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
    printf 'WorkingDirectory=%s\n' "$(systemd_path "$(dirname "$executable")")"
    echo 'Restart=on-failure'
    echo 'RestartSec=3s'
    [[ -z "$env_file" ]] || printf 'EnvironmentFile=-%s\n' "$(systemd_path "$env_file")"
    echo
    echo '[Install]'
    echo 'WantedBy=default.target'
  } > "$unit_file"
  systemctl --user daemon-reload
  systemctl --user enable --now "$name.service"
}

xml_escape() {
  local value="${1//&/\&amp;}"
  value="${value//</\&lt;}"
  value="${value//>/\&gt;}"
  value="${value//\"/\&quot;}"
  value="${value//\'/\&apos;}"
  printf '%s' "$value"
}

install_macos() {
  local environment_xml label escaped_executable working_directory line key value
  mkdir -p "$(dirname "$plist")"
  environment_xml="$(mktemp)"
  if [[ -n "$env_file" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"
      [[ -z "$line" || "$line" == \#* ]] && continue
      [[ "$line" == *=* ]] || { rm -f "$environment_xml"; echo 'invalid environment line: expected KEY=VALUE' >&2; return 1; }
      key="${line%%=*}"
      value="${line#*=}"
      key="${key#"${key%%[![:space:]]*}"}"
      key="${key%"${key##*[![:space:]]}"}"
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"
      [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { rm -f "$environment_xml"; echo "invalid environment key: $key" >&2; return 1; }
      if [[ ${#value} -ge 2 && "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      elif [[ ${#value} -ge 2 && "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi
      printf '      <key>%s</key><string>%s</string>\n' "$(xml_escape "$key")" "$(xml_escape "$value")" >> "$environment_xml"
    done < "$env_file"
  fi
  label="$(xml_escape "com.shelter-red.$name")"
  escaped_executable="$(xml_escape "$executable")"
  working_directory="$(xml_escape "$(dirname "$executable")")"
  {
    cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$escaped_executable</string></array>
  <key>WorkingDirectory</key><string>$working_directory</string>
EOF
    if [[ -s "$environment_xml" ]]; then
      printf '  <key>EnvironmentVariables</key><dict>\n'
      cat "$environment_xml"
      printf '  </dict>\n'
    fi
    cat <<'EOF'
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>3</integer>
  <key>ProcessType</key><string>Background</string>
</dict></plist>
EOF
  } > "$plist"
  rm -f "$environment_xml"
  chmod 0600 "$plist"
  launchctl bootout "gui/$(id -u)" "$plist" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  launchctl enable "gui/$(id -u)/com.shelter-red.$name"
}

write_termux_launcher() {
  local target="$1"
  {
    printf '#!%s\n' "$termux_shell"
    echo 'set -eu'
    if [[ -n "$env_file" ]]; then
      printf 'env_file=%s\n' "$(quote_sh "$env_file")"
      cat <<'EOF'
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  case "$line" in *=*) ;; *) echo "invalid environment line (expected KEY=VALUE)" >&2; exit 2 ;; esac
  key=${line%%=*}
  value=${line#*=}
  case "$key" in [!A-Za-z_]*|*[!A-Za-z0-9_]*) echo "invalid environment key: $key" >&2; exit 2 ;; esac
  case "$value" in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  export "$key=$value"
done < "$env_file"
EOF
    fi
    printf 'cd %s\n' "$(quote_sh "$(dirname "$executable")")"
    printf 'exec %s\n' "$(quote_sh "$executable")"
  } > "$target"
  chmod 0755 "$target"
}

termux_fallback_running() {
  local pid cmdline
  [[ -r "$termux_pid_file" ]] || return 1
  read -r pid < "$termux_pid_file" || return 1
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$cmdline" == *"$executable"* || "$cmdline" == *"$boot_file"* ]]
}

start_termux_fallback() {
  [[ -x "$boot_file" ]] || { echo "Termux:Boot launcher is not installed: $boot_file" >&2; return 1; }
  if termux_fallback_running; then
    echo "service $name is already running ($(cat "$termux_pid_file"))"
    return 0
  fi
  mkdir -p "$(dirname "$termux_pid_file")" "$(dirname "$termux_log_file")"
  rm -f "$termux_pid_file"
  nohup "$termux_shell" "$boot_file" >> "$termux_log_file" 2>&1 </dev/null &
  printf '%s\n' "$!" > "$termux_pid_file"
  sleep 1
  if ! termux_fallback_running; then
    rm -f "$termux_pid_file"
    echo "service $name failed to start; see $termux_log_file" >&2
    return 1
  fi
  echo "service $name started ($(cat "$termux_pid_file"))"
}

stop_termux_fallback() {
  if ! termux_fallback_running; then
    rm -f "$termux_pid_file"
    echo "service $name is not running"
    return 0
  fi
  local pid
  read -r pid < "$termux_pid_file"
  kill -TERM "$pid" 2>/dev/null || true
  for _ in {1..10}; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null || true; fi
  rm -f "$termux_pid_file"
  echo "service $name stopped"
}

status_termux_fallback() {
  if termux_fallback_running; then
    echo "service $name is running ($(cat "$termux_pid_file"))"
  else
    echo "service $name is not running" >&2
    return 1
  fi
}

install_termux() {
  if [[ -d "$termux_prefix/var/service" ]] && has_sv; then
    mkdir -p "$termux_service_dir/log"
    write_termux_launcher "$termux_service_dir/run"
    cat > "$termux_service_dir/log/run" <<EOF
#!$termux_shell
mkdir -p "${termux_prefix}/var/log/$name"
exec svlogd "${termux_prefix}/var/log/$name"
EOF
    chmod 0755 "$termux_service_dir/log/run"
    sv_termux up "$name"
  else
    mkdir -p "$(dirname "$boot_file")"
    write_termux_launcher "$boot_file"
    start_termux_fallback
    echo "installed Termux:Boot launcher: $boot_file"
  fi
}

start_termux() {
  if termux_runit_installed; then sv_termux up "$name"; else start_termux_fallback; fi
}
stop_termux() {
  if termux_runit_installed; then sv_termux down "$name"; else stop_termux_fallback; fi
}
status_termux() {
  if termux_runit_installed; then sv_termux status "$name"; else status_termux_fallback; fi
}

uninstall() {
  if is_termux; then
    if termux_runit_installed; then sv_termux down "$name" 2>/dev/null || true; else stop_termux_fallback || true; fi
    rm -rf "$termux_service_dir"
    rm -f "$boot_file" "$termux_pid_file"
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
if is_termux; then
  case "$command_name" in
    install) install_termux ;;
    start) start_termux ;;
    stop) stop_termux ;;
    status) status_termux ;;
  esac
elif [[ "$OSTYPE" == darwin* ]]; then
  case "$command_name" in
    install) install_macos ;;
    start) launchctl kickstart -k "gui/$(id -u)/com.shelter-red.$name" ;;
    stop) launchctl kill TERM "gui/$(id -u)/com.shelter-red.$name" ;;
    status) launchctl print "gui/$(id -u)/com.shelter-red.$name" ;;
  esac
else
  case "$command_name" in
    install) install_linux ;;
    start|stop|status) systemctl --user "$command_name" "$name.service" ;;
  esac
fi
