#!/usr/bin/env bash
# Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
#
# tl14-ceremony-intermediate-csr.sh — Schritt 3a/4a des TL-14-Runbooks:
# Intermediate-Keypair + CSR erzeugen.
#
# LÄUFT AUF DEM ZIELHOST (TH01 bzw. TH02), NICHT auf dem Air-Gap-Rechner. Das ist der ganze
# Punkt der CSR-Mechanik: der private Schlüssel des Intermediates entsteht dort, wo er
# arbeiten wird, und wird nie transportiert. Über den Air-Gap wandert nur die CSR (öffentlich)
# hin und das signierte Cert (öffentlich) zurück — beides unbedenklich auf einem USB-Stick.
#
# Für TH02 (kalte Reserve, ADR-045 D6) läuft dasselbe Skript mit anderem --cn/--out. Der
# TH02-Key wird danach versiegelt verwahrt und NICHT in einen laufenden Daemon eingebaut.
#
# Aufruf:
#   bash scripts/tl14-ca/tl14-ceremony-intermediate-csr.sh --out ~/tl14-int-th01 --cn "ThinkLocal Intermediate CA TH01"
#
# Exit 0 = Key + CSR erzeugt.

set -euo pipefail
# shellcheck source=scripts/tl14-ca/_tl14-common.sh
. "$(dirname "$0")/_tl14-common.sh"

OUT=""
CN=""
ENCRYPT=0
PASSFILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --cn) CN="${2:-}"; shift 2 ;;
    --encrypt-key) ENCRYPT=1; shift ;;
    --passphrase-file) PASSFILE="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) tl14_die "unbekanntes Argument: $1" ;;
  esac
done

[ -n "$OUT" ] || tl14_die "--out <verzeichnis> ist erforderlich"
[ -n "$CN" ] || tl14_die "--cn <common-name> ist erforderlich (z.B. 'ThinkLocal Intermediate CA TH01')"
tl14_need_openssl
tl14_check_cn "$CN"

mkdir -p "$OUT"
KEY="$OUT/intermediate.key.pem"
CSR="$OUT/intermediate.csr.pem"
tl14_refuse_overwrite "$KEY" "$CSR"

umask 077

# SCHLÜSSEL-VERSCHLÜSSELUNG — bewusst asymmetrisch zwischen TH01 und TH02:
#
#   TH01 (operativ, --encrypt-key NICHT setzen): der Key MUSS im Klartext bleiben. Er wird zu
#   `tls/ca.key.pem`, und der Daemon liest ihn mit `forge.pki.privateKeyFromPem`
#   (packages/daemon/src/tls.ts:465, :116) — OHNE jede Passphrase-Unterstützung. Ein
#   verschlüsselter Key parst dort NICHT, `caPairMatches` wird false, und der Daemon
#   generiert daraufhin eine FRISCHE selbstsignierte Root (tls.ts:472-477 -> :549-554),
#   die das gesamte Zeremonie-Material überschreibt. Schutz kommt hier über Dateirechte
#   (600) und den Host, nicht über eine Passphrase.
#
#   TH02 (kalte Reserve, --encrypt-key EMPFOHLEN): dieser Key wird nie von einem Daemon
#   geladen, sondern versiegelt verwahrt. Dateirechte schützen nicht gegen Medienverlust —
#   hier ist die Passphrase der eigentliche Schutz. Sie gehört getrennt vom Medium verwahrt
#   und wird bei der Reserve-Aktivierung gebraucht (D6-Trockenprobe!).
if [ "$ENCRYPT" = "1" ]; then
  if [ -n "$PASSFILE" ]; then
    [ -f "$PASSFILE" ] || tl14_die "Passphrase-Datei nicht gefunden: $PASSFILE"
    tl14_openssl req -newkey rsa:4096 -aes256 -passout "file:$PASSFILE" \
      -keyout "$KEY" -out "$CSR" -sha256 \
      -subj "/CN=$CN/O=thinklocal-mcp"
  else
    openssl req -newkey rsa:4096 -aes256 \
      -keyout "$KEY" -out "$CSR" -sha256 \
      -subj "/CN=$CN/O=thinklocal-mcp" \
      || tl14_die "CSR-Erzeugung fehlgeschlagen (Passphrase-Eingabe abgebrochen?)"
  fi
  grep -q 'ENCRYPTED' "$KEY" || tl14_die "Key ist trotz --encrypt-key NICHT verschlüsselt — abgebrochen. ($KEY bitte sicher löschen.)"
else
  tl14_openssl req -newkey rsa:4096 -nodes \
    -keyout "$KEY" -out "$CSR" -sha256 \
    -subj "/CN=$CN/O=thinklocal-mcp"
fi

chmod 600 "$KEY"
chmod 644 "$CSR"

cat <<EOF

=== TL-14 Intermediate-CSR erzeugt ===
Key: $KEY   (Modus 600 — bleibt auf DIESEM Host)
CSR: $CSR   (öffentlich — geht auf den Air-Gap-Rechner)

NÄCHSTER SCHRITT: NUR die CSR auf den Air-Gap-Rechner bringen und dort
  bash scripts/tl14-ca/tl14-ceremony-sign-intermediate.sh --root-dir <root> --csr intermediate.csr.pem --out intermediate.crt.pem
ausführen. Den Key NICHT kopieren — auch nicht "nur zum Backup".
EOF
