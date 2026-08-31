# Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
#
# _tl14-common.sh — gemeinsame Helfer der TL-14-Zeremonie-Skripte (ADR-045).
#
# Wird per `source` eingebunden, ist selbst NICHT ausführbar und tut beim Einbinden nichts.
# Alle Funktionen sind fail-closed: im Zweifel abbrechen statt weitermachen — eine Zeremonie,
# die auf halbem Weg falsches Material erzeugt, ist teurer als eine, die früh stoppt.

tl14_die() {
  echo "FEHLER: $*" >&2
  exit 1
}

# OpenSSL zerlegt `-subj` an Schrägstrichen in DN-Felder. Ein CN mit `/` (z.B.
# "ThinkLocal / Root CA") erzeugt daher stillschweigend eine kaputte DN-Struktur statt des
# gemeinten Namens — und der Subject-Name steht danach unveränderlich im Zertifikat.
tl14_check_cn() {
  case "$1" in
    '') tl14_die "CN darf nicht leer sein" ;;
    */*) tl14_die "CN darf keinen Schrägstrich enthalten ('$1') — OpenSSL würde ihn als DN-Feldtrenner lesen" ;;
    *=*) tl14_die "CN darf kein '=' enthalten ('$1') — OpenSSL würde es als DN-Zuweisung lesen" ;;
  esac
}

tl14_need_openssl() {
  command -v openssl >/dev/null 2>&1 || tl14_die "openssl nicht gefunden"
}

# Verhindert das stille Überschreiben von Schlüssel-/Cert-Material. Der Root-Key ist
# unwiederbringlich: ein zweiter Lauf desselben Skripts darf ihn NIEMALS ersetzen, sonst
# ist die gesamte darunterliegende Hierarchie (Intermediates + alle Node-Leafs) wertlos.
tl14_refuse_overwrite() {
  for f in "$@"; do
    [ -e "$f" ] && tl14_die "existiert bereits: $f — Zeremonie-Material wird NIE überschrieben. Anderes --out wählen oder bewusst wegräumen."
  done
  return 0
}

# SHA-256 über das DER des Zertifikats, kleingeschrieben ohne Doppelpunkte.
#
# Format-Begründung (code-verifiziert, schließt den in #352 offen geführten Format-Vorbehalt):
#   - `certFingerprint()` (`packages/daemon/src/cert-issuer.ts:94-98`) berechnet exakt dies
#     (Nachweis: `tests/integration/tl14-ceremony-cert-profile.test.ts` letzter Fall).
#   - `TLMCP_PEERID_ATTESTING_CA_FP` wird über `normalizeFingerprint()`
#     (`packages/daemon/src/peer-identity.ts:260-262`, entfernt `:`, uppercased) verglichen
#     ⇒ diese Form UND die OpenSSL-`AA:BB:…`-Form sind beide gültige Pin-Werte.
tl14_fingerprint() {
  openssl x509 -in "$1" -outform DER 2>/dev/null | openssl dgst -sha256 -hex \
    | sed 's/^.*= *//' | tr 'A-Z' 'a-z'
}

# Ganzzahl-Argument mit Korridor-Prüfung. Der Korridor ist der ADR-045-Beschluss in
# ausführbarer Form — eine Zahl ausserhalb ist keine Tippfehler-Frage, sondern eine
# Abweichung vom gezeichneten Beschluss und muss vor der Zeremonie geklärt werden.
# Führt einen openssl-Aufruf aus und bricht MIT dessen Fehlertext ab, wenn er scheitert.
#
# WARUM: `openssl ... 2>/dev/null` verschluckt bei einem Fehlschlag jede Diagnose; unter
# `set -e` endet das Skript dann mit Exit 1 und OHNE Ausgabe. In einer Zeremonie ist ein
# stiller Abbruch die schlechtestmögliche Fehlerform — der Operator sieht nur, dass nichts
# passiert ist. `2>&1 >/dev/null` leitet stderr auf das (aufgefangene) stdout um und wirft
# nur die openssl-Fortschrittsausgabe weg.
tl14_openssl() {
  local err
  if ! err="$(openssl "$@" 2>&1 >/dev/null)"; then
    tl14_die "openssl $1 fehlgeschlagen: ${err:-(openssl lieferte keinen Fehlertext)}"
  fi
  return 0
}

tl14_check_days() {
  local label="$1" value="$2" min="$3" max="$4"
  case "$value" in
    ''|*[!0-9]*) tl14_die "$label: '$value' ist keine positive Ganzzahl" ;;
    # Führende Null ⇒ Bash rechnet oktal. `0800` stürbe mit "value too great for base"
    # statt mit einer verständlichen Meldung; `0730` wäre stillschweigend 472.
    0?*) tl14_die "$label: '$value' hat eine führende Null — bitte ohne schreiben (sonst oktale Auswertung)" ;;
  esac
  if [ "$value" -lt "$min" ] || [ "$value" -gt "$max" ]; then
    tl14_die "$label: $value Tage liegt ausserhalb des ADR-045-Korridors ($min..$max Tage). Abweichung vom Owner-Beschluss — VOR der Zeremonie klären (docs/architecture/ADR-045-ca-two-stage-hierarchy.md §D3)."
  fi
}
