#!/bin/bash
#
# ssh-bootstrap-trust.sh — Auto-Pairing zwischen ThinkLocal-Peers via SSH
#
# Wenn der Operator bereits SSH-Zugriff auf alle Peer-Nodes hat, ist die
# manuelle SPAKE2 PIN-Zeremonie redundant. Dieses Script nutzt den
# bestehenden SSH-Vertrauensanker, um:
#
#   1. die Identitaet (CA-Cert + Public Key + SPIFFE-URI) jedes Peers
#      via `ssh peer cat ~/.thinklocal/...` abzuholen
#   2. lokal in /Users/chris/.thinklocal/pairing/paired-peers.json einzutragen
#   3. umgekehrt die eigene Identitaet auf jedem Peer einzutragen
#   4. alle Daemons neuzustarten, damit der TrustStore die neuen CAs laedt
#
# Voraussetzungen:
#   - SSH-Zugriff (passwordless oder Keychain) auf alle Peers
#   - jq lokal und auf den Peers (oder fallback python)
#   - thinklocal-Daemon auf jedem Peer mindestens einmal gestartet
#     (damit ~/.thinklocal/tls/ und keys/ existieren)
#
# Aufruf:
#   bash scripts/ssh-bootstrap-trust.sh peer1.example.com peer2.example.com
#   bash scripts/ssh-bootstrap-trust.sh 10.10.10.56 10.10.10.222
#
# Sicherheit:
#   Dieses Script erweitert das Trust-Modell um "wer SSH-Root-Zugriff hat,
#   darf Mesh-Trust setzen". Das ist eine bewusste Vereinfachung fuer den
#   Single-Operator-Fall (alle Nodes gehoeren derselben Person). Fuer fremde
#   Nodes BLEIBT die SPAKE2 PIN-Zeremonie der einzig richtige Weg.

set -euo pipefail

# --- Konfiguration ---
TLS_DIR="${TLMCP_TLS_DIR:-$HOME/.thinklocal/tls}"
KEYS_DIR="${TLMCP_KEYS_DIR:-$HOME/.thinklocal/keys}"
PAIRING_DIR="${TLMCP_PAIRING_DIR:-$HOME/.thinklocal/pairing}"
PAIRED_FILE="$PAIRING_DIR/paired-peers.json"
SSH_USER="${TLMCP_SSH_USER:-chris}"
REMOTE_PATH="${TLMCP_REMOTE_PATH:-.thinklocal}"

# SECURITY (PR #78 GPT-5.4 retro MEDIUM): REMOTE_PATH wird in remote
# Shell-Kommandos interpoliert. Unkontrollierte Werte (Quotes, Semikolons,
# Backticks) koennten Remote-Shell-Injection ermoeglichen. Validieren.
if ! [[ "$REMOTE_PATH" =~ ^[a-zA-Z0-9._/-]+$ ]]; then
  echo "FEHLER: TLMCP_REMOTE_PATH enthaelt ungueltige Zeichen: $REMOTE_PATH" >&2
  echo "Erlaubt: [a-zA-Z0-9._/-]" >&2
  exit 1
fi

# --- Hilfsfunktionen ---
die() { echo "FEHLER: $*" >&2; exit 1; }
log() { echo "[bootstrap-trust] $*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "$1 nicht gefunden — bitte installieren"
}

require_cmd jq
require_cmd ssh
require_cmd shasum

if [ $# -lt 1 ]; then
  cat >&2 <<EOF
Usage: $0 <peer-host> [<peer-host> ...]

Beispiel:
  $0 10.10.10.56 10.10.10.222

ENV-Overrides:
  TLMCP_SSH_USER     SSH-User auf den Peers (default: chris)
  TLMCP_REMOTE_PATH  Pfad relativ zum Home-Dir des Peers (default: .thinklocal)
  TLMCP_TLS_DIR      Lokales TLS-Verzeichnis (default: ~/.thinklocal/tls)
  TLMCP_KEYS_DIR     Lokales Keys-Verzeichnis (default: ~/.thinklocal/keys)
EOF
  exit 1
fi

PEERS=("$@")

# --- 1. Eigene Identitaet einlesen ---
[ -f "$TLS_DIR/ca.crt.pem" ] || die "Eigene CA fehlt: $TLS_DIR/ca.crt.pem (Daemon noch nie gestartet?)"
[ -f "$KEYS_DIR/agent.pub.pem" ] || die "Eigener Pub-Key fehlt: $KEYS_DIR/agent.pub.pem"
[ -f "$KEYS_DIR/node-id.txt" ] || die "Eigene Node-ID fehlt: $KEYS_DIR/node-id.txt — alten Daemon erst neu starten"

OWN_CA_PEM="$(cat "$TLS_DIR/ca.crt.pem")"
OWN_PUB_PEM="$(cat "$KEYS_DIR/agent.pub.pem")"
OWN_NODE_ID="$(tr -d '[:space:]' < "$KEYS_DIR/node-id.txt")"
OWN_AGENT_TYPE="${TLMCP_AGENT_TYPE:-claude-code}"
OWN_SPIFFE="spiffe://thinklocal/host/${OWN_NODE_ID}/agent/${OWN_AGENT_TYPE}"
OWN_FINGERPRINT="$(echo -n "$OWN_PUB_PEM" | shasum -a 256 | cut -d' ' -f1)"
OWN_HOSTNAME="$(hostname -s)"

log "Eigene Identitaet:"
log "  spiffe:      $OWN_SPIFFE"
log "  node-id:     $OWN_NODE_ID"
log "  fingerprint: $OWN_FINGERPRINT"

mkdir -p "$PAIRING_DIR"
# SECURITY (PR #78 GPT-5.4 retro LOW): explicit 0600 permissions on local
# paired-peers.json, unlike the default umask which gives 0644.
if [ ! -f "$PAIRED_FILE" ]; then
  (umask 077 && echo '[]' > "$PAIRED_FILE")
fi
chmod 600 "$PAIRED_FILE"

# Track errors across peers (for a non-zero exit code at the end)
had_errors=0

# --- 2. Helper: Peer-Eintrag in JSON-Datei einfuegen oder updaten ---
upsert_peer_local() {
  local agent_id="$1"
  local pub_pem="$2"
  local ca_pem="$3"
  local fingerprint="$4"
  local hostname="$5"

  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")"

  jq --arg id "$agent_id" \
     --arg pub "$pub_pem" \
     --arg ca "$ca_pem" \
     --arg fp "$fingerprint" \
     --arg host "$hostname" \
     --arg now "$now" \
     '
     # Drop existing entry with same agentId, then append new
     map(select(.agentId != $id)) +
     [{
       agentId: $id,
       publicKeyPem: $pub,
       caCertPem: $ca,
       fingerprint: $fp,
       pairedAt: $now,
       hostname: $host
     }]
     ' "$PAIRED_FILE" > "$PAIRED_FILE.tmp" && mv "$PAIRED_FILE.tmp" "$PAIRED_FILE"
}

# --- 3. Pro Peer: holen + lokal eintragen + remote eintragen ---
for PEER in "${PEERS[@]}"; do
  log ""
  log "═══ Peer: $PEER ═══"

  # 3a. SSH-Reachability test
  if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$SSH_USER@$PEER" 'true' 2>/dev/null; then
    log "  ✗ SSH zu $SSH_USER@$PEER fehlgeschlagen — ueberspringe"
    had_errors=1
    continue
  fi

  # 3b. Peer-Identitaet abholen
  log "  Hole CA, Pub-Key und Node-ID..."
  PEER_CA="$(ssh "$SSH_USER@$PEER" "cat \$HOME/$REMOTE_PATH/tls/ca.crt.pem 2>/dev/null")" \
    || { log "  ✗ Peer-CA nicht gefunden — ueberspringe"; continue; }
  PEER_PUB="$(ssh "$SSH_USER@$PEER" "cat \$HOME/$REMOTE_PATH/keys/agent.pub.pem 2>/dev/null")" \
    || { log "  ✗ Peer-Pub-Key nicht gefunden — ueberspringe"; continue; }
  # Versuch 1: stable node-id (PR #74+ Daemon)
  PEER_NODE_ID="$(ssh "$SSH_USER@$PEER" "tr -d '[:space:]' < \$HOME/$REMOTE_PATH/keys/node-id.txt 2>/dev/null" || true)"
  PEER_HOSTNAME="$(ssh "$SSH_USER@$PEER" 'hostname -s' 2>/dev/null)"
  PEER_AGENT_TYPE="${TLMCP_PEER_AGENT_TYPE:-claude-code}"

  # SECURITY (PR #78 GPT-5.4 retro LOW): validate node-id format before using.
  # Ein korruptes oder manipuliertes node-id.txt auf dem Peer koennte sonst
  # beliebige Strings in unsere lokale paired-peers.json injizieren.
  if [[ "$PEER_NODE_ID" =~ ^[0-9a-f]{16}$ ]]; then
    # Neuer Daemon: stable node-id verfuegbar und valide
    PEER_SPIFFE="spiffe://thinklocal/host/${PEER_NODE_ID}/agent/${PEER_AGENT_TYPE}"
    log "  → Modus: stable node-id"
  elif [ -n "$PEER_NODE_ID" ]; then
    log "  ✗ Ungueltige node-id auf Peer (erwarte 16 hex): '$PEER_NODE_ID' — ueberspringe"
    had_errors=1
    continue
  else
    # Legacy-Daemon: SPIFFE aus Hostname (original-Schreibweise des Peers).
    # Wir nutzen `hostname` (nicht `hostname -s`), weil der alte Daemon
    # os.hostname() nutzte — das ist meist mit FQDN-Suffix wie ".local".
    PEER_LEGACY_HOST="$(ssh "$SSH_USER@$PEER" 'hostname' 2>/dev/null)"
    PEER_SPIFFE="spiffe://thinklocal/host/${PEER_LEGACY_HOST}/agent/${PEER_AGENT_TYPE}"
    log "  → Modus: legacy hostname-SPIFFE ($PEER_LEGACY_HOST)"
    log "    HINWEIS: Peer laeuft mit altem Daemon. Bidirektionales Trust setzen,"
    log "    aber der Peer wird seinen eigenen TrustStore noch nicht respektieren."
    log "    Erst nach Peer-Daemon-Update mit PR #74+ ist mTLS in beide Richtungen aktiv."
  fi
  PEER_FINGERPRINT="$(echo -n "$PEER_PUB" | shasum -a 256 | cut -d' ' -f1)"

  log "  spiffe:      $PEER_SPIFFE"
  log "  hostname:    $PEER_HOSTNAME"
  log "  fingerprint: $PEER_FINGERPRINT"

  # 3c. Lokal eintragen
  upsert_peer_local "$PEER_SPIFFE" "$PEER_PUB" "$PEER_CA" "$PEER_FINGERPRINT" "$PEER_HOSTNAME"
  log "  ✓ Peer in lokaler $PAIRED_FILE eingetragen"

  # 3d. Remote: eigene Identitaet eintragen.
  # Vorgehen: JSON lokal bauen, base64-encoden, single-line via Argument an
  # bash -s uebergeben. Robust gegen Newlines, Quotes und Shell-Escapes.
  log "  Schreibe eigene Identitaet in Peer's paired-peers.json..."

  OWN_PEER_JSON_B64="$(jq -n -c \
    --arg id "$OWN_SPIFFE" \
    --arg pub "$OWN_PUB_PEM" \
    --arg ca "$OWN_CA_PEM" \
    --arg fp "$OWN_FINGERPRINT" \
    --arg host "$OWN_HOSTNAME" \
    --arg now "$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")" \
    '{agentId: $id, publicKeyPem: $pub, caCertPem: $ca, fingerprint: $fp, pairedAt: $now, hostname: $host}' \
    | base64 | tr -d '\n')"

  REMOTE_RESULT="$(ssh "$SSH_USER@$PEER" "PEER_B64='$OWN_PEER_JSON_B64' REMOTE_DIR='$REMOTE_PATH' bash -s" <<'REMOTE_EOF' 2>&1
set -e
mkdir -p "$HOME/$REMOTE_DIR/pairing"
PAIRED="$HOME/$REMOTE_DIR/pairing/paired-peers.json"
[ -f "$PAIRED" ] || echo "[]" > "$PAIRED"
NEW_PEER="$(echo "$PEER_B64" | base64 -d)"
NEW_ID=$(echo "$NEW_PEER" | jq -r '.agentId')
echo "$NEW_PEER" | jq --slurpfile existing "$PAIRED" --arg id "$NEW_ID" \
  '($existing[0] | map(select(.agentId != $id))) + [.]' \
  > "$PAIRED.tmp" && mv "$PAIRED.tmp" "$PAIRED"
chmod 600 "$PAIRED"
echo "REMOTE_OK count=$(jq length "$PAIRED")"
REMOTE_EOF
  )" || true

  if echo "$REMOTE_RESULT" | grep -q REMOTE_OK; then
    log "  ✓ Eigene Identitaet auf $PEER eingetragen ($REMOTE_RESULT)"
  else
    log "  ✗ Remote-Schreiben fehlgeschlagen:"
    echo "$REMOTE_RESULT" | sed 's/^/    /' >&2
    had_errors=1
  fi
done

log ""
log "═══ Lokale paired-peers.json ═══"
jq '. | length as $n | "Anzahl gepairte Peers: \($n)", (.[] | "  - \(.hostname) (\(.agentId))")' -r "$PAIRED_FILE"

log ""
log "═══ Naechste Schritte ═══"
log "  1. Lokalen Daemon neu starten (laedt neue CAs in den Trust-Store):"
log "     pkill -f 'tsx.*src/index.ts' && bash /tmp/start-tlmcp-lan.sh"
log "  2. Daemons auf den Peers neu starten:"
for PEER in "${PEERS[@]}"; do
  log "     ssh $SSH_USER@$PEER 'launchctl kickstart -k gui/\$(id -u)/com.thinklocal.daemon || pkill -HUP -f thinklocal'"
done
log "  3. mesh_status pruefen — peers_online sollte > 0 sein"
log ""

# SECURITY (PR #78 GPT-5.4 retro MEDIUM): exit non-zero wenn mindestens ein
# Peer fehlgeschlagen ist — sonst sehen Automationstools keinen Fehler,
# obwohl nur ein Teil der Trust-Operationen erfolgreich war.
if [ "$had_errors" -ne 0 ]; then
  log "Fertig MIT Fehlern."
  exit 1
fi
log "Fertig."
