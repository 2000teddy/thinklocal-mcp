#!/usr/bin/env bash
set -euo pipefail

# thinklocal-mcp — Installer
#
# Installiert den Daemon, richtet den System-Service ein und
# konfiguriert optional den MCP-Server fuer Claude Code / Claude Desktop.
#
# Nutzung:
#   curl -fsSL https://raw.githubusercontent.com/2000teddy/thinklocal-mcp/main/scripts/install.sh | bash
#   # oder lokal:
#   ./scripts/install.sh

REPO_URL="https://github.com/2000teddy/thinklocal-mcp.git"
INSTALL_DIR="${TLMCP_INSTALL_DIR:-$HOME/thinklocal-mcp}"
DATA_DIR="$HOME/.thinklocal"
LOG_DIR="$DATA_DIR/logs"

# Farben
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# --- Plattform erkennen ---
detect_platform() {
    case "$(uname -s)" in
        Darwin) PLATFORM="macos" ;;
        Linux)  PLATFORM="linux" ;;
        MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
        *) error "Nicht unterstuetzte Plattform: $(uname -s)" ;;
    esac
    info "Plattform: $PLATFORM ($(uname -m))"
}

# --- Voraussetzungen pruefen ---
check_prerequisites() {
    info "Pruefe Voraussetzungen..."

    # Node.js
    if ! command -v node &>/dev/null; then
        error "Node.js nicht gefunden. Bitte installiere Node.js 20+: https://nodejs.org"
    fi
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        error "Node.js $NODE_VERSION gefunden, aber 18+ benoetigt."
    elif [ "$NODE_VERSION" -lt 20 ]; then
        warn "Node.js $(node -v) — Version 20+ empfohlen. v18 funktioniert eingeschraenkt."
    else
        ok "Node.js $(node -v)"
    fi

    # npm
    if ! command -v npm &>/dev/null; then
        error "npm nicht gefunden."
    fi
    ok "npm $(npm -v)"

    # Git
    if ! command -v git &>/dev/null; then
        error "git nicht gefunden."
    fi
    ok "git $(git --version | awk '{print $3}')"
}

# --- Repository klonen oder aktualisieren ---
install_repo() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        info "Aktualisiere bestehende Installation..."
        cd "$INSTALL_DIR"
        git pull origin main
    else
        info "Klone Repository..."
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    ok "Repository in $INSTALL_DIR"
}

# --- Dependencies installieren ---
install_deps() {
    # Ein einziger npm install im Root installiert alles
    # (postinstall-Script installiert daemon + dashboard automatisch)
    cd "$INSTALL_DIR"
    info "Installiere alle Dependencies (Root + Daemon + Dashboard)..."
    npm install
    ok "Alle Dependencies installiert"
}

# --- Datenverzeichnis erstellen ---
setup_data_dir() {
    mkdir -p "$DATA_DIR/logs" "$DATA_DIR/keys" "$DATA_DIR/tls" "$DATA_DIR/audit" "$DATA_DIR/vault" "$DATA_DIR/skills" "$DATA_DIR/pairing"
    chmod 700 "$DATA_DIR"
    ok "Datenverzeichnis: $DATA_DIR"
}

# --- macOS: launchd Service ---
install_macos_service() {
    info "Installiere macOS launchd Service..."
    local NODE_PATH
    NODE_PATH=$(which node)
    local PLIST_SRC="$INSTALL_DIR/scripts/service/com.thinklocal.daemon.plist"
    local PLIST_DST="$HOME/Library/LaunchAgents/com.thinklocal.daemon.plist"

    # Platzhalter ersetzen
    sed -e "s|__NODE_PATH__|$NODE_PATH|g" \
        -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
        -e "s|__HOME__|$HOME|g" \
        "$PLIST_SRC" > "$PLIST_DST"

    # Service laden
    launchctl unload "$PLIST_DST" 2>/dev/null || true
    launchctl load "$PLIST_DST"
    ok "launchd Service installiert und gestartet"
    info "Steuern mit:"
    echo "  launchctl start com.thinklocal.daemon    # Starten"
    echo "  launchctl stop com.thinklocal.daemon     # Stoppen"
    echo "  launchctl unload ~/Library/LaunchAgents/com.thinklocal.daemon.plist  # Deinstallieren"
}

# --- Linux: systemd Service ---
install_linux_service() {
    info "Installiere systemd Service..."
    local NODE_PATH
    NODE_PATH=$(which node)
    local SERVICE_SRC="$INSTALL_DIR/scripts/service/thinklocal-daemon.service"
    local SERVICE_DST="$HOME/.config/systemd/user/thinklocal-daemon.service"

    mkdir -p "$HOME/.config/systemd/user"

    # Platzhalter ersetzen
    sed -e "s|__NODE_PATH__|$NODE_PATH|g" \
        -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
        -e "s|__HOME__|$HOME|g" \
        -e "s|__USER__|$(whoami)|g" \
        "$SERVICE_SRC" > "$SERVICE_DST"

    # User-Service aktivieren
    systemctl --user daemon-reload
    systemctl --user enable thinklocal-daemon
    systemctl --user start thinklocal-daemon
    ok "systemd User-Service installiert und gestartet"
    info "Steuern mit:"
    echo "  systemctl --user start thinklocal-daemon    # Starten"
    echo "  systemctl --user stop thinklocal-daemon     # Stoppen"
    echo "  systemctl --user status thinklocal-daemon   # Status"
    echo "  journalctl --user -u thinklocal-daemon -f   # Logs"
}

# --- MCP-Server konfigurieren ---
setup_mcp() {
    info "Konfiguriere MCP-Server..."

    # Globale ~/.mcp.json fuer Claude Code
    local MCP_JSON="$HOME/.mcp.json"
    local TSX_PATH="$INSTALL_DIR/packages/daemon/node_modules/.bin/tsx"

    if [ -f "$MCP_JSON" ]; then
        warn "~/.mcp.json existiert bereits — ueberspringe (bitte manuell pruefen)"
    else
        cat > "$MCP_JSON" << MCPEOF
{
  "mcpServers": {
    "thinklocal": {
      "command": "$TSX_PATH",
      "args": ["$INSTALL_DIR/packages/daemon/src/mcp-stdio.ts"],
      "env": {
        "TLMCP_DAEMON_URL": "http://localhost:9440"
      }
    }
  }
}
MCPEOF
        ok "~/.mcp.json erstellt (Claude Code global)"
    fi

    # Claude Desktop Konfiguration
    local CLAUDE_DESKTOP_CONFIG=""
    case "$PLATFORM" in
        macos)  CLAUDE_DESKTOP_CONFIG="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
        linux)  CLAUDE_DESKTOP_CONFIG="$HOME/.config/Claude/claude_desktop_config.json" ;;
        windows) CLAUDE_DESKTOP_CONFIG="$APPDATA/Claude/claude_desktop_config.json" ;;
    esac

    if [ -n "$CLAUDE_DESKTOP_CONFIG" ]; then
        info "Claude Desktop Config: $CLAUDE_DESKTOP_CONFIG"
        if [ ! -f "$CLAUDE_DESKTOP_CONFIG" ]; then
            mkdir -p "$(dirname "$CLAUDE_DESKTOP_CONFIG")"
            cat > "$CLAUDE_DESKTOP_CONFIG" << CDEOF
{
  "mcpServers": {
    "thinklocal": {
      "command": "$TSX_PATH",
      "args": ["$INSTALL_DIR/packages/daemon/src/mcp-stdio.ts"],
      "env": {
        "TLMCP_DAEMON_URL": "http://localhost:9440"
      }
    }
  }
}
CDEOF
            ok "Claude Desktop konfiguriert"
        else
            warn "Claude Desktop Config existiert bereits — bitte manuell thinklocal hinzufuegen:"
            echo ""
            echo "  Datei: $CLAUDE_DESKTOP_CONFIG"
            echo "  Einfuegen unter \"mcpServers\":"
            echo "    \"thinklocal\": {"
            echo "      \"command\": \"$TSX_PATH\","
            echo "      \"args\": [\"$INSTALL_DIR/packages/daemon/src/mcp-stdio.ts\"]"
            echo "    }"
            echo ""
        fi
    fi
}

# --- Health-Check ---
verify_installation() {
    info "Pruefe Installation..."
    sleep 3

    if curl -sf http://localhost:9440/health > /dev/null 2>&1; then
        ok "Daemon laeuft! (http://localhost:9440/health)"
        local STATUS
        STATUS=$(curl -s http://localhost:9440/api/status)
        echo ""
        echo "  Agent:    $(echo "$STATUS" | grep -o '"agent_id":"[^"]*"' | cut -d'"' -f4)"
        echo "  Hostname: $(echo "$STATUS" | grep -o '"hostname":"[^"]*"' | cut -d'"' -f4)"
        echo "  Port:     $(echo "$STATUS" | grep -o '"port":[0-9]*' | cut -d: -f2)"
        echo ""
    else
        warn "Daemon noch nicht erreichbar — pruefe Logs:"
        echo "  tail -f $LOG_DIR/daemon.log"
        echo "  tail -f $LOG_DIR/daemon.error.log"
    fi
}

# --- Hauptprogramm ---
main() {
    echo ""
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║     thinklocal-mcp Installer          ║"
    echo "  ║     Mesh fuer AI CLI Agenten          ║"
    echo "  ╚═══════════════════════════════════════╝"
    echo ""

    detect_platform
    check_prerequisites
    install_repo
    install_deps
    setup_data_dir

    case "$PLATFORM" in
        macos)   install_macos_service ;;
        linux)   install_linux_service ;;
        windows) warn "Windows: Bitte scripts/service/thinklocal-daemon.ps1 manuell ausfuehren" ;;
    esac

    setup_mcp
    verify_installation

    echo ""
    ok "Installation abgeschlossen!"
    echo ""
    echo "  Naechste Schritte:"
    echo "  1. Dashboard starten:  cd $INSTALL_DIR && npm run dashboard:dev"
    echo "  2. CLI nutzen:         cd $INSTALL_DIR && npm run tlmcp -- status"
    echo "  3. Claude Code oeffnen — thinklocal-Tools sind automatisch verfuegbar"
    echo "  4. Zweiten Node auf einem anderen Rechner installieren:"
    echo "     ssh user@andere-maschine 'curl -fsSL https://raw.githubusercontent.com/2000teddy/thinklocal-mcp/main/scripts/install.sh | bash'"
    echo ""
}

main "$@"
