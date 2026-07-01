# Lint-Cleanup — `require()` → ESM-`import` in deprecateten Legacy-Modulen

**Datum:** 2026-06-30
**Branch:** `claude/require-to-import-lint`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Lint-Quality (kein Verhaltens-Change) — kein Deploy
**Bezug:** Folge zu den Deprecation-Slices #221 (`cert-rotation.ts`) / #222 (`policy.ts`)

## Problem

Drei `@typescript-eslint/no-require-imports`-Errors (Baseline seit 2026-04-05) in den jetzt
als Legacy markierten Modulen: das Paket ist `"type": "module"` (ESM), nutzte aber
CommonJS-`require()`:
- `cert-rotation.ts:168` — `const forge = require('node-forge')` (in `auditCerts`, in einer Schleife).
- `policy.ts:206` — `const { createHash } = require('node:crypto')` (in `getVersion`).
- `policy.ts:247` — `const { writeFileSync } = require('node:fs')` (in `save`).

## Lösung

Auf den repo-weiten ESM-Standard umgestellt (Top-Level-Imports):
- **`cert-rotation.ts`**: `import forge from 'node-forge';` (wie `tls.ts`/`cert-issuer.ts`),
  inline-`require` entfernt.
- **`policy.ts`**: `import { createHash } from 'node:crypto';` + `writeFileSync` zum bestehenden
  `node:fs`-Import ergänzt; beide inline-`require` entfernt.

**Verhaltens-identisch** (reine Import-Mechanik). `node-forge` ist harte Runtime-Dependency
(`package.json` `^1.4.0`) → eager Top-Level-Import ist sicher; `esModuleInterop` macht den
`export =`-Default-Import korrekt. CR-bestätigt: keine geänderten Error-Handling-Semantik.

## Beleg

- eslint auf beiden Dateien: **3 Errors → 0** (direkter Datei-Level-Nachweis).
- tsc `--noEmit`: 0. Volle Suite **106 Files / 1299 grün**.

## Tests

- **`policy.test.ts`** (+2): `getVersion` (deterministischer 16-Hex-Hash, ändert sich bei
  Policy-Änderung → deckt den konvertierten `createHash`-Pfad) + `save` (schreibt nur
  Custom-Policies nach `policies.json` → deckt den konvertierten `writeFileSync`-Pfad).
  Schließt den CR-NIT „getVersion/save ungetestet".
- `cert-rotation.test.ts` (`auditCerts`, nutzt `forge`) bleibt grün — übt den konvertierten
  `forge`-Pfad direkt aus.

## Review

Unabhängiger **Claude**-Subagent: **APPROVE**, 0× HIGH/CRITICAL/MEDIUM. Semantische Äquivalenz
bestätigt (default-/named-Imports korrekt), kein Verhaltens-Change, kein Leftover-`require`,
node-forge harte Dependency (eager Import sicher). CR-NIT (getVersion/save untested) **adressiert**.
(`agy`-Backend im Env nicht installiert → Claude-Subagent als echtes Review — kein MiniMax/pal:chat.)

## Scope

Beide Module bleiben @deprecated (diese Slice ändert nichts an der Deprecation, nur die
Import-Mechanik). Kein Deploy.
