/**
 * produce-genesis-blob.mjs — ADR-020 v1.0 Production-Genesis-Blob
 *
 * Erzeugt EINEN gueltigen `REGISTRY_GENESIS_BLOB_BASE64` fuer
 * `packages/daemon/src/registry.ts`.
 *
 * Wichtige Erkenntnis (verifiziert 2026-05-19, Automerge 2.x):
 * - Weder `Automerge.save()` noch `Automerge.getHeads()` sind zwischen
 *   Process-Runs deterministisch — selbst mit fixer Actor-ID.
 *   Automerge nutzt intern eine zufaellige Initial-Hash-Komponente.
 * - DAS IST OK fuer ADR-020 v1.0: alle Daemons starten aus dem Blob-
 *   String in registry.ts (Code-as-Truth). Sie laden denselben Blob,
 *   landen damit im selben Doc-State, und Sync funktioniert.
 *
 * Konsequenz:
 * 1. Der Blob in registry.ts ist EIN beliebiger gueltiger Save eines
 *    Doc mit `{ capabilities: {}, last_sync: {} }`. Audit-Pruefung
 *    laeuft als Schema-Check (capabilities + last_sync Felder existieren,
 *    beide leer) — NICHT als Byte- oder Heads-Vergleich.
 * 2. Das Skript hier ist nuetzlich um einen frischen gueltigen Blob zu
 *    produzieren, falls der existierende mal aus irgendeinem Grund
 *    neu erzeugt werden muss. Der NEUE Blob ist semantisch aequivalent
 *    aber bit-different.
 *
 * AENDERUNGS-VERBOT (operationell): solange ein Mesh online ist, darf
 * der Blob in registry.ts NICHT geaendert werden. Aenderung wuerde
 * bedeuten: neugestartete Daemons landen in einem anderen History-Tree
 * als der Rest und koennen nicht mehr syncen. Bei einem
 * Schema-Change-Bedarf: koordinierter Re-Deploy aller Nodes.
 *
 * Aufruf:
 *   cd packages/daemon
 *   node scripts/produce-genesis-blob.mjs
 *
 * Output: ein einziger Base64-String auf stdout (kein Trailing-Newline).
 */
import * as Automerge from '@automerge/automerge';

// Actor-ID ist semantisch egal (siehe Erkenntnis oben), aber wir setzen
// sie auf "all-zero" damit Audit-Logs einen lesbaren Pseudo-Identifier
// haben statt einer Zufalls-Hex-Sequenz.
const GENESIS_ACTOR_ID = '0000000000000000000000000000000000000000';

const doc = Automerge.from(
  { capabilities: {}, last_sync: {} },
  { actor: GENESIS_ACTOR_ID },
);
const blob = Automerge.save(doc);
const b64 = Buffer.from(blob).toString('base64');
process.stdout.write(b64);
