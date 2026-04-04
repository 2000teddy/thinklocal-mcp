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

# nvm laden falls vorhanden (curl | bash startet Non-Login-Shell)
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh" 2>/dev/null

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

# --- Hilfsfunktion: Paket installieren ---
install_pkg() {
    local PKG_NAME="$1"
    local PKG_APT="${2:-$1}"
    local PKG_DNF="${3:-$1}"

    if command -v apt-get &>/dev/null; then
        info "Installiere $PKG_NAME via apt..."
        sudo apt-get install -y $PKG_APT 2>/dev/null && \
            ok "$PKG_NAME installiert" && return 0
    elif command -v dnf &>/dev/null; then
        info "Installiere $PKG_NAME via dnf..."
        sudo dnf install -y $PKG_DNF 2>/dev/null && \
            ok "$PKG_NAME installiert" && return 0
    elif command -v brew &>/dev/null; then
        info "Installiere $PKG_NAME via brew..."
        brew install $PKG_APT 2>/dev/null && \
            ok "$PKG_NAME installiert" && return 0
    fi
    return 1
}

# --- Voraussetzungen pruefen und fehlende installieren ---
check_prerequisites() {
    info "Pruefe Voraussetzungen..."
    echo ""

    # 1. curl (wird fuer den Installer selbst gebraucht — sollte da sein)
    if command -v curl &>/dev/null; then
        ok "curl $(curl --version | head -1 | awk '{print $2}')"
    else
        warn "curl fehlt"
        install_pkg "curl" "curl" "curl" || error "curl konnte nicht installiert werden"
    fi

    # 2. Git
    if command -v git &>/dev/null; then
        ok "git $(git --version | awk '{print $3}')"
    else
        info "git fehlt — installiere..."
        install_pkg "git" "git" "git" || error "git konnte nicht installiert werden"
        ok "git $(git --version | awk '{print $3}')"
    fi

    # 3. Node.js
    if command -v node &>/dev/null; then
        NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
        if [ "$NODE_VERSION" -lt 18 ]; then
            warn "Node.js v$NODE_VERSION ist zu alt (mindestens v18 benoetigt)"
            info "Installiere Node.js 22 via nvm..."
            install_node_via_nvm
        elif [ "$NODE_VERSION" -lt 20 ]; then
            warn "Node.js $(node -v) — Version 20+ empfohlen (v18 funktioniert eingeschraenkt)"
        else
            ok "Node.js $(node -v)"
        fi
    else
        info "Node.js fehlt — installiere via nvm..."
        install_node_via_nvm
    fi

    # 4. npm (kommt mit Node.js)
    if command -v npm &>/dev/null; then
        ok "npm $(npm -v)"
    else
        error "npm nicht gefunden — Node.js-Installation fehlgeschlagen?"
    fi

    # 5. Linux-spezifisch: avahi-daemon fuer mDNS
    if [ "$PLATFORM" = "linux" ]; then
        if systemctl is-active avahi-daemon &>/dev/null; then
            ok "avahi-daemon (mDNS-Discovery)"
        else
            info "avahi-daemon fehlt — wird fuer Peer-Discovery im LAN benoetigt"
            install_pkg "avahi-daemon" "avahi-daemon avahi-utils" "avahi avahi-tools" || \
                warn "avahi-daemon konnte nicht installiert werden — Peer-Discovery funktioniert moeglicherweise nicht"
        fi
    fi

    # 6. Linux-spezifisch: build-essential fuer native npm-Module (better-sqlite3)
    if [ "$PLATFORM" = "linux" ]; then
        if command -v make &>/dev/null && command -v gcc &>/dev/null; then
            ok "Build-Tools (make, gcc)"
        else
            info "Build-Tools fehlen — werden fuer native npm-Module benoetigt"
            install_pkg "build-essential" "build-essential" "gcc-c++ make" || \
                warn "Build-Tools konnten nicht installiert werden — npm install koennte fehlschlagen"
        fi
    fi

    echo ""
    ok "Alle Voraussetzungen geprueft"
}

# --- Node.js via nvm installieren (ohne bestehende Installation zu beruehren) ---
install_node_via_nvm() {
    if ! command -v nvm &>/dev/null && [ ! -d "$HOME/.nvm" ]; then
        info "Installiere nvm (Node Version Manager)..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash 2>/dev/null
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    else
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    fi

    if command -v nvm &>/dev/null; then
        nvm install 22 2>/dev/null
        nvm alias default 22 2>/dev/null
        nvm use 22 2>/dev/null
        ok "Node.js $(node -v) via nvm installiert"
    else
        error "nvm konnte nicht installiert werden. Bitte Node.js 20+ manuell installieren: https://nodejs.org"
    fi
}

# --- Repository klonen oder aktualisieren ---
install_repo() {
    if [ -d "$INSTALL_DIR/.git" ]; then
        info "Aktualisiere bestehende Installation..."
        cd "$INSTALL_DIR"
        git fetch origin main
        git reset --hard origin/main
    elif [ -d "$INSTALL_DIR" ]; then
        # Verzeichnis existiert aber ohne .git — aufraumen und neu klonen
        warn "Verzeichnis $INSTALL_DIR existiert ohne Git — ersetze..."
        rm -rf "$INSTALL_DIR"
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    else
        info "Klone Repository..."
        git clone "$REPO_URL" "$INSTALL_DIR"
        cd "$INSTALL_DIR"
    fi
    ok "Repository in $INSTALL_DIR"
}

# --- Bestehende Installation aufraumen (fuer Reinstall/Update) ---
cleanup_existing() {
    if [ -d "$INSTALL_DIR" ] || [ -d "$DATA_DIR" ]; then
        info "Bestehende Installation gefunden — raeume auf..."

        # Daemon stoppen
        if [ "$PLATFORM" = "darwin" ]; then
            launchctl unload "$HOME/Library/LaunchAgents/com.thinklocal.daemon.plist" 2>/dev/null
        elif [ "$PLATFORM" = "linux" ]; then
            systemctl --user stop thinklocal-daemon 2>/dev/null
            systemctl --user disable thinklocal-daemon 2>/dev/null
        fi

        # Alte Service-Dateien entfernen
        rm -f "$HOME/Library/LaunchAgents/com.thinklocal.daemon.plist" 2>/dev/null
        rm -f "$HOME/.config/systemd/user/thinklocal-daemon.service" 2>/dev/null
        [ "$PLATFORM" = "linux" ] && systemctl --user daemon-reload 2>/dev/null

        # Daten behalten, nur Repo neu
        if [ -d "$INSTALL_DIR" ]; then
            rm -rf "$INSTALL_DIR"
            ok "Altes Repository entfernt"
        fi

        # Keys und Vault NICHT loeschen (Daten bleiben erhalten)
        ok "Aufgeraeumt (Keys und Vault-Daten bleiben erhalten)"
    fi
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
    # nvm-aware Node-Pfad
    NODE_PATH=$(command -v node)
    if [ -n "$NVM_BIN" ] && [ -x "$NVM_BIN/node" ]; then
        NODE_PATH="$NVM_BIN/node"
    fi
    NODE_PATH=$(realpath "$NODE_PATH" 2>/dev/null || echo "$NODE_PATH")
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
    # nvm-aware Node-Pfad: realpath folgt Symlinks, command -v findet auch nvm-Nodes
    NODE_PATH=$(command -v node)
    # Wenn nvm aktiv ist, bevorzuge den nvm-Pfad
    if [ -n "$NVM_BIN" ] && [ -x "$NVM_BIN/node" ]; then
        NODE_PATH="$NVM_BIN/node"
        info "nvm erkannt: Node aus $NODE_PATH"
    fi
    # Absoluten Pfad sicherstellen (realpath folgt Symlinks)
    NODE_PATH=$(realpath "$NODE_PATH" 2>/dev/null || readlink -f "$NODE_PATH" 2>/dev/null || echo "$NODE_PATH")
    local TSX_PATH="$INSTALL_DIR/packages/daemon/node_modules/.bin/tsx"
    local INDEX_PATH="$INSTALL_DIR/packages/daemon/src/index.ts"
    local SERVICE_DST="$HOME/.config/systemd/user/thinklocal-daemon.service"

    mkdir -p "$HOME/.config/systemd/user"

    # Service-Datei direkt generieren (NICHT aus Template!)
    # User-Services duerfen KEIN User=, Group=, ProtectSystem= etc. haben
    cat > "$SERVICE_DST" << SERVICEEOF
[Unit]
Description=thinklocal-mcp Mesh Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$NODE_PATH $TSX_PATH $INDEX_PATH
Environment=TLMCP_CONFIG=$INSTALL_DIR/config/daemon.toml
Environment=TLMCP_DATA_DIR=$HOME/.thinklocal
Environment=TLMCP_NO_TLS=1
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
WorkingDirectory=$INSTALL_DIR
Restart=on-failure
RestartSec=10
StandardOutput=append:$HOME/.thinklocal/logs/daemon.log
StandardError=append:$HOME/.thinklocal/logs/daemon.error.log

[Install]
WantedBy=default.target
SERVICEEOF

    # User-Service aktivieren
    systemctl --user daemon-reload
    systemctl --user enable thinklocal-daemon
    systemctl --user start thinklocal-daemon
    ok "systemd User-Service installiert und gestartet"

    # enable-linger damit Service auch ohne Login-Session laeuft
    loginctl enable-linger "$(whoami)" 2>/dev/null && \
        ok "User-Linger aktiviert (Service laeuft ohne Login)" || \
        warn "loginctl enable-linger fehlgeschlagen — ggf. sudo noetig"

    # mDNS-Port in Firewall oeffnen (falls ufw aktiv)
    if command -v ufw &>/dev/null; then
        sudo ufw allow 5353/udp 2>/dev/null && \
            ok "Firewall: mDNS Port 5353/udp erlaubt" || true
    fi

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

    # --reinstall: Bestehende Installation sauber entfernen und neu installieren
    if [ "${1:-}" = "--reinstall" ] || [ "${1:-}" = "--update" ] || [ "${1:-}" = "update" ]; then
        info "Reinstall/Update-Modus"
        detect_platform
        cleanup_existing
    else
        detect_platform
    fi

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
