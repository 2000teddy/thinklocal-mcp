// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * pinned-card-fetch.ts — ADR-035: EINE reviewte Server-Identity-gepinnte Agent-Card-Fetch.
 *
 * Holt `/.well-known/agent-card.json` über einen **dedizierten** mTLS-Dial, der die Server-Identität
 * HART auf `expectedSpiffeUri` pinnt — volle CA-Chain (`rejectUnauthorized`) PLUS ein exakter
 * SPIFFE-SAN-Match (`makeMeshCheckServerIdentity(() => expectedSpiffeUri)`, fail-closed). Das
 * `spiffeServerIdentity`-Pinning wird für DIESEN Dial erzwungen, UNABHÄNGIG vom global-default-AUS
 * ADR-028-D2b-Flag. Ein Endpoint, der nicht das Cert der erwarteten kanonischen PeerID hält, bricht
 * im Handshake ab → kann KEINE fremde Identität attestieren (schließt die A4b-Fehlerklasse aus).
 *
 * Genutzt von: A2/Boot-Re-Learn (`index.ts`, outbound) UND A4b/Inbound-Fallback
 * (`inbound-peer-learner.ts` via `index.ts`), wenn die Fetch-Adresse NICHT die authentifizierte
 * TLS-Source-IP ist. Der Body wird byte-begrenzt gelesen (`readCappedText`), der per-Dial-Agent im
 * `finally` geschlossen (kein Socket-Leak).
 */
import { Agent as UndiciAgent, fetch } from 'undici';
import type { Logger } from 'pino';
import { buildMeshConnector, type MeshTlsMaterial, type OutboundConnectPolicy } from './mesh-connect.js';
import { makeMeshCheckServerIdentity } from './mesh-server-identity.js';
import { readCappedText, MAX_CARD_BODY_BYTES } from './boot-relearn.js';

export interface PinnedCardFetchDeps {
  tls: MeshTlsMaterial;
  outboundConnectPolicy: OutboundConnectPolicy;
  timeoutMs?: number;
  log?: Logger;
}

/**
 * Holt + minimal-validiert die Agent-Card server-identity-gepinnt auf `expectedSpiffeUri`.
 * Rückgabe: `{spiffeUri, publicKey}` bei 2xx + gültigem Body; `null` bei !ok/leerem/zu großem Body.
 * Wirft bei Transport-Fehler / Pin-Mismatch-Handshake-Abbruch (Aufrufer behandelt als transient).
 */
export async function fetchAgentCardPinned(
  endpoint: string,
  expectedSpiffeUri: string,
  deps: PinnedCardFetchDeps,
): Promise<{ spiffeUri?: string; publicKey?: string } | null> {
  const pinnedAgent = new UndiciAgent({
    connect: buildMeshConnector(
      deps.tls,
      { ...deps.outboundConnectPolicy, spiffeServerIdentity: true },
      deps.log,
      makeMeshCheckServerIdentity(() => expectedSpiffeUri),
    ),
  });
  try {
    const res = await fetch(`${endpoint}/.well-known/agent-card.json`, {
      signal: AbortSignal.timeout(deps.timeoutMs ?? 5_000),
      dispatcher: pinnedAgent,
    });
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    // Byte-begrenzt lesen (Timeout begrenzt nur die Zeit, nicht die Größe).
    const text = await readCappedText(res.body, MAX_CARD_BODY_BYTES);
    if (text === null) {
      deps.log?.warn({ endpoint, expectedSpiffeUri }, '[discovery] pinned-card-fetch: Card-Body zu groß — verworfen');
      return null;
    }
    const card = JSON.parse(text) as { spiffeUri?: string; publicKey?: string };
    return { spiffeUri: card.spiffeUri, publicKey: card.publicKey };
  } finally {
    await pinnedAgent.close().catch(() => {});
  }
}
