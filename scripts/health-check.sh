#!/bin/bash
#
# Health-Check fuer thinklocal-mcp Daemon
#
# Probiert in Reihenfolge:
#   1. HTTPS + mTLS  (Default fuer Production/LAN-Mode mit Client-Cert)
#   2. HTTPS ohne Client-Cert (--insecure, falls Cert fehlt aber Daemon TLS spricht)
#   3. HTTP (local-Mode ohne TLS)
#
# Exit-Code 0 = Daemon erreichbar, 1 = nicht erreichbar.
#
# Override via ENV:
#   TLMCP_HOST       (default: localhost)
#   TLMCP_PORT       (default: 9440)
#   TLMCP_TLS_DIR    (default: ~/.thinklocal/tls)

set -u

HOST="${TLMCP_HOST:-localhost}"
PORT="${TLMCP_PORT:-9440}"
TLS_DIR="${TLMCP_TLS_DIR:-$HOME/.thinklocal/tls}"

CA="$TLS_DIR/ca.crt.pem"
CERT="$TLS_DIR/node.crt.pem"
KEY="$TLS_DIR/node.key.pem"

URL_HTTPS="https://$HOST:$PORT/health"
URL_HTTP="http://$HOST:$PORT/health"

# 1) HTTPS + mTLS (vollstaendige Verifikation)
if [ -f "$CA" ] && [ -f "$CERT" ] && [ -f "$KEY" ]; then
  RESPONSE=$(curl -sf --max-time 3 \
    --cacert "$CA" --cert "$CERT" --key "$KEY" \
    "$URL_HTTPS" 2>/dev/null) && {
    echo "$RESPONSE  [mTLS, $URL_HTTPS]"
    exit 0
  }
fi

# 2) HTTPS ohne Client-Cert (Fallback fuer Diagnose)
RESPONSE=$(curl -sfk --max-time 3 "$URL_HTTPS" 2>/dev/null) && {
  echo "$RESPONSE  [HTTPS ohne Client-Cert, $URL_HTTPS]"
  echo "  Hinweis: Daemon erreichbar, aber mTLS-Client-Auth fehlt." >&2
  exit 0
}

# 3) HTTP (local-Mode)
RESPONSE=$(curl -sf --max-time 3 "$URL_HTTP" 2>/dev/null) && {
  echo "$RESPONSE  [HTTP, $URL_HTTP]"
  exit 0
}

echo "Daemon nicht erreichbar: $URL_HTTPS / $URL_HTTP" >&2
exit 1
