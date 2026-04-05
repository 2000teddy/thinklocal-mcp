#!/usr/bin/env bash
# build-deb.sh — Erstellt ein .deb-Paket fuer thinklocal-mcp
#
# Nutzung: ./scripts/build-deb.sh [version]
# Beispiel: ./scripts/build-deb.sh 0.30.0
#
# Voraussetzungen: dpkg-deb (auf Debian/Ubuntu vorinstalliert)
# Ergebnis: dist/thinklocal-mcp_<version>_amd64.deb

set -euo pipefail

VERSION="${1:-$(node -p "require('./package.json').version" 2>/dev/null || echo '0.0.0')}"
ARCH="${2:-amd64}"
PKG_NAME="thinklocal-mcp"
PKG_DIR="dist/${PKG_NAME}_${VERSION}_${ARCH}"
INSTALL_DIR="/opt/thinklocal-mcp"

echo "==> Building ${PKG_NAME} v${VERSION} (${ARCH})"

# Aufräumen
rm -rf "$PKG_DIR"

# Verzeichnisstruktur anlegen
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR${INSTALL_DIR}"
mkdir -p "$PKG_DIR/usr/bin"
mkdir -p "$PKG_DIR/etc/thinklocal"
mkdir -p "$PKG_DIR/var/lib/thinklocal"
mkdir -p "$PKG_DIR/var/log/thinklocal"
mkdir -p "$PKG_DIR/lib/systemd/system"

# Control-Datei
cat > "$PKG_DIR/DEBIAN/control" << EOF
Package: ${PKG_NAME}
Version: ${VERSION}
Section: net
Priority: optional
Architecture: ${ARCH}
Depends: nodejs (>= 22.0.0)
Maintainer: ThinkLocal Team <thinklocal@example.com>
Description: Encrypted P2P mesh network for AI CLI agents
 ThinkLocal-MCP enables encrypted peer-to-peer communication
 between AI CLI agents (Claude Code, Codex, Gemini CLI) on the
 local network. Features mTLS, mDNS discovery, capability
 registry, audit logging, and MCP integration.
Homepage: https://github.com/2000teddy/thinklocal-mcp
EOF

# Post-Install Script
cat > "$PKG_DIR/DEBIAN/postinst" << 'EOF'
#!/bin/bash
set -e

# Benutzer erstellen (falls nicht vorhanden)
if ! id -u thinklocal >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin thinklocal
fi

# Verzeichnis-Berechtigungen
chown -R thinklocal:thinklocal /var/lib/thinklocal
chown -R thinklocal:thinklocal /var/log/thinklocal
chmod 750 /var/lib/thinklocal
chmod 750 /var/log/thinklocal

# npm Dependencies installieren
cd /opt/thinklocal-mcp
npm install --omit=dev --ignore-scripts 2>/dev/null || true
cd packages/daemon
npm install --omit=dev 2>/dev/null || true

# Systemd Service aktivieren
systemctl daemon-reload
systemctl enable thinklocal-mcp.service || true

echo ""
echo "=== ThinkLocal-MCP installiert ==="
echo ""
echo "  Starten:   systemctl start thinklocal-mcp"
echo "  Status:    systemctl status thinklocal-mcp"
echo "  Logs:      journalctl -u thinklocal-mcp -f"
echo "  CLI:       thinklocal status"
echo ""
EOF
chmod 755 "$PKG_DIR/DEBIAN/postinst"

# Pre-Remove Script
cat > "$PKG_DIR/DEBIAN/prerm" << 'EOF'
#!/bin/bash
set -e

# Service stoppen
systemctl stop thinklocal-mcp.service 2>/dev/null || true
systemctl disable thinklocal-mcp.service 2>/dev/null || true
EOF
chmod 755 "$PKG_DIR/DEBIAN/prerm"

# Post-Remove Script
cat > "$PKG_DIR/DEBIAN/postrm" << 'EOF'
#!/bin/bash
set -e

if [ "$1" = "purge" ]; then
    # Daten und Logs entfernen
    rm -rf /var/lib/thinklocal
    rm -rf /var/log/thinklocal
    rm -rf /etc/thinklocal
    # Benutzer entfernen
    userdel thinklocal 2>/dev/null || true
fi

systemctl daemon-reload
EOF
chmod 755 "$PKG_DIR/DEBIAN/postrm"

# Conffiles (Config-Dateien die bei Upgrade nicht ueberschrieben werden)
cat > "$PKG_DIR/DEBIAN/conffiles" << EOF
/etc/thinklocal/daemon.toml
EOF

# Projekt-Dateien kopieren
cp -r packages "$PKG_DIR${INSTALL_DIR}/"
cp package.json "$PKG_DIR${INSTALL_DIR}/"
cp -r config/* "$PKG_DIR/etc/thinklocal/" 2>/dev/null || true

# Default-Config
if [ ! -f "$PKG_DIR/etc/thinklocal/daemon.toml" ]; then
    cat > "$PKG_DIR/etc/thinklocal/daemon.toml" << 'TOML'
[daemon]
port = 9440
agent_type = "thinklocal"
data_dir = "/var/lib/thinklocal"

[mesh]
heartbeat_interval_ms = 10000
heartbeat_timeout_missed = 3

[discovery]
mdns_service_type = "_thinklocal._tcp"

[logging]
level = "info"
TOML
fi

# Symlink fuer Config
mkdir -p "$PKG_DIR${INSTALL_DIR}/config"
# Wird im postinst per ln -sf verlinkt

# Systemd Service-Unit
cat > "$PKG_DIR/lib/systemd/system/thinklocal-mcp.service" << EOF
[Unit]
Description=ThinkLocal-MCP Mesh Daemon
Documentation=https://github.com/2000teddy/thinklocal-mcp
After=network-online.target avahi-daemon.service
Wants=network-online.target

[Service]
Type=simple
User=thinklocal
Group=thinklocal
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node --import tsx ${INSTALL_DIR}/packages/daemon/src/index.ts
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=thinklocal-mcp

# Sicherheit
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/thinklocal /var/log/thinklocal
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

# Umgebungsvariablen
Environment=NODE_ENV=production
Environment=TLMCP_DATA_DIR=/var/lib/thinklocal
Environment=TLMCP_LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
EOF

# CLI Wrapper-Scripts
cat > "$PKG_DIR/usr/bin/thinklocal" << EOF
#!/bin/bash
exec node --import tsx ${INSTALL_DIR}/packages/cli/src/thinklocal.ts "\$@"
EOF
chmod 755 "$PKG_DIR/usr/bin/thinklocal"

cat > "$PKG_DIR/usr/bin/tlmcp-daemon" << EOF
#!/bin/bash
exec node --import tsx ${INSTALL_DIR}/packages/daemon/src/index.ts "\$@"
EOF
chmod 755 "$PKG_DIR/usr/bin/tlmcp-daemon"

cat > "$PKG_DIR/usr/bin/tlmcp-mcp" << EOF
#!/bin/bash
exec node --import tsx ${INSTALL_DIR}/packages/daemon/src/mcp-stdio.ts "\$@"
EOF
chmod 755 "$PKG_DIR/usr/bin/tlmcp-mcp"

# Node_modules und Build-Artefakte ausschliessen
rm -rf "$PKG_DIR${INSTALL_DIR}/packages/daemon/node_modules"
rm -rf "$PKG_DIR${INSTALL_DIR}/packages/dashboard-ui/node_modules"
rm -rf "$PKG_DIR${INSTALL_DIR}/node_modules"
rm -rf "$PKG_DIR${INSTALL_DIR}/.git"

# .deb bauen
if command -v dpkg-deb >/dev/null 2>&1; then
    dpkg-deb --build "$PKG_DIR"
    echo "==> Paket erstellt: ${PKG_DIR}.deb"
else
    echo "==> dpkg-deb nicht verfuegbar (nicht auf Debian/Ubuntu)"
    echo "    Paket-Struktur liegt in: ${PKG_DIR}/"
    echo "    Baue auf einem Debian/Ubuntu-System mit: dpkg-deb --build ${PKG_DIR}"
fi
