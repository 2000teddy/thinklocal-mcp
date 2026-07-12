// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * pinned-card-fetch.test.ts — ADR-035 A2/A4b: direkter Regressionstest des sicherheits-kritischen
 * Adapter-Seams (Codex-Review #261). Die Learner-/Boot-Re-Learn-Tests mocken `fetchCardPinned` und
 * beweisen nur Routing/fail-closed — NICHT, dass DIESER Adapter die Transport-Identitäts-Bindung
 * tatsächlich erzwingt. Hier wird `buildMeshConnector` gespiegelt (Spy), um die von
 * `fetchAgentCardPinned` übergebenen Connector-Argumente direkt zu prüfen:
 *   (1) `spiffeServerIdentity` wird für den Dial ERZWUNGEN — auch bei global-AUS D2b-Policy.
 *   (2) der installierte `checkServerIdentity` ist an `expectedSpiffeUri` gebunden → exakter SPIFFE-
 *       SAN akzeptiert, fremder/fehlender SAN verworfen (fail-closed vor Card-Annahme).
 * `makeMeshCheckServerIdentity`/`verifyMeshServerIdentity` bleiben REAL (nicht gemockt) → der
 * captured Checker enforced echt.
 */
import { describe, it, expect, vi } from 'vitest';

// Spy auf buildMeshConnector (vi.hoisted, da die vi.mock-Factory über die Imports gehoben wird).
// Stub-Connector: meldet sofort einen Connect-Fehler → das nachfolgende fetch scheitert schnell;
// wir prüfen ausschließlich die (synchron beim Agent-Bau erfassten) Connector-Argumente.
const { buildMeshConnectorSpy } = vi.hoisted(() => ({
  buildMeshConnectorSpy: vi.fn(() => (_opts: unknown, cb: (e: unknown) => void) => cb(new Error('stub-no-connect'))),
}));
vi.mock('./mesh-connect.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mesh-connect.js')>();
  return { ...actual, buildMeshConnector: buildMeshConnectorSpy };
});

import { fetchAgentCardPinned } from './pinned-card-fetch.js';

const EXPECTED = 'spiffe://thinklocal/node/12D3KooWCn86Frs2pqSkffVaoFsuHA7fByGZ7rULVqGcesk2RrJF';
const POLICY_OFF = { debug: false, disablePinning: false, spiffeServerIdentity: false } as const;
type Checker = (host: string, cert: { subjectaltname?: string }) => Error | undefined;

async function callAndCaptureConnectorArgs(endpoint: string, expected: string): Promise<{ policy: { spiffeServerIdentity?: boolean }; checker: Checker }> {
  buildMeshConnectorSpy.mockClear();
  await fetchAgentCardPinned(endpoint, expected, {
    tls: { ca: [], cert: 'CERT', key: 'KEY' },
    outboundConnectPolicy: { ...POLICY_OFF },
  }).catch(() => {}); // Stub-Connector → fetch wirft; egal, Args sind erfasst.
  expect(buildMeshConnectorSpy).toHaveBeenCalledTimes(1);
  const call = buildMeshConnectorSpy.mock.calls[0] as unknown as [unknown, { spiffeServerIdentity?: boolean }, unknown, Checker];
  return { policy: call[1], checker: call[3] };
}

describe('fetchAgentCardPinned — Adapter-Seam (INV-A2-1 / A4b, Codex #261)', () => {
  it('erzwingt spiffeServerIdentity:true auch bei global-AUS Policy (D2b-unabhängig)', async () => {
    const { policy } = await callAndCaptureConnectorArgs('https://10.10.10.55:9440', EXPECTED);
    expect(policy.spiffeServerIdentity).toBe(true);
  });

  it('installiert einen an expectedSpiffeUri gebundenen Checker: exakter SAN akzeptiert', async () => {
    const { checker } = await callAndCaptureConnectorArgs('https://10.10.10.55:9440', EXPECTED);
    expect(checker('10.10.10.55', { subjectaltname: `URI:${EXPECTED}` })).toBeUndefined();
  });

  it('SECURITY: fremder SPIFFE-SAN → Error (Handshake-Abbruch VOR Card-Annahme)', async () => {
    const { checker } = await callAndCaptureConnectorArgs('https://10.10.10.55:9440', EXPECTED);
    expect(checker('10.10.10.55', { subjectaltname: 'URI:spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d' })).toBeInstanceOf(Error);
  });

  it('SECURITY: kein SPIFFE-SAN (nur IP) / leerer SAN → Error', async () => {
    const { checker } = await callAndCaptureConnectorArgs('https://10.10.10.55:9440', EXPECTED);
    expect(checker('10.10.10.55', { subjectaltname: 'IP Address:10.10.10.55' })).toBeInstanceOf(Error);
    expect(checker('10.10.10.55', { subjectaltname: undefined })).toBeInstanceOf(Error);
  });

  it('SECURITY: poisoned-host — Checker ignoriert den (angeblichen) Host, pinnt hart auf expectedSpiffeUri', async () => {
    // Angreifer-Endpoint präsentiert ein gültiges thinklocal-Cert, aber NICHT das erwartete → verworfen.
    const { checker } = await callAndCaptureConnectorArgs('https://10.10.10.99:9440', EXPECTED);
    expect(checker('10.10.10.99', { subjectaltname: 'URI:spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d' })).toBeInstanceOf(Error);
    // dasselbe Cert wäre nur für seine EIGENE erwartete Identität gültig:
    const other = await callAndCaptureConnectorArgs('https://10.10.10.99:9440', 'spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d');
    expect(other.checker('10.10.10.99', { subjectaltname: 'URI:spiffe://thinklocal/node/12D3KooWFgnDgukhD5AxSHs3uNQC9kBVq9xHrY85kxYXD5EX6J5d' })).toBeUndefined();
  });
});
