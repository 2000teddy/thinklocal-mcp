# CA-verankerter host/→node/-Pairing-Re-Key (TL-00, KW28)

**Datum:** 2026-07-07 · **Branch:** `claude/kw28-pairing-canonicalize` (base=main) · **Typ:** Daemon-Tool + Runbook (kein Auto-Run).
**Quelle:** TH01-Orchestrator-Dispatch (KW28, .52 Di→Mi-Fenster vorbereiten). Bleibt auf `spiffe://thinklocal/…` (Entscheidung 7 → Domain-Flip erst KW30).

## Der Gap (verifiziert)

Re-enrollte Peers (.52/.55) announcen ihre kanonische `node/<PeerID>`-Identität (token-onboarded, Cert
unter der geteilten Mesh-CA 69bc…). TH01s `paired-peers.json` führt sie aber noch als Legacy `host/<id>`
(pubkey/fingerprint leer, `caCertPem` gesetzt). Der Outbound-AGENT_MESSAGE-ACL (`inbox-api.ts:265`) prüft
`isPaired(<node/…>)` — URI-gekeyt → Legacy-Eintrag matcht nicht → **403 „peer not paired"**. Live bestätigt.
Bewiesen: .52s live node-Cert verifiziert `OK` unter TH01s gespeichertem `caCertPem` (Trust-Anker intakt).

## Lösung (Pfad C, Code + Runbook)

- **`pairing-canonicalize.ts` (rein, getestet):** `canonicalizePairedPeer(entry, nodeCertPem, expectedCanonicalUri)`.
  **Zwei Bindungen** — die Mesh nutzt eine GETEILTE CA, daher reicht CA-Verify NICHT allein: (1) Cert
  verifiziert unter dem gespeicherten `caCertPem`; (2) node/-SAN == `expectedCanonicalUri` (Anti-Substitution).
  Re-keyt nur `agentId`. Fail-closed.
- **`scripts/canonicalize-pairings.ts` (Runner):** genau EIN Eintrag (`--peer`+`--address`+`--expect-uri`
  Pflicht), Leaf-Cert per TLS, Adress-SAN-Bindung, atomarer Write + Backup, `--dry-run`.
- **`docs/REENROLL-52-RUNBOOK.md`:** ausführbares Fenster-Runbook.

## Tests

`pairing-canonicalize.test.ts` (9): Happy-Re-Key, Anti-Substitution (A-Eintrag+B-Cert unter geteiltem CA
→ `canon-uri-mismatch`), Anker-Gate (fremde CA), invalid-expected-uri, already-canonical, no-trust-anchor,
no-canonical-san, multiple-node-sans, unlesbares Cert. Full Suite **1459 grün**, tsc 0, eslint 0.

## Review

Claude adversarial: Erst-Review **REQUEST-CHANGES** (CRITICAL Identitäts-Substitution via geteilte CA;
CRITICAL Runner-Sammel-Apply; HIGH RSA/ECDSA-Key-Verwechslung) → alle gefixt → Re-Review **APPROVE**.

## Grenzen

Kein Auto-Run, kein Deploy, kein Domain-Flip, keine SPAKE2-Zeremonie nötig. Ausführung Operator-gesteuert
im Di→Mi-Fenster (Runbook). Kein neues Christian-Gate (Gate 2 deckt es).
