#!/usr/bin/env bash
# Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
#
# tl14-pathlen-proof.sh — reproduzierbarer Beleg für das ADR-045-D2-Cert-Profil.
#
# ADR-045 D2 (Stand 2026-08-26, korrigiert): Root `pathLen 1` + Intermediate `pathLen 0`.
# Nach RFC 5280 §4.2.1.9 ist `pathLenConstraint` die maximale Anzahl NICHT-selbst-ausgestellter
# Zwischen-CAs, die dem Zertifikat im Pfad FOLGEN dürfen. Root(pathlen:1) erlaubt damit genau
# eine Zwischenstufe; Root(pathlen:0) erlaubt KEINE und macht die Zielhierarchie
# Root -> Intermediate (TH01/TH02) -> Node-Leafs unverifizierbar.
#
# HISTORIE: Die D2-Erstfassung schrieb `Root pathLen 0` vor. Dieses Skript war der Beleg, der
# den Fehler zeigte (siehe docs/architecture/TL-14a-D2-pathlen-blocker.md); es bleibt als
# Vor-Zeremonie-Check erhalten — vor der Offline-Wurzel-Zeremonie einmal laufen lassen, um zu
# bestätigen, dass das OpenSSL der Zeremonie-Maschine sich wie erwartet verhält.
#
# Dieses Skript beweist das vendor-neutral mit OpenSSL (unabhängig von node-forge).
# Es ist NICHT Teil der Zeremonie: es erzeugt ausschließlich Wegwerf-Material in einem
# temporären Verzeichnis und fasst weder Daemon-State noch echte CA-Dateien an.
#
# Aufruf:  bash scripts/tl14-ca/tl14-pathlen-proof.sh
# Exit 0 = Befund reproduziert (pathlen:0 scheitert, pathlen:1 gelingt).
# Exit 1 = Befund NICHT reproduziert -> dann ist diese Note überholt, bitte prüfen.

set -euo pipefail

command -v openssl >/dev/null 2>&1 || { echo "FEHLER: openssl nicht gefunden" >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

echo "OpenSSL: $(openssl version)"
echo

mk_root() { # $1 = pathlen, $2 = out-basename
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout "$2.key" -out "$2.crt" -days 3650 -subj "/CN=TL14 Proof Root p$1" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:$1" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
}

# Ein Intermediate-Keypair/CSR, von beiden Roots signiert -> der EINZIGE Unterschied
# zwischen den zwei Ketten ist der pathLen der Root.
openssl req -newkey rsa:2048 -nodes -keyout int.key -out int.csr -subj "/CN=TL14 Proof Intermediate" 2>/dev/null
printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n' > int.ext
printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\n' > leaf.ext

rc_expected=0
for PL in 0 1; do
  mk_root "$PL" "root$PL"
  openssl x509 -req -in int.csr -CA "root$PL.crt" -CAkey "root$PL.key" -CAcreateserial \
    -out "int$PL.crt" -days 730 -extfile int.ext 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -keyout "leaf$PL.key" -out "leaf$PL.csr" -subj "/CN=tl14-proof-leaf" 2>/dev/null
  openssl x509 -req -in "leaf$PL.csr" -CA "int$PL.crt" -CAkey int.key -CAcreateserial \
    -out "leaf$PL.crt" -days 90 -extfile leaf.ext 2>/dev/null

  # `|| true` ist nötig: `openssl verify` liefert bei Ablehnung != 0, und unter `set -e`
  # würde die Zuweisung mit dem Exit-Code der Substitution abbrechen, BEVOR wir ihn auswerten.
  verify_out="$(openssl verify -CAfile "root$PL.crt" -untrusted "int$PL.crt" "leaf$PL.crt" 2>&1 || true)"
  if printf '%s' "$verify_out" | grep -q ': OK$'; then
    result="OK (Kette gültig)"
    ok=1
  else
    reason="$(printf '%s' "$verify_out" | grep -i 'error' | head -1 | sed 's/^ *//')"
    result="ABGELEHNT — ${reason:-unbekannter Fehler}"
    ok=0
  fi
  printf 'Root pathlen:%s -> Intermediate(pathlen:0) -> Leaf  ==> %s\n' "$PL" "$result"

  # Erwartung: pathlen:0 scheitert, pathlen:1 gelingt.
  if [ "$PL" = "0" ] && [ "$ok" = "1" ]; then rc_expected=1; fi
  if [ "$PL" = "1" ] && [ "$ok" = "0" ]; then rc_expected=1; fi
done

echo
if [ "$rc_expected" = "0" ]; then
  echo "BESTAETIGT: ADR-045 D2 ist korrekt kodiert — Root pathLen 1 + Intermediate pathLen 0."
  echo "(Root pathLen 0 waere mit der Zweistufen-Zielhierarchie unvereinbar.)"
  exit 0
fi
echo "ABWEICHUNG: Das OpenSSL dieser Maschine verhaelt sich anders als erwartet — NICHT mit der" >&2
echo "Zeremonie fortfahren, bevor das geklaert ist (docs/architecture/TL-14a-D2-pathlen-blocker.md)." >&2
exit 1
