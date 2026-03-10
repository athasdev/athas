#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

RUNTIME_DIR="${ATHAS_UI_TEST_DIR:-/tmp/athas-ui-test-${USER}}"
DISPLAY_NAME="${ATHAS_UI_DISPLAY:-:99}"
DISPLAY_NUMBER="${DISPLAY_NAME#:}"
SCREEN_GEOMETRY="${ATHAS_UI_SCREEN:-1600x1000x24}"
APP_CMD="${ATHAS_UI_APP_CMD:-bun dev:app}"

SESSION_PID_FILE="${RUNTIME_DIR}/session.pid"
OPENBOX_PID_FILE="${RUNTIME_DIR}/openbox.pid"
APP_LOG_FILE="${RUNTIME_DIR}/app.log"
OPENBOX_LOG_FILE="${RUNTIME_DIR}/openbox.log"
XAUTH_FILE="${RUNTIME_DIR}/Xauthority"
REQUIRED_TAURI_LIBS=(
  "javascriptcoregtk-4.1"
  "libsoup-3.0"
  "gdk-pixbuf-2.0"
  "gtk+-3.0"
  "webkit2gtk-4.1"
)

usage() {
  cat <<EOF
Usage: $(basename "$0") <command> [args]

Commands:
  start                 Start Athas inside a virtual desktop session
  check                 Verify Linux desktop and Tauri runtime dependencies
  stop                  Stop the virtual desktop session
  restart               Restart the virtual desktop session
  status                Show session status and visible windows
  screenshot [path]     Capture a screenshot from the virtual desktop
  logs                  Print the log file locations

Environment overrides:
  ATHAS_UI_TEST_DIR     Runtime dir for pid files, screenshots, and logs
  ATHAS_UI_DISPLAY      X display to use (default: :99)
  ATHAS_UI_SCREEN       Xvfb screen geometry (default: 1600x1000x24)
  ATHAS_UI_APP_CMD      Command used to launch Athas (default: bun dev:app)
EOF
}

ensure_runtime_dir() {
  mkdir -p "${RUNTIME_DIR}"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

detect_linux_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "apt-get"
  elif command -v dnf >/dev/null 2>&1; then
    echo "dnf"
  elif command -v pacman >/dev/null 2>&1; then
    echo "pacman"
  elif command -v zypper >/dev/null 2>&1; then
    echo "zypper"
  else
    echo "unknown"
  fi
}

pid_from_file() {
  local pid_file="$1"
  if [[ -f "${pid_file}" ]]; then
    tr -d '\n' <"${pid_file}"
  fi
}

is_pid_running() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

is_session_running() {
  local session_pid
  session_pid="$(pid_from_file "${SESSION_PID_FILE}")"
  is_pid_running "${session_pid}"
}

cleanup_stale_state() {
  if ! is_session_running; then
    rm -f "${SESSION_PID_FILE}" "${OPENBOX_PID_FILE}"
  fi
}

print_status_line() {
  local name="$1"
  local pid="$2"

  if is_pid_running "${pid}"; then
    echo "${name}: running (pid ${pid})"
  else
    echo "${name}: stopped"
  fi
}

with_display_env() {
  DISPLAY="${DISPLAY_NAME}" XAUTHORITY="${XAUTH_FILE}" "$@"
}

print_linux_dependency_hint() {
  local package_manager
  package_manager="$(detect_linux_package_manager)"

  echo "Install the Linux build dependencies first." >&2
  echo "Recommended: bash scripts/linux/setup.sh" >&2

  case "${package_manager}" in
    apt-get)
      echo "Or run: sudo apt-get install -y build-essential curl wget file libssl-dev libgtk-3-dev libwebkit2gtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev pkg-config" >&2
      ;;
    dnf)
      echo "Or run: sudo dnf install -y gcc gcc-c++ make curl wget file openssl-devel gtk3-devel webkit2gtk4.1-devel libsoup3-devel libayatana-appindicator-gtk3-devel librsvg2-devel pkgconf-pkg-config" >&2
      ;;
    pacman)
      echo "Or run: sudo pacman -S --needed --noconfirm base-devel curl wget file openssl gtk3 webkit2gtk-4.1 libsoup3 libayatana-appindicator librsvg pkgconf" >&2
      ;;
    zypper)
      echo "Or run: sudo zypper install -y gcc gcc-c++ make curl wget file libopenssl-devel gtk3-devel webkit2gtk3-devel libsoup3-devel libayatana-appindicator3-devel librsvg-devel pkg-config" >&2
      ;;
  esac
}

check_runtime_dependencies() {
  local missing_tools=()
  local missing_tauri_libs=()
  local tool
  local tauri_lib

  for tool in xvfb-run openbox xset wmctrl bun pkg-config; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
      missing_tools+=("${tool}")
    fi
  done

  for tauri_lib in "${REQUIRED_TAURI_LIBS[@]}"; do
    if ! pkg-config --exists "${tauri_lib}" 2>/dev/null; then
      missing_tauri_libs+=("${tauri_lib}")
    fi
  done

  if ((${#missing_tools[@]} == 0)) && ((${#missing_tauri_libs[@]} == 0)); then
    echo "Athas UI test dependencies are ready"
    echo "Display tools: ok"
    echo "Tauri system libraries: ok"
    return 0
  fi

  if ((${#missing_tools[@]} > 0)); then
    echo "Missing desktop automation tools: ${missing_tools[*]}" >&2
  fi

  if ((${#missing_tauri_libs[@]} > 0)); then
    echo "Missing Tauri system libraries: ${missing_tauri_libs[*]}" >&2
    print_linux_dependency_hint
  fi

  return 1
}

wait_for_display() {
  for _ in $(seq 1 100); do
    if with_display_env xset q >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done

  echo "Timed out waiting for virtual display ${DISPLAY_NAME}" >&2
  if [[ -f "${APP_LOG_FILE}" ]]; then
    echo "--- app log ---" >&2
    tail -n 60 "${APP_LOG_FILE}" >&2 || true
  fi
  exit 1
}

start_session() {
  check_runtime_dependencies

  ensure_runtime_dir
  cleanup_stale_state

  if is_session_running; then
    echo "Athas UI test session is already running"
    echo "Display: ${DISPLAY_NAME}"
    echo "XAUTHORITY: ${XAUTH_FILE}"
    return 0
  fi

  rm -f "${XAUTH_FILE}" "${OPENBOX_PID_FILE}"

  setsid bash -lc "
    exec xvfb-run \
      --server-num='${DISPLAY_NUMBER}' \
      --auth-file='${XAUTH_FILE}' \
      --server-args='-screen 0 ${SCREEN_GEOMETRY} -nolisten tcp -ac -noreset' \
      bash -lc '
        export DISPLAY=${DISPLAY_NAME}
        export XAUTHORITY=${XAUTH_FILE}
        openbox --sm-disable >${OPENBOX_LOG_FILE} 2>&1 &
        echo \$! >${OPENBOX_PID_FILE}
        cd ${REPO_ROOT}
        ${APP_CMD}
      '
  " >"${APP_LOG_FILE}" 2>&1 &

  local session_pid=$!
  echo "${session_pid}" >"${SESSION_PID_FILE}"

  wait_for_display
  if ! is_session_running; then
    echo "Athas UI session exited immediately after launch" >&2
    tail -n 60 "${APP_LOG_FILE}" >&2 || true
    exit 1
  fi

  echo "Athas UI test session started"
  echo "Display: ${DISPLAY_NAME}"
  echo "XAUTHORITY: ${XAUTH_FILE}"
  echo "Runtime dir: ${RUNTIME_DIR}"
  echo "App log: ${APP_LOG_FILE}"
}

stop_session() {
  cleanup_stale_state

  if ! is_session_running; then
    rm -f "${SESSION_PID_FILE}" "${OPENBOX_PID_FILE}"
    return 0
  fi

  local session_pid
  session_pid="$(pid_from_file "${SESSION_PID_FILE}")"

  kill -- "-${session_pid}" 2>/dev/null || kill "${session_pid}" 2>/dev/null || true

  for _ in $(seq 1 50); do
    if ! is_pid_running "${session_pid}"; then
      rm -f "${SESSION_PID_FILE}" "${OPENBOX_PID_FILE}"
      return 0
    fi
    sleep 0.1
  done

  kill -9 -- "-${session_pid}" 2>/dev/null || kill -9 "${session_pid}" 2>/dev/null || true
  rm -f "${SESSION_PID_FILE}" "${OPENBOX_PID_FILE}"
}

show_status() {
  ensure_runtime_dir
  cleanup_stale_state

  echo "Display: ${DISPLAY_NAME}"
  echo "XAUTHORITY: ${XAUTH_FILE}"
  echo "Runtime dir: ${RUNTIME_DIR}"

  if is_session_running; then
    print_status_line "Session" "$(pid_from_file "${SESSION_PID_FILE}")"
  else
    echo "Session: stopped"
  fi

  local openbox_pid
  openbox_pid="$(pid_from_file "${OPENBOX_PID_FILE}")"
  print_status_line "openbox" "${openbox_pid}"

  if is_session_running && with_display_env wmctrl -lp >/tmp/athas-ui-test-windows.$$ 2>/dev/null; then
    if [[ -s /tmp/athas-ui-test-windows.$$ ]]; then
      echo ""
      echo "Visible windows:"
      cat /tmp/athas-ui-test-windows.$$
    fi
    rm -f /tmp/athas-ui-test-windows.$$
  fi
}

capture_screenshot() {
  require_command scrot
  ensure_runtime_dir

  if ! is_session_running; then
    echo "Athas UI session is not running" >&2
    exit 1
  fi

  local output_path="${1:-${RUNTIME_DIR}/screenshot-$(date +%Y%m%d-%H%M%S).png}"
  mkdir -p "$(dirname "${output_path}")"
  with_display_env scrot "${output_path}"
  echo "${output_path}"
}

show_logs() {
  ensure_runtime_dir
  echo "App log: ${APP_LOG_FILE}"
  echo "openbox log: ${OPENBOX_LOG_FILE}"
}

main() {
  local command="${1:-}"
  case "${command}" in
    start)
      start_session
      ;;
    stop)
      stop_session
      ;;
    restart)
      stop_session
      start_session
      ;;
    status)
      show_status
      ;;
    check)
      check_runtime_dependencies
      ;;
    screenshot)
      shift || true
      capture_screenshot "${1:-}"
      ;;
    logs)
      show_logs
      ;;
    ""|-h|--help|help)
      usage
      ;;
    *)
      echo "Unknown command: ${command}" >&2
      usage >&2
      exit 1
      ;;
  esac
}

main "$@"
