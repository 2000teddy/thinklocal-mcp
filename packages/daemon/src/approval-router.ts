// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * approval-router.ts — TL-10 Slice-B-Prep: die reine Kompositions-Primitive
 * „Matrix-Eintrag → `channelId` → `requestApprovalOn`" (KEINE Verdrahtung).
 *
 * Beide Hälften liegen bereits gemergt vor, aber unverbunden:
 *  - Matrix-Seite: `freigabe-matrix.ts` `resolveEntry` + `isRoutable` (Slice A, PR #300) — rein.
 *  - Registry-Seite: `MeldekanalRegistry.requestApprovalOn(channelId, req)` (D2-Prep, PR #317) — fragt
 *    **gezielt** den adressierten Kanal statt „erster gesunder".
 * Diese Datei ist das fehlende Bindeglied — genau die Aktivierungs-Vorbedingung 2 aus SECURITY.md
 * „Freigabe-Matrix (TL-10)" („die Kanalauswahl wird auf den **Matrix-Kanal** beschränkt").
 *
 * **Fail-closed-Vertrag (die eiserne Regel dieses Moduls):**
 *  - Nicht routable (kein Match / leere Matrix / nicht wohlgeformtes Ziel, D5) ⇒ `denied-no-channel`,
 *    und es wird **NIEMALS ein Kanal gefragt**.
 *  - Routable ⇒ **ausschließlich** `requestApprovalOn(target.channel, …)`. Es gibt **keinen** Fallback auf
 *    `requestApproval()` („erster gesunder Kanal") — genau diese Auswahl soll die Matrix ja ersetzen.
 *    Der Router nimmt dafür bewusst nur die schmale {@link ChannelBoundApprover}-Sicht entgegen, in der
 *    die Fallback-Methode gar nicht existiert (Fail-closed per Typ, nicht per Disziplin).
 *  - Wurf oder unbekanntes Decision-Shape des Approvers ⇒ `error` (via `normalizeDecision`, dieselbe
 *    Mechanik wie in der Registry — kein Nachbau). Der Router wirft **nie**.
 *  - `isApproved()` bleibt der EINZIGE Auswertungspfad; dieses Modul interpretiert kein `outcome`.
 *
 * **`decider` wird NICHT durchgesetzt** (v1 rein deklarativ, SECURITY.md „⚠️ Kernaussage" + §5-CO D3):
 * der Router reicht das aufgelöste Ziel inkl. `decider` nur für Audit/Anzeige durch. Insbesondere macht
 * `decider: consensus:quorum=N` einen Eintrag **nicht** mehrstimmig — im Ingress bleibt der `consensus`-
 * *Tier* ein hartes 403, und ein Consensus-*Decider* wird hier weder erzwungen noch abgelehnt. Ob Slice B
 * das verschärfen soll, ist eine **CO-Frage**, keine Entscheidung dieses Prep-Slices.
 *
 * BEWUSST AUSSER SCOPE (bleibt Slice B / owner-gated): TOML-Loader für `config/freigabe-matrix.toml` (D1),
 * Verdrahtung am `resolveApproval`-Seam (`mcp-ingress.ts`), Env-Flag-Regime, D3-Christian-Sign-off,
 * Aktivierung. Dieses Modul hat **0 Aufrufer** — kein Runtime-Change.
 */
import {
  isRoutable,
  resolveEntry,
  type FreigabeMatrix,
  type MatrixTarget,
  type ResolveContext,
} from './freigabe-matrix.js';
import { normalizeDecision, type ApprovalDecision, type ApprovalRequest } from './meldekanal.js';

/**
 * Die **schmale** Registry-Sicht, die der Router braucht: nur die kanalgebundene Anfrage.
 * `MeldekanalRegistry` erfüllt sie strukturell. Bewusst OHNE `requestApproval()`, damit der
 * „erster gesunder Kanal"-Fallback hier nicht einmal aufrufbar ist.
 */
export interface ChannelBoundApprover {
  requestApprovalOn(channelId: string, req: ApprovalRequest): Promise<ApprovalDecision>;
}

/** Ergebnis der Komposition: die Entscheidung + das Ziel, das sie erzeugt hat. */
export interface MatrixApprovalResult {
  /** Auszuwerten ausschließlich über `isApproved()`. */
  readonly decision: ApprovalDecision;
  /**
   * Das aufgelöste Matrix-Ziel (Kanal + deklarativer `decider`) — **nur Audit/Anzeige**.
   * `null` ⇔ nicht routable ⇔ es wurde **kein** Kanal gefragt.
   */
  readonly target: MatrixTarget | null;
}

/**
 * Löst `(tier, server, tool)` gegen die Matrix auf und holt die Freigabe **genau beim aufgelösten Kanal**.
 *
 * @param matrix   bereits `parseFreigabeMatrix`-validierte Matrix (fail-closed geparst, D1).
 * @param approver kanalgebundene Registry-Sicht (praktisch `MeldekanalRegistry`).
 * @param ctx      Gate-Kontext mit bereits berechnetem effektiven `tier`.
 * @param req      Anfrage, die dem Betreiber vorgelegt wird (unverändert durchgereicht).
 */
export async function requestApprovalViaMatrix(
  matrix: FreigabeMatrix,
  approver: ChannelBoundApprover,
  ctx: ResolveContext,
  req: ApprovalRequest,
): Promise<MatrixApprovalResult> {
  const resolved = resolveEntry(matrix, ctx);
  // `resolved === null` ist der dokumentierte D5-Kein-Match-Fall (Null-Narrowing, KEINE zweite
  // Policy-Prüfung); die Routbarkeit selbst entscheidet allein `isRoutable`. Beide Wege enden
  // identisch im Default-Deny, ohne dass irgendein Kanal gefragt wurde.
  if (resolved === null || !isRoutable(resolved)) {
    return {
      decision: { outcome: 'denied-no-channel', note: 'matrix: not routable' },
      target: null,
    };
  }

  try {
    const raw = await approver.requestApprovalOn(resolved.channel, req);
    // Der Approver ist injiziert und damit nicht vertrauenswürdig getypt: dasselbe
    // Normalisierungs-Sieb wie in der Registry (unbekanntes Shape ⇒ `error`, nie `approved`).
    // `normalizeDecision` stempelt dabei `channelId` = der **adressierte** Matrix-Kanal. Im gesunden
    // Pfad ist das identisch zu dem, was die Registry setzt; im Fall `unknown channel` bleibt die
    // `note` der Registry erhalten und sagt, dass dieser adressierte Kanal gar nicht existiert.
    return { decision: normalizeDecision(raw, resolved.channel), target: resolved };
  } catch (error) {
    return {
      decision: {
        outcome: 'error',
        channelId: resolved.channel,
        note: error instanceof Error ? error.message : String(error),
      },
      target: resolved,
    };
  }
}
