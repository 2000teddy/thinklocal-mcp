# Re-PR #197 — `mcp-ingress.ts` gegen main

**[2026-06-24 07:05 CEST]**

## Problem
PR **#197** (`mcp-ingress.ts` — `/api/mcp`-Ingress-Handler-Logik) wurde 2026-06-23 13:53Z in den
Branch `agent/claude-code/adr-028-d2-forward-dispatch` gemergt. Dieser Branch war jedoch bereits
13:49Z (als **#195**) nach `main` gemergt → der Ingress-Code aus #197 propagierte **nie nach main**.

## Lösung
Cherry-pick des Original-Commits `374d6f72252c88790839aa793be483131a34e71a` auf einen **frischen
Branch ab `origin/main`**: `agent/claude-code/adr-028-d2-ingress-re-pr`. Kein Force, kein Overwrite.

- **Cherry-pick-Konflikt:** nur Doku (CHANGES + COMPLIANCE-TABLE); Code-Dateien
  (`mcp-ingress.ts`/`mcp-ingress.test.ts`) + ADR-028-D4-Notiz konfliktfrei. Doku-Konflikt per
  CONTRIBUTING-Autonomie gelöst (beide Versionseinträge behalten).
- **Tests:** `mcp-ingress.test.ts` 12/12 grün; daemon-unit-Suite 1152 grün; tsc 0.
- **Deploy-frei:** kein Net-Egress, kein Fastify-Route-Wiring in den Live-Server, kein mcporter-Exec,
  kein Re-Enroll, kein Deploy, kein Unimesh-Pfad.

## PR
- **Re-PR:** https://github.com/2000teddy/thinklocal-mcp/pull/199 (base=`main`)
- **Original:** https://github.com/2000teddy/thinklocal-mcp/pull/197 (gemergt in den #195-Branch, nicht main)
