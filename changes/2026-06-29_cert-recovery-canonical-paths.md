# 2026-06-29 — Cert Recovery Canonical Paths (KW27)

## Slice

Migrated the remaining operator/startup recovery helpers from legacy cert and
pairing paths to the canonical runtime paths proven by the PR #208 follow-up.

Chosen path: migrate, not remove. `runRecoveryChecks()` is a real startup
helper, and `rotateCert()`/`trustReset()` are exported operator helpers, so the
smallest safe fix is to make them operate on current state rather than reporting
success against obsolete files.

## Evidence

Canonical runtime files:

- TLS leaf/key: `dataDir/tls/node.crt.pem`, `dataDir/tls/node.key.pem`
- Pairing store: `dataDir/pairing/paired-peers.json`

Updated behavior:

- `rotateCert()` deletes canonical TLS node cert material.
- `trustReset()` deletes canonical TLS node cert material and
  `pairing/paired-peers.json`; legacy `pairing-store.json` is not treated as
  current state.
- `runRecoveryChecks()` cert-expiry recovery deletes canonical TLS node cert
  material so the next TLS init can reissue it.
- `auditCerts()` audits current `tls/*.crt.pem` cert files.

## Tests

Passed:

```text
cd packages/daemon && npx vitest run src/cert-rotation.test.ts src/recovery.test.ts
# 2 files, 4 tests passed

npm run daemon:build
# passed
```

Attempted broader suite:

```text
npm run test:unit
```

Blocked by local native module ABI mismatch, unrelated to this slice:

```text
better-sqlite3.node was compiled against NODE_MODULE_VERSION 127;
current Node.js requires NODE_MODULE_VERSION 115
```

## Review

`codex review --uncommitted` completed with no actionable correctness issues:

```text
No actionable correctness issues were identified in the changed files. The path
migrations and added tests appear consistent with the canonical TLS and pairing
locations.
```
