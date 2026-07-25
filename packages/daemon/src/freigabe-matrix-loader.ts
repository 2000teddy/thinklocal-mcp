// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * freigabe-matrix-loader.ts — TL-10 D1: der reine **TOML-Text → Matrix**-Loader (KEIN fs-I/O, KEINE
 * Verdrahtung, KEINE Enforcement).
 *
 * D1 (§5-CO 2026-07-20, opus+sonnet einstimmig) legt die Matrix-**Quelle** auf `config/freigabe-matrix.toml`
 * fest. Diese Datei macht **nur** den Format-Schritt: TOML-**Text** → geparstes Objekt →
 * {@link parseFreigabeMatrix} (die fail-closed §2.2-Validierung aus Slice A). Sie kennt die Datei **nicht**.
 *
 * **Bewusst NICHT hier** (das ist der weiterhin gegatete Rest von Slice B — dieser Loader nimmt keinen davon
 * vorweg):
 *  - **fs-Lesen** der Datei von der Platte (`readFileSync(config/freigabe-matrix.toml)`) — der verdrahtete
 *    Teil; der (spätere) Aufrufer liest den Text und übergibt ihn hier.
 *  - die **kuratierte Policy-Datei** selbst (D1 Policy-Inhalt — Owner-Entscheidung, wird hier NICHT mitgeliefert).
 *  - **Ingress-Verdrahtung + Env-Flag** (Aktivierung) und **D3-Enforcement** (Christian-Sign-off).
 *
 * **0 Aufrufer** ⇒ kein Runtime-Delta. Form wie die übrigen Slice-B-Prep-Primitive
 * (`requestApprovalOn` #317, `requestApprovalViaMatrix` #319): reiner Kern unterhalb eines weiterhin gateten
 * Aktivierungs-Schritts.
 */
import TOML from '@iarna/toml';
import { parseFreigabeMatrix, FreigabeMatrixError, type FreigabeMatrix } from './freigabe-matrix.js';

/**
 * Parst Freigabe-Matrix-TOML-**Text** (liest **keine** Datei) **fail-closed**.
 *
 * @param tomlText roher TOML-Inhalt (der Aufrufer hat ihn bereits von der Platte gelesen — hier kein I/O).
 * @param knownServers kanonische Servernamen (D4, injiziert — dieselbe Liste wie im Ingress via `resolveMcp`).
 * @returns eine validierte {@link FreigabeMatrix}. Leerer/tabellenloser Text ⇒ leere Matrix (D5 Default-Deny).
 * @throws {FreigabeMatrixError} bei nicht-parsebarem TOML **oder** jedem §2.2-Validierungsverstoß. **Nur**
 *   diese eine Fehlerklasse wird geworfen — der Aufrufer muss nicht zwei Fehlertypen unterscheiden; ein
 *   TOML-Syntaxfehler ist genauso „Matrix ungültig, nichts laden" wie ein Schema-Verstoß (fail-closed).
 */
export function parseFreigabeMatrixToml(
  tomlText: string,
  knownServers: readonly string[],
): FreigabeMatrix {
  if (typeof tomlText !== 'string') {
    throw new FreigabeMatrixError('TOML-Eingabe muss ein String sein');
  }
  let parsed: unknown;
  try {
    parsed = TOML.parse(tomlText);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new FreigabeMatrixError(`TOML nicht parsebar: ${detail}`);
  }
  // Ab hier übernimmt die Slice-A-Validierung (fail-closed): unbekannte Keys, non-kanonischer Server,
  // whitespace-Kanal, decider-Grammatik, Duplikat-Spezifität … ⇒ FreigabeMatrixError.
  return parseFreigabeMatrix(parsed, knownServers);
}
