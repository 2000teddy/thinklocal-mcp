#!/usr/bin/env bash
# Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
#
# tl14-ceremony-root.sh — Schritt 2 des TL-14-Runbooks: die Offline-Wurzel erzeugen.
#
# LÄUFT AUSSCHLIESSLICH AUF DEM AIR-GAP-RECHNER. Der hier erzeugte Root-Key verlässt diese
# Maschine NIE (ADR-045 §Zielhierarchie). Er signiert genau zwei Dinge — das Intermediate
# TH01 und das Geschwister-Intermediate TH02 — und danach für 24 Monate nichts mehr.
#
# Cert-Profil (ADR-045 D2, korrigiert 2026-08-26):
#   basicConstraints = critical, CA:TRUE, pathlen:1   ← genau EINE Zwischenstufe
#   keyUsage         = critical, keyCertSign, cRLSign
# `pathlen:1` (nicht 0) ist der Kern der Korrektur: nach RFC 5280 §4.2.1.9 zählt
# `pathLenConstraint` die Zwischen-CAs, die dem Cert im Pfad FOLGEN dürfen. Mit `pathlen:0`
# wäre kein einziges Intermediate erlaubt und jedes Node-Cert mesh-weit ungültig
# (docs/architecture/TL-14a-D2-pathlen-blocker.md).
#
# Aufruf:
#   bash scripts/tl14-ca/tl14-ceremony-root.sh --out /media/airgap/tl14-root [--days 4383] [--cn "..."]
#
# Exit 0 = Root erzeugt, Fingerprint ausgegeben. Exit != 0 = nichts erzeugt.

set -euo pipefail
# shellcheck source=scripts/tl14-ca/_tl14-common.sh
. "$(dirname "$0")/_tl14-common.sh"

# ADR-045 D3: Root-Laufzeit-Korridor 10–15 Jahre; die EXAKTE Zahl ist bewusst kein
# ADR-Gegenstand, sondern wird bei der Zeremonie festgelegt. Default = 12 Jahre (Korridormitte).
DEFAULT_DAYS=4383
MIN_DAYS=3650   # 10 Jahre
MAX_DAYS=5478   # 15 Jahre

OUT=""
DAYS="$DEFAULT_DAYS"
CN="ThinkLocal Offline Root CA"
PASSFILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:-}"; shift 2 ;;
    --days) DAYS="${2:-}"; shift 2 ;;
    --cn) CN="${2:-}"; shift 2 ;;
    --passphrase-file) PASSFILE="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,25p' "$0"; exit 0 ;;
    *) tl14_die "unbekanntes Argument: $1" ;;
  esac
done

[ -n "$OUT" ] || tl14_die "--out <verzeichnis> ist erforderlich"
tl14_need_openssl
tl14_check_cn "$CN"
tl14_check_days "Root-Laufzeit" "$DAYS" "$MIN_DAYS" "$MAX_DAYS"

# Der Root-Key wird IMMER passphrase-verschlüsselt (AES-256).
#
# WARUM zwingend: Dateisystem-Rechte (600) schützen gegen den Nachbar-Account, nicht gegen
# den Verlust des Mediums. Ein entwendeter Air-Gap-Stick mit Klartext-Key kompromittiert die
# gesamte PKI ohne einen einzigen Rechenschritt. Der Root-Key wird alle 24 Monate genau
# einmal gebraucht (Intermediate-Erneuerung) — die Passphrase kostet also praktisch nichts.
#
# ABGRENZUNG: Für den TH01-INTERMEDIATE-Key gilt das GEGENTEIL, siehe
# tl14-ceremony-intermediate-csr.sh — der Daemon liest ihn mit forge.pki.privateKeyFromPem
# OHNE Passphrase-Unterstützung.
if [ -n "$PASSFILE" ]; then
  [ -f "$PASSFILE" ] || tl14_die "Passphrase-Datei nicht gefunden: $PASSFILE"
  PASSARG="file:$PASSFILE"
else
  PASSARG=""   # kein -passout ⇒ openssl fragt interaktiv (der Normalfall in der Zeremonie)
fi

mkdir -p "$OUT"
KEY="$OUT/root.key.pem"
CRT="$OUT/root.crt.pem"
tl14_refuse_overwrite "$KEY" "$CRT"

# umask VOR der Key-Erzeugung: der private Key darf nie — auch nicht für Millisekunden —
# welt-lesbar auf der Platte liegen.
umask 077

if [ -n "$PASSARG" ]; then
  tl14_openssl req -x509 -newkey rsa:4096 -aes256 -passout "$PASSARG" \
    -keyout "$KEY" -out "$CRT" \
    -days "$DAYS" -sha256 \
    -subj "/CN=$CN/O=thinklocal-mcp" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash"
else
  # Interaktiv: openssl fragt die Passphrase selbst ab (zweimal, mit Bestätigung).
  # NICHT über tl14_openssl, weil dessen stdout-Umleitung den Prompt verschluckt.
  openssl req -x509 -newkey rsa:4096 -aes256 \
    -keyout "$KEY" -out "$CRT" \
    -days "$DAYS" -sha256 \
    -subj "/CN=$CN/O=thinklocal-mcp" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:1" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    || tl14_die "Root-Erzeugung fehlgeschlagen (Passphrase-Eingabe abgebrochen?)"
fi

# Gegenprobe: der Key MUSS verschlüsselt sein. Ein Klartext-Root-Key wäre der Totalschaden,
# den diese Prüfung ausschliesst — lieber hier abbrechen als ihn ins Regal legen.
grep -q 'ENCRYPTED' "$KEY" || tl14_die "Root-Key ist NICHT verschlüsselt — Zeremonie abgebrochen. ($KEY bitte sicher löschen.)"

chmod 600 "$KEY"
chmod 644 "$CRT"

FP="$(tl14_fingerprint "$CRT")"

cat <<EOF

=== TL-14 Offline-Wurzel erzeugt ===
Cert:        $CRT
Key:         $KEY   (AES-256-verschlüsselt, Modus 600 — verlässt den Air-Gap NIE)
Laufzeit:    $DAYS Tage
Subject:     CN=$CN, O=thinklocal-mcp
Fingerprint: $FP

INS ZEREMONIE-PROTOKOLL ÜBERNEHMEN (Runbook Schritt 2, Protokollzeile "Root"):
  Fingerprint, Datum, anwesende Person(en), Aufbewahrungsort des Keys.

DIE PASSPHRASE GEHÖRT NICHT AUF DAS MEDIUM, auf dem der Key liegt — sonst ist die
Verschlüsselung wirkungslos. Getrennt verwahren (Passwortmanager/Papier im Safe).
Ohne sie ist in 24 Monaten keine Intermediate-Erneuerung mehr möglich.

WICHTIG — der Root-Fingerprint ist NICHT der Pin-Wert für TLMCP_PEERID_ATTESTING_CA_FP.
Gepinnt wird der DIREKTE Aussteller der Node-Leafs, also das INTERMEDIATE
(agent-card.ts:311 liest issuerCertificate.fingerprint256). Siehe Runbook Schritt 5.
EOF
