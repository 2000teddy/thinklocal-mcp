# Cleanup — `cert-rotation.ts` als @deprecated/Legacy markieren

**Datum:** 2026-06-30
**Branch:** `claude/cert-rotation-deprecate`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Cleanup/Doku (Deprecation) — keine Verhaltensänderung, kein Deploy
**Bezug:** Cert-RE-CHECK-Verdikt `changes/2026-06-29_cert-rotation-recheck-verdict.md` (Folge-Aufräum-Slice)

## Problem

`cert-rotation.ts` (`rotateCert`/`needsRotation`/`auditCerts`/`trustReset`) ist **totes
Modul**: **0 Produktions-Importeure** (daemon/cli), festgenagelt durch
`cert-rotation-recheck.test.ts` (RE-CHECK B). Sein Header behauptete aber „kann als
periodischer Check im Daemon-Lifecycle laufen" — das war nie verdrahtet und liest sich
wie der scharfe Pfad. Genau diese Verwechslung hat den RE-CHECK ausgelöst.

## Lösung (markieren, nicht löschen)

- **`cert-rotation.ts`**: irreführenden Header durch einen prominenten `@deprecated`-Block
  ersetzt, der den **kanonischen** Pfad benennt:
  - Erneuerung/Rotation = `tls.ts loadOrCreateTlsBundle()` (Reissue beim Start, `daysLeft <= 7`),
  - Live-Ablauf-Alert = `cert-expiry-monitor.ts` (T2.1, #213, periodisch + Telegram-Sink),
  - Pairing/Trust = `pairing.ts` (`PairingStore`).
  Jeder Export trägt zusätzlich ein `@deprecated`-Tag. **Keine Logik-/Verhaltensänderung** —
  nur Kommentare/JSDoc (Review-bestätigt: 0 ausführbare Zeilen geändert).
- **Warum nicht löschen:** `trustReset`/`auditCerts` sind getestete, in sich geschlossene
  Sicherheits-Utilities (Trust-Reset ist eine legitime Recovery-Operation), nur unverdrahtet.
  Sie bleiben als **manuell aufrufbare** Legacy-Utilities erhalten — mit der Guardrail
  „nicht neu verdrahten ohne ADR"; Entfernen kann ein Folge-Slice sein. Der Dispatch ließ
  „markieren ODER entfernen" offen; markieren ist die reversible, risikoarme Wahl.

## Tests / Doku

- **`cert-rotation-recheck.test.ts`** (+1): Guard — solange das Modul tot ist, MUSS die
  `@deprecated`-Markierung + die Verweise auf `loadOrCreateTlsBundle`/`cert-expiry-monitor`
  bleiben (sonst liest sich tote Altverdrahtung wieder wie der scharfe Pfad). Token-basiert,
  nicht prosa-überfittet.
- **`cert-rotation.test.ts`**: Header-Notiz — testet bewusst @deprecated Legacy-Utilities;
  Laufzeit-Pfad ist `loadOrCreateTlsBundle` + `cert-expiry-monitor`.
- **`TODO.md`** Z407: Deprecation-Status nachgezogen.

Volle Suite **106 Files / 1295 grün**, tsc 0. Empirisch guard-bewiesen: `@deprecated`-Marker
entfernt ⇒ Guard-Test rot, restauriert ⇒ grün. (Vorbestehender `require('node-forge')`-eslint-Error
in `auditCerts` Z168 ist **nicht** Teil dieses Slices — Baseline seit 2026-04-05.)

## Review

Unabhängiger **Claude**-Subagent: **APPROVE**, 0× HIGH/CRITICAL/MEDIUM/LOW. Deprecation
verifiziert akkurat (0 Importeure, kanonische Pfade live-verdrahtet, keine Logik-Änderung);
`@deprecated` bricht den Build nicht (keine `no-deprecated`-eslint-Regel). 2 kosmetische NITs.
(`agy`-Backend im Env nicht installiert → Claude-Subagent als echtes Review — kein MiniMax/pal:chat.)

## Folge / offen

- Optionales hartes Entfernen von `cert-rotation.ts` + Test (statt deprecaten) — separater Slice.
- Vorbestehender `require()`→`import`-Fix in `auditCerts` (Baseline-eslint) — eigener Lint-Slice.
- Kein Deploy.
