#!/bin/bash
#
# thinklocal-mcp service.sh — macOS launchd Service Management
#
# Verwendet `launchctl bootstrap`/`bootout` (modern) statt des veralteten
# `load`/`unload`. Logs landen in ~/Library/Logs/thinklocal-mcp/, nicht in
# ~/.thinklocal/logs/, weil das die macOS-Konvention ist und mit Console.app
# kompatibel.
#
# Subcommands:
#   install    plist nach ~/Library/LaunchAgents/ kopieren und bootstrappen
#   uninstall  bootout + plist entfernen
#   start      bootstrap (falls nicht aktiv)
#   stop       bootout
#   restart    stop + start
#   status     ps + launchctl print + Health-Check
#   logs       tail -F daemon.log
#   errors     tail -F daemon.error.log
#
# Override via ENV:
#   TLMCP_INSTALL_DIR  (default: parent of this script's parent)

set -u

LABEL="com.thinklocal.daemon"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_INSTALL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INSTALL_DIR="${TLMCP_INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"

LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_TEMPLATE="$SCRIPT_DIR/com.thinklocal.daemon.plist"
PLIST_TARGET="$LAUNCH_AGENTS_DIR/$LABEL.plist"

LOG_DIR="$HOME/Library/Logs/thinklocal-mcp"
LOG_OUT="$LOG_DIR/daemon.log"
LOG_ERR="$LOG_DIR/daemon.error.log"

# launchctl-Domain fuer den User. macOS 10.10+ Pflicht fuer bootstrap/bootout.
USER_DOMAIN="gui/$(id -u)"
SERVICE_TARGET="$USER_DOMAIN/$LABEL"

die() { echo "Fehler: $*" >&2; exit 1; }
log() { echo "[service.sh] $*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 nicht gefunden"
}

resolve_node() {
  command -v node 2>/dev/null && return 0
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -x "$candidate" ] && { echo "$candidate"; return 0; }
  done
  die "node nicht gefunden — ist Node.js installiert?"
}

render_plist() {
  local node_path="$1"
  mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

  # Sed mit | als Delimiter, weil INSTALL_DIR Slashes enthaelt.
  # Logs umgelenkt nach ~/Library/Logs/thinklocal-mcp/ (macOS-Konvention).
  sed \
    -e "s|__NODE_PATH__|${node_path}|g" \
    -e "s|__INSTALL_DIR__|${INSTALL_DIR}|g" \
    -e "s|__HOME__/.thinklocal/logs/daemon.log|${LOG_OUT}|g" \
    -e "s|__HOME__/.thinklocal/logs/daemon.error.log|${LOG_ERR}|g" \
    -e "s|__HOME__|${HOME}|g" \
    "$PLIST_TEMPLATE" > "$PLIST_TARGET"

  log "plist nach $PLIST_TARGET geschrieben"
}

cmd_install() {
  [ -f "$PLIST_TEMPLATE" ] || die "Template nicht gefunden: $PLIST_TEMPLATE"
  local node_path
  node_path="$(resolve_node)"
  log "Node: $node_path"
  log "Install-Dir: $INSTALL_DIR"

  render_plist "$node_path"

  # Falls schon geladen — erst raus, dann rein.
  if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    log "Bestehender Service gefunden — bootout..."
    launchctl bootout "$SERVICE_TARGET" 2>/dev/null || true
  fi

  log "bootstrap $SERVICE_TARGET..."
  launchctl bootstrap "$USER_DOMAIN" "$PLIST_TARGET" || die "bootstrap fehlgeschlagen"
  launchctl enable "$SERVICE_TARGET" 2>/dev/null || true

  log "Service installiert. Status:"
  cmd_status
}

cmd_uninstall() {
  if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    log "bootout $SERVICE_TARGET..."
    launchctl bootout "$SERVICE_TARGET" || log "bootout meldete Fehler — fahre trotzdem fort"
  else
    log "Service nicht aktiv"
  fi

  if [ -f "$PLIST_TARGET" ]; then
    rm -f "$PLIST_TARGET"
    log "plist entfernt: $PLIST_TARGET"
  fi
  log "Logs in $LOG_DIR bleiben erhalten"
}

cmd_start() {
  [ -f "$PLIST_TARGET" ] || die "Service nicht installiert. Erst: $0 install"
  if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    log "Service laeuft bereits"
    return 0
  fi
  launchctl bootstrap "$USER_DOMAIN" "$PLIST_TARGET" || die "bootstrap fehlgeschlagen"
  log "Service gestartet"
}

cmd_stop() {
  if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    launchctl bootout "$SERVICE_TARGET" || log "bootout meldete Fehler"
    log "Service gestoppt"
  else
    log "Service laeuft nicht"
  fi
}

cmd_restart() {
  cmd_stop
  cmd_start
}

cmd_status() {
  if launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
    log "Service: AKTIV ($SERVICE_TARGET)"
    launchctl print "$SERVICE_TARGET" 2>/dev/null \
      | grep -E '^(\s+)?(state|pid|last exit|program)' | head -20
  else
    log "Service: NICHT AKTIV"
  fi

  echo
  log "Health-Check:"
  if [ -x "$INSTALL_DIR/scripts/health-check.sh" ]; then
    bash "$INSTALL_DIR/scripts/health-check.sh" || true
  else
    log "(scripts/health-check.sh nicht gefunden)"
  fi
}

cmd_logs() {
  [ -f "$LOG_OUT" ] || die "Log nicht gefunden: $LOG_OUT — Service nie gestartet?"
  log "tail -F $LOG_OUT (Strg-C zum Beenden)"
  tail -F "$LOG_OUT"
}

cmd_errors() {
  [ -f "$LOG_ERR" ] || die "Error-Log nicht gefunden: $LOG_ERR"
  log "tail -F $LOG_ERR (Strg-C zum Beenden)"
  tail -F "$LOG_ERR"
}

usage() {
  cat <<EOF
Usage: $0 <command>

Commands:
  install     plist installieren und Service starten
  uninstall   Service stoppen und plist entfernen
  start       Service starten
  stop        Service stoppen
  restart     Service neu starten
  status      Service-Status + Health-Check
  logs        daemon.log (stdout) folgen
  errors      daemon.error.log (stderr) folgen

Pfade:
  plist:    $PLIST_TARGET
  logs:     $LOG_DIR
  install:  $INSTALL_DIR
EOF
  exit 1
}

case "${1:-}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  logs)      cmd_logs ;;
  errors)    cmd_errors ;;
  *)         usage ;;
esac
