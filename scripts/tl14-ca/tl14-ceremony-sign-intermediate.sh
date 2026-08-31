#!/usr/bin/env bash
# Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
#
# tl14-ceremony-sign-intermediate.sh — Schritt 3b/4b des TL-14-Runbooks:
# eine Intermediate-CSR mit der Offline-Wurzel signieren.
#
# LÄUFT AUSSCHLIESSLICH AUF DEM AIR-GAP-RECHNER (hier liegt der Root-Key).
#
# Cert-Profil (ADR-045 D2):
#   basicConstraints = critical, CA:TRUE, pathlen:0   ← TH01/TH02 dürfen KEINE Sub-CAs
#   keyUsage         = critical, keyCertSign, cRLSign
# `pathlen:0` AM INTERMEDIATE ist die Stelle, an der das Schutzziel "exakt zwei Stufen"
# tatsächlich hängt — nicht am pathLen der Root.
#
# Laufzeit: ADR-045 D3 = 24 Monate (730 Tage, Owner-Sign-off 2026-08-26).
#
# Aufruf:
#   bash scripts/tl14-ca/tl14-ceremony-sign-intermediate.sh \
#     --root-dir /media/airgap/tl14-root --csr intermediate.csr.pem --out intermediate.crt.pem [--days 730]
#
# Exit 0 = Intermediate signiert, Fingerprint (= Pin-Wert) ausgegeben.

set -euo pipefail
# shellcheck source=scripts/tl14-ca/_tl14-common.sh
. "$(dirname "$0")/_tl14-common.sh"

DEFAULT_DAYS=730   # ADR-045 D3 — 24 Monate
MIN_DAYS=365       # Korridor 1–3 Jahre (Consensus 2026-08-25); Abweichung = Beschluss-Abweichung
MAX_DAYS=1095

ROOT_DIR=""
CSR=""
OUT=""
DAYS="$DEFAULT_DAYS"
PASSFILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --root-dir) ROOT_DIR="${2:-}"; shift 2 ;;
    --csr) CSR="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --days) DAYS="${2:-}"; shift 2 ;;
    --passphrase-file) PASSFILE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
    *) tl14_die "unbekanntes Argument: $1" ;;
  esac
done

[ -n "$ROOT_DIR" ] || tl14_die "--root-dir <verzeichnis mit root.crt.pem/root.key.pem> ist erforderlich"
[ -n "$CSR" ] || tl14_die "--csr <datei> ist erforderlich"
[ -n "$OUT" ] || tl14_die "--out <datei> ist erforderlich"
tl14_need_openssl
tl14_check_days "Intermediate-Laufzeit" "$DAYS" "$MIN_DAYS" "$MAX_DAYS"

ROOT_CRT="$ROOT_DIR/root.crt.pem"
ROOT_KEY="$ROOT_DIR/root.key.pem"
[ -f "$ROOT_CRT" ] || tl14_die "Root-Cert nicht gefunden: $ROOT_CRT"
[ -f "$ROOT_KEY" ] || tl14_die "Root-Key nicht gefunden: $ROOT_KEY (läuft dieses Skript wirklich auf dem Air-Gap-Rechner?)"
[ -f "$CSR" ] || tl14_die "CSR nicht gefunden: $CSR"
tl14_refuse_overwrite "$OUT"

# Die CSR-Selbstsignatur prüfen, BEVOR die Root sie signiert. Eine CSR, die ihre eigene
# Signatur nicht trägt, belegt keinen Schlüsselbesitz — die Root würde einen fremden
# Public-Key beglaubigen.
#
# ACHTUNG, verifiziert an OpenSSL 3.0.13: `openssl req -noout -verify` liefert **Exit 0
# auch bei gebrochener Signatur** und meldet den Fehlschlag NUR im Text
# ("Certificate request self-signature verify failure"). Eine Exit-Code-Prüfung wäre hier
# also wirkungslos — deshalb wird auf das positive Verdikt ("verify OK") geprüft, nicht auf
# den Rückgabewert. Fail-closed: fehlt das Verdikt aus irgendeinem Grund, wird abgebrochen.
CSR_VERDICT="$(openssl req -in "$CSR" -noout -verify 2>&1 || true)"
case "$CSR_VERDICT" in
  *"verify OK"*) : ;;
  *) tl14_die "CSR-Selbstsignatur ungültig: $CSR — NICHT signieren, CSR neu erzeugen lassen. (openssl: ${CSR_VERDICT:-keine Ausgabe})" ;;
esac

# Gegenprobe zur Root-Bestätigung: Root muss selbst noch lange genug gültig sein, damit das
# Intermediate nicht über das Ende seines Ausstellers hinausreicht (sonst bricht die Kette
# mitten in der Intermediate-Laufzeit — verifyPeerCert prüft das CA-Fenster fail-closed,
# tls.ts:769).
#
# Umgesetzt mit `openssl x509 -checkend <sekunden>` statt mit `date`: Exit 0 = das Cert läuft
# innerhalb des Fensters NICHT ab. Das ist portabel (kein GNU-`date -d`, das auf BSD/macOS
# fehlschlägt) und damit **fail-closed ohne Ausnahmezweig** — die frühere Variante hätte auf
# macOS nur gewarnt und trotzdem signiert, was dem Fail-closed-Prinzip dieser Skripte
# widerspricht (CR-Finding, 2026-08-31).
if ! openssl x509 -in "$ROOT_CRT" -noout -checkend "$(( DAYS * 86400 ))" >/dev/null 2>&1; then
  tl14_die "Das Intermediate ($DAYS Tage) würde die Root überleben (oder die Root ist bereits abgelaufen). Die Kette bräche vor Ablauf des Intermediates — erst die Root erneuern. Prüfen: openssl x509 -in '$ROOT_CRT' -noout -enddate"
fi

EXT="$(mktemp)"
trap 'rm -f "$EXT"' EXIT
cat > "$EXT" <<'EOF'
basicConstraints=critical,CA:TRUE,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always
EOF

umask 022
# Der Root-Key ist passphrase-verschlüsselt (siehe tl14-ceremony-root.sh). Ohne
# --passphrase-file fragt openssl interaktiv — dann NICHT über tl14_openssl laufen lassen,
# weil dessen stdout-Umleitung den Prompt verschlucken würde.
if [ -n "$PASSFILE" ]; then
  [ -f "$PASSFILE" ] || tl14_die "Passphrase-Datei nicht gefunden: $PASSFILE"
  tl14_openssl x509 -req -in "$CSR" \
    -CA "$ROOT_CRT" -CAkey "$ROOT_KEY" -passin "file:$PASSFILE" -CAcreateserial \
    -out "$OUT" -days "$DAYS" -sha256 \
    -extfile "$EXT"
else
  openssl x509 -req -in "$CSR" \
    -CA "$ROOT_CRT" -CAkey "$ROOT_KEY" -CAcreateserial \
    -out "$OUT" -days "$DAYS" -sha256 \
    -extfile "$EXT" \
    || tl14_die "Signatur fehlgeschlagen (falsche Passphrase? Eingabe abgebrochen?)"
fi

FP="$(tl14_fingerprint "$OUT")"
SUBJ="$(openssl x509 -in "$OUT" -noout -subject | sed 's/^subject= *//')"

cat <<EOF

=== TL-14 Intermediate signiert ===
Cert:        $OUT
Subject:     $SUBJ
Laufzeit:    $DAYS Tage (ADR-045 D3)
Fingerprint: $FP

DIES IST DER PIN-WERT. Für den Doppel-Pin-Cutover (ADR-045 D4) gehört er zusammen mit dem
ALTEN CA-Fingerprint in TLMCP_PEERID_ATTESTING_CA_FP (kommagetrennt, Alt zuerst entfernen
erst NACH dem Node-N-Proof):

  TLMCP_PEERID_ATTESTING_CA_FP=<alt-fingerprint>,$FP

Warum das Intermediate und nicht die Root gepinnt wird: agent-card.ts:311 liest den
DIREKTEN Aussteller (issuerCertificate.fingerprint256). Ein reiner Root-Pin lehnt jeden
kanonischen Sender mit 403 ab. Siehe Runbook Schritt 5.

Ins Zeremonie-Protokoll: Fingerprint + Datum + für welchen Host (TH01/TH02).
EOF
