#!/usr/bin/env bash
# Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
#
# tl14-verify-chain.sh — Schritt 5 des TL-14-Runbooks: Chain-of-Trust-Verifikation.
#
# Läuft auf einem beliebigen Rechner (nur öffentliches Material). Prüft in einem Durchgang
# die vier Eigenschaften, an denen der Umzug in der Praxis scheitert:
#
#   1. Kette gültig:  Root -> Intermediate -> Leaf (openssl verify, vendor-neutral)
#   2. Profil D2:     Root pathlen:1, Intermediate pathlen:0
#   3. Flacher Pfad:  Leaf verifiziert DIREKT gegen das Intermediate — das ist es, was der
#                     Token-Onboard-Pfad tut (tls.ts:520 -> verifyPeerCert, flacher
#                     Ein-Aussteller-Verify). Schlägt das fehl, weist der Daemon das
#                     Onboarding-Bundle ab ("Token-onboarded TLS-Bundle ungültig").
#   4. Pin-Wert:      der Fingerprint des DIREKTEN Ausstellers, den agent-card.ts:311 vergleicht.
#
# Aufruf:
#   bash scripts/tl14-ca/tl14-verify-chain.sh --root root.crt.pem --intermediate intermediate.crt.pem --leaf node.crt.pem
#
# Exit 0 = alle Prüfungen bestanden. Exit 1 = mindestens eine gescheitert (Details oben im Log).

set -euo pipefail
# shellcheck source=scripts/tl14-ca/_tl14-common.sh
. "$(dirname "$0")/_tl14-common.sh"

ROOT=""
INTER=""
LEAF=""

while [ $# -gt 0 ]; do
  case "$1" in
    --root) ROOT="${2:-}"; shift 2 ;;
    --intermediate) INTER="${2:-}"; shift 2 ;;
    --leaf) LEAF="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,21p' "$0"; exit 0 ;;
    *) tl14_die "unbekanntes Argument: $1" ;;
  esac
done

[ -n "$ROOT" ] || tl14_die "--root <datei> ist erforderlich"
[ -n "$INTER" ] || tl14_die "--intermediate <datei> ist erforderlich"
[ -n "$LEAF" ] || tl14_die "--leaf <datei> ist erforderlich"
tl14_need_openssl
for f in "$ROOT" "$INTER" "$LEAF"; do
  [ -f "$f" ] || tl14_die "Datei nicht gefunden: $f"
done

fail=0
report() { # $1 = 0/1 ok, $2 = Beschriftung, $3 = Detail
  if [ "$1" = "1" ]; then
    printf '  [OK]     %s\n' "$2"
  else
    printf '  [FEHLER] %s — %s\n' "$2" "$3"
    fail=1
  fi
}

# `|| true`: openssl verify liefert bei Ablehnung != 0; unter `set -e` bräche die Zuweisung
# ab, BEVOR wir den Text auswerten könnten.
echo "TL-14 Chain-of-Trust-Verifikation"
echo

out="$(openssl verify -CAfile "$ROOT" -untrusted "$INTER" "$LEAF" 2>&1 || true)"
if printf '%s' "$out" | grep -q ': OK$'; then
  report 1 "1. Kette Root -> Intermediate -> Leaf"
else
  report 0 "1. Kette Root -> Intermediate -> Leaf" "$(printf '%s' "$out" | grep -i -m 1 'error' | sed 's/^ *//' || echo "$out")"
fi

# `-text` einmal je Cert lesen und die basicConstraints-Zeile auswerten. OpenSSL schreibt sie
# als "CA:TRUE, pathlen:N" in die Zeile NACH "X509v3 Basic Constraints".
#
# `|| true` ist nötig: fehlt die Extension ganz, liefert `grep` Exit 1; unter `pipefail` +
# `set -e` stürbe das Skript an der Zuweisung — kommentarlos und ausgerechnet in dem Fall,
# den dieser Guard sichtbar machen soll (CR-Finding, 2026-08-31).
bc_of() { openssl x509 -in "$1" -noout -text 2>/dev/null | grep -A 1 'X509v3 Basic Constraints' | tail -1 | tr -d ' ' || true; }

# EXAKTER Vergleich, kein Wildcard-Suffix: '*pathlen:1*' würde auch 'pathlen:10' oder
# 'pathlen:100' akzeptieren — ein fundamentaler Profil-Fehler wäre stillschweigend
# durchgerutscht (CR-Finding, 2026-08-31).
root_bc="$(bc_of "$ROOT")"
inter_bc="$(bc_of "$INTER")"
if [ "$root_bc" = "CA:TRUE,pathlen:1" ]; then
  report 1 "2a. Root-Profil (CA:TRUE, pathlen:1)"
else
  report 0 "2a. Root-Profil (CA:TRUE, pathlen:1)" "gefunden: '${root_bc:-<keine basicConstraints>}' — ADR-045 D2 verlangt exakt CA:TRUE,pathlen:1"
fi
if [ "$inter_bc" = "CA:TRUE,pathlen:0" ]; then
  report 1 "2b. Intermediate-Profil (CA:TRUE, pathlen:0)"
else
  report 0 "2b. Intermediate-Profil (CA:TRUE, pathlen:0)" "gefunden: '${inter_bc:-<keine basicConstraints>}' — ADR-045 D2 verlangt exakt CA:TRUE,pathlen:0"
fi

# Flacher Ein-Aussteller-Verify: genau das, was verifyPeerCert im Token-Onboard-Pfad macht.
flat="$(openssl verify -partial_chain -CAfile "$INTER" "$LEAF" 2>&1 || true)"
if printf '%s' "$flat" | grep -q ': OK$'; then
  report 1 "3. Leaf direkt gegen Intermediate (Token-Onboard-Pfad, tls.ts:520)"
else
  report 0 "3. Leaf direkt gegen Intermediate (Token-Onboard-Pfad, tls.ts:520)" \
    "$(printf '%s' "$flat" | grep -i -m 1 'error' | sed 's/^ *//' || echo "$flat")"
fi

ROOT_FP="$(tl14_fingerprint "$ROOT")"
INTER_FP="$(tl14_fingerprint "$INTER")"

echo
cat <<EOF
Fingerprints:
  Root          $ROOT_FP   (Trust-Anker, NICHT der Pin-Wert)
  Intermediate  $INTER_FP   <-- TLMCP_PEERID_ATTESTING_CA_FP

Als ca.crt.pem im Onboarding-Bundle gehört das INTERMEDIATE (der direkte Aussteller) —
nicht die Root und nicht die Kette. Begründung: Runbook Schritt 5, Befunde F2/F4/F5.
EOF

echo
if [ "$fail" = "0" ]; then
  echo "ERGEBNIS: alle Prüfungen bestanden."
  exit 0
fi
echo "ERGEBNIS: mindestens eine Prüfung gescheitert — NICHT ausrollen." >&2
exit 1
