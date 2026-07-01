# Cleanup — tote Legacy-Module `cert-rotation.ts` + `policy.ts` hart entfernen

**Datum:** 2026-07-01
**Branch:** `claude/remove-dead-legacy-modules`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Cleanup (Hard-Remove) — kein Verhaltens-Change am Laufzeitpfad, kein Deploy
**Bezug:** Abschluss der Deprecation-Slices #221 (`cert-rotation.ts`) / #222 (`policy.ts`)

## Problem

Beide Module waren bereits als `@deprecated LEGACY` markiert (0 Produktions-Importeure).
Read-first auf `main @ 91a3b8b` erneut verifiziert: **weiterhin 0 Produktions-Importeure**
(daemon/cli) — die einzigen Referenzen waren die eigenen Tests + der Namens-Scan in
`cert-rotation-recheck.test.ts`. Tote Legacy-Dateien mitzuschleppen ist Wartungslast und
lädt zu Verwechslung mit dem scharfen Pfad ein.

## Lösung (kleinster korrekter Hard-Remove)

**Entfernt:**
- `packages/daemon/src/cert-rotation.ts` (rotateCert/needsRotation/auditCerts/trustReset),
- `packages/daemon/src/cert-rotation.test.ts` (isolierter Verhaltens-Test des entfernten Moduls),
- `packages/daemon/src/policy.ts` (`PolicyEngine` + Policy-Typen),
- `packages/daemon/src/policy.test.ts` (importierte `PolicyEngine`).

**Angepasst (nur obsoletes Bookkeeping):**
- `cert-rotation-recheck.test.ts`: **RE-CHECK A** (kanonischer Reissue-Pfad via `tls.ts
  loadOrCreateTlsBundle`, unabhängig vom entfernten Modul) **bleibt** — wertvoller
  Regression-Schutz. **RE-CHECK B** von „totes Modul + @deprecated-Guard" zu einem
  **Removal-Guard** umgeschrieben: (1) `cert-rotation.ts` existiert nicht mehr, (2) kein
  Produktions-Source importiert ein `cert-rotation`-Modul (verhindert Wiederbelebung).
- `TODO.md`: §3.4 (Policy) + Security-Lifecycle-Zeile auf „HART ENTFERNT" aktualisiert.

**NICHT angetastet** (realer Laufzeitpfad): `tls.ts` (`loadOrCreateTlsBundle` = Erneuerung),
`cert-expiry-monitor.ts` (Live-Alert T2.1), `crl.ts`, mTLS/Trust, `isApprovedPeerSender`
(ADR-026), Vault-Approval-Flow. `discovery-policy.ts` (ADR-019, ein **anderes** lebendes Modul)
ist nicht betroffen.

## Beleg / Tests

- `tsc --noEmit`: **0** — keine verwaisten Importe (bestätigt: nichts Produktives referenzierte
  die entfernten Module).
- Volle Suite **106 → 106 Files / 1281 grün** (−18 Tests = genau die gelöschten
  `policy.test.ts` (13) + `cert-rotation.test.ts` (5); keine anderen Tests betroffen).
- `cert-rotation-recheck.test.ts` **5/5 grün** (RE-CHECK A 3 + Removal-Guard 2).
- Empirisch guard-bewiesen: `cert-rotation.ts`-Stub wieder angelegt ⇒ Removal-Guard rot,
  entfernt ⇒ grün.

## Review

Unabhängiger **Claude**-Subagent (s. PR-Body). (`agy`-Backend im Env nicht installiert →
Claude-Subagent als echtes Review — kein MiniMax/pal:chat.)

## Scope / Folge

Genau ein Repo-Slice (Hard-Remove der zwei toten Module + Bookkeeping). Kein Deploy, kein
Laufzeit-Change. Ein künftiger AUTHZ-Policy-Layer bzw. proaktiver Cert-Reissue braucht ein
eigenes ADR (nicht das entfernte Legacy wiederbeleben).
