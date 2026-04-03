#!/usr/bin/env bash
set -euo pipefail

# thinklocal-mcp — Remote-Deployment via SSH
#
# Installiert den Daemon auf einem entfernten Rechner.
#
# Nutzung:
#   ./scripts/deploy-remote.sh user@hostname
#   ./scripts/deploy-remote.sh user@10.10.10.55
#   ./scripts/deploy-remote.sh user@hostname --agent-type gemini-cli --port 9441

REMOTE_HOST="${1:?Nutzung: $0 user@hostname [--agent-type TYPE] [--port PORT]}"
shift

AGENT_TYPE="claude-code"
PORT="9440"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --agent-type) AGENT_TYPE="$2"; shift 2 ;;
        --port)       PORT="$2"; shift 2 ;;
        *)            echo "Unbekannte Option: $1"; exit 1 ;;
    esac
done

echo ""
echo "  thinklocal-mcp Remote-Deployment"
echo "  ================================"
echo "  Ziel:       $REMOTE_HOST"
echo "  Agent-Typ:  $AGENT_TYPE"
echo "  Port:       $PORT"
echo ""

# 1. Pruefen ob SSH erreichbar
echo "[1/4] Pruefe SSH-Verbindung..."
ssh -o ConnectTimeout=5 "$REMOTE_HOST" "echo OK" || { echo "SSH-Verbindung fehlgeschlagen"; exit 1; }

# 2. Pruefen ob Node.js auf dem Remote vorhanden ist
echo "[2/4] Pruefe Node.js auf Remote..."
REMOTE_NODE=$(ssh "$REMOTE_HOST" "node -v 2>/dev/null || echo 'NOT_FOUND'")
if [ "$REMOTE_NODE" = "NOT_FOUND" ]; then
    echo ""
    echo "  Node.js nicht gefunden auf $REMOTE_HOST."
    echo "  Installiere zuerst Node.js 20+:"
    echo "    ssh $REMOTE_HOST 'curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs'"
    echo ""
    exit 1
fi
echo "  Node.js $REMOTE_NODE gefunden"

# 3. Installer auf Remote ausfuehren
echo "[3/4] Starte Installation auf Remote..."
ssh "$REMOTE_HOST" "curl -fsSL https://raw.githubusercontent.com/2000teddy/thinklocal-mcp/main/scripts/install.sh | TLMCP_AGENT_TYPE=$AGENT_TYPE TLMCP_PORT=$PORT bash"

# 4. Health-Check
echo "[4/4] Pruefe ob Daemon laeuft..."
sleep 3
REMOTE_IP=$(ssh "$REMOTE_HOST" "hostname -I | awk '{print \$1}'")
if curl -sf "http://$REMOTE_IP:$PORT/health" > /dev/null 2>&1; then
    echo ""
    echo "  Daemon laeuft auf $REMOTE_HOST ($REMOTE_IP:$PORT)"
    echo "  Agent Card: http://$REMOTE_IP:$PORT/.well-known/agent-card.json"
    echo ""
else
    echo "  Daemon noch nicht erreichbar — pruefe Logs auf $REMOTE_HOST:"
    echo "  ssh $REMOTE_HOST 'tail -20 ~/.thinklocal/logs/daemon.log'"
fi
