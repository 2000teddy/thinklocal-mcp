# Cleanup — `policy.ts`/`PolicyEngine` als @deprecated/Legacy markieren

**Datum:** 2026-06-30
**Branch:** `claude/policy-engine-deprecate`
**Owner:** Claude (ThinkLocal-Lane)
**Typ:** Cleanup/Doku (Deprecation) — keine Verhaltensänderung, kein Deploy
**Bezug:** dasselbe risikoarme Muster wie `cert-rotation.ts`-Deprecation (#221); T2.4-Notiz „PolicyEngine ist ungenutztes totes Modul"

## Problem

`policy.ts` (`PolicyEngine` + Policy-Typen) ist **totes Modul**: **0 Produktions-Importeure**
(daemon/cli) — einziger Importeur ist `policy.test.ts`. Der Header behauptete aber, Policies
würden „zur Laufzeit evaluiert" — das wurde nie an den Request-Pfad angeschlossen
(Phase-1-Entwurf). `discovery-policy.ts` ist ein **anderes**, lebendes Modul (nicht betroffen).

## Lösung (markieren, nicht löschen)

- **`policy.ts`**: irreführenden Header durch einen prominenten `@deprecated`-Block ersetzt,
  der den **real verdrahteten** Autorisierungs-Pfad benennt:
  - **mTLS + Trust-Store** (Zero-Trust: nur gepairte/CA-validierte Peers),
  - **`isApprovedPeerSender`** (ADR-026 AUTHZ-Gate, `mesh.ts`→`index.ts`: Mesh-State/SKILL_ANNOUNCE/Tasks),
  - **Vault-Approval-Flow** (`vault.createApprovalRequest`/`approveRequest`, `index.ts`: Human-Approval für Credential-Sharing),
  - **place-or-refuse** (`task-executor.ts`/T2.4: Kapazität, kein AUTHZ).
  Korrektur aus dem CR (CR-HIGH): `approval-gates.ts` ist **ebenfalls unverdrahtetes Legacy** und
  wird NICHT als kanonisch zitiert. Zusätzlich `@deprecated`-Tag auf der `PolicyEngine`-Klasse.
  **Keine Logik-/Verhaltensänderung** — ausschließlich Kommentare/JSDoc (0 ausführbare Zeilen, git-diff-belegt).
- **Warum nicht löschen:** Die Engine ist ein testbarer, in sich geschlossener Entwurf
  (signierte Policy-Verteilung „Phase 2"); unverdrahtet, aber als Basis für ein späteres ADR
  brauchbar. Markieren ist die reversible, risikoarme Wahl — hartes Entfernen = Folge-Slice.

## Tests / Doku

- **`policy.test.ts`**: Header-Notiz (testet @deprecated Legacy) + 2 Guard-Tests:
  (1) **0 Produktions-Importeure** (scannt daemon/cli; schließt das lebende `discovery-policy.ts`
  bewusst aus), (2) Modul **bleibt `@deprecated`-markiert** + verweist auf `approval-gates`/
  `isApprovedPeerSender` (sonst liest sich tote Altverdrahtung wieder wie der scharfe Pfad).
- **`TODO.md`** §3.4: Deprecation-Status nachgezogen.

Volle Suite **106 Files / 1297 grün**, tsc 0. Empirisch guard-bewiesen: `@deprecated`-Marker
entfernt ⇒ Guard-Test rot, restauriert ⇒ grün. (Vorbestehende `require()`-eslint-Errors in
`policy.ts` Z206/247 sind Baseline seit 2026-04-05 — **nicht** Teil dieses Slices, git-blame-belegt.)

## Review

Unabhängiger **Claude**-Subagent: APPROVE mit **CR-HIGH** (Doku-Genauigkeit) — der erste Entwurf
zitierte `approval-gates.ts` als kanonisch durchsetzend, obwohl es **selbst unverdrahtet** ist.
**Gefixt:** in `policy.ts` (Header + Klassen-Tag), `policy.test.ts` (Header + Guard prüft jetzt
`isApprovedPeerSender` + `createApprovalRequest` statt `approval-gates`), changes/CHANGES/TODO.
Mechanik bestätigt sauber: comment-only (0 ausführbare Zeilen), 0 Produktions-Importeure,
`isApprovedPeerSender` real verdrahtet (`mesh.ts:357`→`index.ts:618`), `@deprecated` bricht den
Build nicht. (`agy`-Backend im Env nicht installiert → Claude-Subagent als echtes Review — kein
MiniMax/pal:chat.)

## Folge / offen

- Optionales hartes Entfernen von `policy.ts` + Test (statt deprecaten) — separater Slice.
- Bei echtem Bedarf: PolicyEngine über ein ADR an den Request-Pfad anschließen (Phase-2-AUTHZ).
- Kein Deploy.
