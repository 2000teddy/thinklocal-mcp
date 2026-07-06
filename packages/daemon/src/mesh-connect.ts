// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * mesh-connect.ts — Outbound-Mesh-Connect: Debug-Instrumentierung + Escape-Hatch
 *
 * Hintergrund (Phase-3-Restbug, dual-homed macOS-Node .55): der ausgehende mTLS-
 * Connect zu Peers scheitert dort mit EHOSTUNREACH (Source 10.10.10.55), obwohl
 * `nc`/`ping` zur selben Peer-IP funktionieren. Der HTTP-Dispatcher setzt selbst
 * KEIN `localAddress` (das mDNS-Interface-Pinning aus ADR-019 betrifft nur den
 * Multicast-Socket, nicht diesen Pfad) — „Local (…)" im Fehler ist die OS-gewählte
 * Source-IP. Dieses Modul liefert:
 *   1. TLMCP_DEBUG_CONNECT=1  → loggt die EXAKTEN Connect-Parameter + den vollständigen
 *      Socket-Fehlercode pro Outbound-Connect (damit sichtbar wird, was anders ist als nc).
 *   2. TLMCP_DISABLE_OUTBOUND_PINNING=1 → baut den Connector OHNE Source-Bind und mit
 *      `autoSelectFamily=false` (kein Happy-Eyeballs/Family-Auto-Select) → sauberer
 *      Default-Source-Connect wie `nc` ohne `-s`. Reversibel, opt-in, Default = altes Verhalten.
 */
import { buildConnector } from 'undici';
import type { Logger } from 'pino';
import { type PeerCertLike } from './mesh-server-identity.js';

export interface OutboundConnectPolicy {
  /** TLMCP_DEBUG_CONNECT=1 → exakte Connect-Parameter + Socket-Fehler loggen. */
  debug: boolean;
  /** TLMCP_DISABLE_OUTBOUND_PINNING=1 → kein Source-Bind, kein Family-Auto-Select. */
  disablePinning: boolean;
  /**
   * TLMCP_SPIFFE_SERVER_IDENTITY=1 (ADR-028 D2b) → ersetzt den IP-altname-Check durch
   * SPIFFE-URI-SAN-Validierung (`mesh-server-identity.ts`), damit Overlay/Cross-Subnet-
   * Dials (Tailscale 100.x) ohne per-IP-Cert-Reissue funktionieren. Default OFF → Node-
   * Default-altname-Check (= bisheriges Verhalten). `rejectUnauthorized` bleibt true.
   */
  spiffeServerIdentity: boolean;
}

/** Liest die Outbound-Connect-Policy aus den Env-Variablen (rein, testbar). */
export function resolveOutboundConnectPolicy(env: NodeJS.ProcessEnv): OutboundConnectPolicy {
  return {
    debug: env['TLMCP_DEBUG_CONNECT'] === '1',
    disablePinning: env['TLMCP_DISABLE_OUTBOUND_PINNING'] === '1',
    spiffeServerIdentity: env['TLMCP_SPIFFE_SERVER_IDENTITY'] === '1',
  };
}

export interface MeshTlsMaterial {
  ca: string | string[];
  cert: string;
  key: string;
}

/** Getypte undici-Connect-Optionen (CR-LOW: kein freier Record → keine Tippfehler bei sicherheitsrelevanten Keys). */
export interface ConnectorOptions {
  ca: string | string[];
  cert: string;
  key: string;
  /** mTLS-Verifikation — IMMER true, nie geschwächt. */
  rejectUnauthorized: true;
  /** Nur bei disablePinning gesetzt: Happy-Eyeballs/Family-Auto-Select aus. */
  autoSelectFamily?: boolean;
  /**
   * Nur bei spiffeServerIdentity gesetzt (ADR-028 D2b): ersetzt den altname-Abgleich
   * durch SPIFFE-URI-SAN-Validierung. Läuft NUR nach erfolgreicher CA-Chain-Prüfung
   * (rejectUnauthorized:true) → lockert die Chain nicht, nur den Adress-Abgleich.
   */
  checkServerIdentity?: (host: string, cert: PeerCertLike) => Error | undefined;
}

/**
 * Baut die undici-`connect`-Optionen aus TLS-Material + Policy (rein, testbar).
 * `disablePinning` setzt `autoSelectFamily=false` und lässt `localAddress` bewusst
 * UNGESETZT (Default-Source). `spiffeServerIdentity` setzt den SPIFFE-URI-SAN-Verifier
 * als `checkServerIdentity`. Sonst nur die TLS-Optionen (= bisheriges Verhalten).
 */
export function buildConnectorOptions(
  tls: MeshTlsMaterial,
  policy: OutboundConnectPolicy,
  meshCheckServerIdentity?: (host: string, cert: PeerCertLike) => Error | undefined,
): ConnectorOptions {
  const opts: ConnectorOptions = {
    ca: tls.ca,
    cert: tls.cert,
    key: tls.key,
    rejectUnauthorized: true,
  };
  if (policy.disablePinning) {
    // Happy-Eyeballs / Family-Auto-Select aus → ein direkter Default-Source-Connect.
    opts.autoSelectFamily = false;
    // localAddress bewusst NICHT gesetzt (kein Source-Bind).
  }
  if (policy.spiffeServerIdentity) {
    // ADR-028 D2b-pin (CR-MEDIUM gpt-5.3-codex): der per-Host-pinnende Verifier MUSS
    // injiziert sein — KEIN stiller Fallback auf ungepinntes TOFU (Downgrade-Schutz).
    // Eine fehlende Injektion bei aktivem Flag ist ein Verdrahtungsfehler → fail-fast.
    if (!meshCheckServerIdentity) {
      throw new Error(
        'mesh-connect: spiffeServerIdentity aktiv, aber kein checkServerIdentity injiziert ' +
          '(ADR-028 D2b-pin erzwingt den pinnenden Verifier — kein stiller TOFU-Fallback)',
      );
    }
    opts.checkServerIdentity = meshCheckServerIdentity;
  }
  return opts;
}

/** Lose Connector-Signatur (undici-kompatibel) für den Debug-Wrapper + Test-Injektion. */
export type LooseConnector = (options: unknown, callback: (err: unknown, socket?: unknown) => void) => void;

/**
 * Umhüllt einen Connector mit Debug-Logging (rein, testbar — `base` injizierbar).
 * Ruft `base` genau einmal auf und reicht (err, socket) IMMER an den Aufrufer-Callback
 * weiter (kein Schlucken/Verändern); loggt vor dem Connect die Parameter und im Callback
 * Erfolg bzw. den vollständigen Socket-Fehler.
 */
export function wrapConnectorWithDebug(base: LooseConnector, connectorOpts: ConnectorOptions, log?: Logger): LooseConnector {
  return (options, callback) => {
    const o = options as { hostname?: string; host?: string; port?: number | string; servername?: string };
    log?.info(
      {
        host: o.hostname ?? o.host,
        port: o.port,
        servername: o.servername,
        autoSelectFamily: connectorOpts.autoSelectFamily ?? 'default',
        localAddress: null,
      },
      '[connect] outbound peer connect (TLMCP_DEBUG_CONNECT)',
    );
    base(options, (err, socket) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { address?: string; port?: number; localAddress?: string };
        log?.error(
          { code: e.code, errno: e.errno, syscall: e.syscall, address: e.address, port: e.port, localAddress: e.localAddress, message: e.message },
          '[connect] outbound FEHLER (vollständiger Socket-Fehler)',
        );
      } else if (socket) {
        const s = socket as { localAddress?: string; localPort?: number; remoteAddress?: string; remoteFamily?: string };
        log?.info(
          { localAddress: s.localAddress, localPort: s.localPort, remoteAddress: s.remoteAddress, family: s.remoteFamily },
          '[connect] outbound OK',
        );
      }
      callback(err, socket);
    });
  };
}

/**
 * Liefert eine undici-`connect`-Option (Connector-Funktion): die TLS-Connector-Basis,
 * bei `debug` umhüllt mit Logging der Connect-Parameter und des vollständigen Fehlers.
 */
export function buildMeshConnector(
  tls: MeshTlsMaterial,
  policy: OutboundConnectPolicy,
  log?: Logger,
  meshCheckServerIdentity?: (host: string, cert: PeerCertLike) => Error | undefined,
) {
  const connectorOpts = buildConnectorOptions(tls, policy, meshCheckServerIdentity);
  const base = buildConnector(connectorOpts as Parameters<typeof buildConnector>[0]);
  if (!policy.debug) return base;
  // Debug-Wrapper: signatur-identischer Passthrough (siehe wrapConnectorWithDebug), Cast
  // auf den undici-Connector-Typ, da der Wrapper denselben Vertrag erfüllt.
  return wrapConnectorWithDebug(base as unknown as LooseConnector, connectorOpts, log) as unknown as typeof base;
}
