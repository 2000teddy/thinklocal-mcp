// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * freigabe-matrix.ts — TL-10 Slice A (rein, KEINE Verdrahtung)
 *
 * Freigabe-Matrix v1: routet einen Gate-Kontext `(tier, server, tool)` auf einen **Kanal + Entscheider**,
 * bevor die Meldekanal-Registry gefragt wird. Diese Datei enthält NUR die reinen Funktionen (Parser,
 * Resolver, Guard) — kein I/O, keine Registry, keine Ingress-Verdrahtung (das ist Slice B).
 *
 * Vertrag (CO 2026-07-15 + §5-CO 2026-07-20, opus+sonnet einstimmig):
 *  - **D1** Matrix-Quelle: eigene Datei `config/freigabe-matrix.toml` → der Loader (Slice B) übergibt das
 *    geparste Objekt an `parseFreigabeMatrix`; diese Datei kennt die Quelle nicht (rein/testbar).
 *  - **D4** „non-kanonischer Server" wird gegen die **injizierte** `knownServers`-Liste geprüft (dieselbe,
 *    die der Ingress via `resolveMcp` kennt) — als Parameter, kein I/O.
 *  - **D5** Kein passender Eintrag / leere Matrix ⇒ `resolveEntry` = `null` ⇒ `isRoutable` = `false` ⇒
 *    Default-Deny 403 (konsistent mit TL-09b leerer Registry = 403).
 *  - Parse ist **fail-closed**: jeder Verstoß ⇒ `FreigabeMatrixError` (kein Teil-Laden). Der `isRoutable`-
 *    Guard ist der **einzige** erlaubte Auswertungspfad (analog `isApproved`); Aufrufer prüfen NIE selbst
 *    Teilbedingungen.
 *
 * BEWUSST AUSSER SCOPE (Slice B / gated): D2 (Registry-`requestApprovalOn(channelId)` + Kanal-Liveness) und
 * D3-Enforcement — `decider: human:<id>` ist in v1 **rein deklarativ** (Audit/Anzeige), wird hier nur der
 * **Grammatik** nach validiert, NICHT durchgesetzt. Das erfordert einen Christian-Sign-off + SECURITY.md-Notiz
 * VOR Slice B. `consensus:quorum=N` wird ebenfalls nur parse-validiert (der Consensus-Pfad bleibt hartes 403).
 */
import type { McpExecutionTier } from './mcp-service-registry.js';

const VALID_TIERS: readonly McpExecutionTier[] = ['self', 'gate', 'consensus'];
const ENTRY_KEYS: readonly string[] = ['tier', 'server', 'tool', 'channel', 'decider'];
const WILDCARD = '*';

/** Entscheider-Anspruch eines Matrix-Eintrags (v1: deklarativ, nicht durchgesetzt). */
export type Decider =
  | { readonly kind: 'human'; readonly id: string }
  | { readonly kind: 'consensus'; readonly quorum: number };

/** Ein validierter Matrix-Eintrag = Prädikat `(tier, server, tool)` + Ziel `(channel, decider)`. */
export interface FreigabeEntry {
  readonly tier: McpExecutionTier;
  readonly server: string;
  /** Exakter Tool-Name ODER `'*'` (server-weit). */
  readonly tool: string;
  readonly channel: string;
  readonly decider: Decider;
}

/** Die geparste, validierte Matrix (fail-closed: existiert nur, wenn ALLE Einträge gültig sind). */
export interface FreigabeMatrix {
  readonly entries: readonly FreigabeEntry[];
}

/** Auflösungs-Kontext aus dem Ingress (effektive `tier` bereits berechnet, `mcp-ingress.ts:169`). */
export interface ResolveContext {
  readonly tier: McpExecutionTier;
  readonly server: string;
  readonly tool: string;
}

/** Auflösungs-Ziel: welcher Kanal + welcher Entscheider-Anspruch. `null` ⇒ nicht routable. */
export interface MatrixTarget {
  readonly channel: string;
  readonly decider: Decider;
}

/** Fail-closed Parse-Fehler: ein Verstoß ⇒ die GANZE Matrix ist ungültig (kein Teil-Laden). */
export class FreigabeMatrixError extends Error {
  constructor(reason: string) {
    super(`Freigabe-Matrix ungültig: ${reason}`);
    this.name = 'FreigabeMatrixError';
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Parst `decider` streng gegen die v1-Grammatik. Wirft bei unbekannter/ungültiger Form. */
function parseDecider(raw: unknown, where: string): Decider {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new FreigabeMatrixError(`${where}: 'decider' muss ein nicht-leerer String sein`);
  }
  if (raw.startsWith('human:')) {
    const id = raw.slice('human:'.length);
    if (id.length === 0) throw new FreigabeMatrixError(`${where}: 'human:' ohne <id>`);
    return { kind: 'human', id };
  }
  if (raw.startsWith('consensus:')) {
    // Nur die Form `consensus:quorum=N` mit ganzzahligem N≥2 ist gültig (v1 nur parse-validiert).
    const m = /^consensus:quorum=(\d+)$/.exec(raw);
    if (!m) throw new FreigabeMatrixError(`${where}: 'consensus' erwartet 'consensus:quorum=N'`);
    const quorum = Number(m[1]);
    if (!Number.isInteger(quorum) || quorum < 2) {
      throw new FreigabeMatrixError(`${where}: 'consensus:quorum=N' verlangt N≥2 (erhalten ${quorum})`);
    }
    return { kind: 'consensus', quorum };
  }
  throw new FreigabeMatrixError(`${where}: unbekannte decider-Grammatik '${raw}'`);
}

/**
 * Validiert + parst die rohe Matrix **fail-closed**. `raw` = `{ entries: [...] }` (aus der TOML-Datei, D1).
 * `knownServers` = kanonische Servernamen (D4, injiziert). Wirft `FreigabeMatrixError` bei JEDEM Verstoß:
 * unbekannte Keys, fehlender `server` (tool-ohne-server), non-kanonischer Server, fehlende Pflichtfelder,
 * ungültige `tier`/`decider`-Grammatik, **Duplikat-Spezifität** (zwei Einträge gleicher `(tier,server,tool)`).
 * Leere/fehlende `entries` ⇒ gültige, LEERE Matrix (D5: routet dann nichts ⇒ Default-Deny).
 */
export function parseFreigabeMatrix(raw: unknown, knownServers: readonly string[]): FreigabeMatrix {
  if (!isPlainObject(raw)) throw new FreigabeMatrixError('Wurzel muss ein Objekt sein');
  const rootKeys = Object.keys(raw);
  const unknownRoot = rootKeys.filter((k) => k !== 'entries');
  if (unknownRoot.length > 0) throw new FreigabeMatrixError(`unbekannte Wurzel-Keys: ${unknownRoot.join(', ')}`);

  const rawEntries = raw.entries ?? [];
  if (!Array.isArray(rawEntries)) throw new FreigabeMatrixError(`'entries' muss ein Array sein`);

  const known = new Set(knownServers);
  const seen = new Set<string>(); // Spezifitäts-Schlüssel `tier|server|tool`
  const entries: FreigabeEntry[] = [];

  rawEntries.forEach((e, i) => {
    const where = `Eintrag #${i}`;
    if (!isPlainObject(e)) throw new FreigabeMatrixError(`${where}: muss ein Objekt sein`);

    const unknownKeys = Object.keys(e).filter((k) => !ENTRY_KEYS.includes(k));
    if (unknownKeys.length > 0) throw new FreigabeMatrixError(`${where}: unbekannte Keys: ${unknownKeys.join(', ')}`);

    const { tier, server, channel } = e;
    if (typeof tier !== 'string' || !VALID_TIERS.includes(tier as McpExecutionTier)) {
      throw new FreigabeMatrixError(`${where}: ungültige 'tier' (erlaubt: ${VALID_TIERS.join('|')})`);
    }
    // CO: tool-ohne-server = reject → `server` ist Pflicht (nicht-leerer String).
    if (typeof server !== 'string' || server.length === 0) {
      throw new FreigabeMatrixError(`${where}: 'server' fehlt (tool-ohne-server ist unzulässig)`);
    }
    // D4: non-kanonischer Server ⇒ reject.
    if (!known.has(server)) throw new FreigabeMatrixError(`${where}: non-kanonischer Server '${server}'`);

    // `tool` optional → default Wildcard '*'; muss sonst ein nicht-leerer String sein.
    const tool = e.tool === undefined ? WILDCARD : e.tool;
    if (typeof tool !== 'string' || tool.length === 0) {
      throw new FreigabeMatrixError(`${where}: 'tool' muss ein nicht-leerer String oder '*' sein`);
    }
    if (typeof channel !== 'string' || channel.length === 0) {
      throw new FreigabeMatrixError(`${where}: 'channel' (channelId) fehlt`);
    }
    const decider = parseDecider(e.decider, where);

    const key = `${tier}|${server}|${tool}`;
    if (seen.has(key)) throw new FreigabeMatrixError(`Duplikat-Spezifität für (${key})`);
    seen.add(key);

    entries.push({ tier: tier as McpExecutionTier, server, tool, channel, decider });
  });

  return { entries };
}

/**
 * Wählt den **spezifischsten** passenden Eintrag: Kandidaten haben `tier`- UND `server`-Match; exakter
 * `tool` schlägt Wildcard `'*'`. Kein Kandidat ⇒ `null` (⇒ nicht routable ⇒ Default-Deny, D5). Duplikat-
 * Spezifität ist bereits beim Parsen ausgeschlossen, daher gibt es je Spezifitätsstufe höchstens einen
 * Kandidaten (kein Laufzeit-Tie-Break).
 */
export function resolveEntry(matrix: FreigabeMatrix, ctx: ResolveContext): MatrixTarget | null {
  let exact: FreigabeEntry | undefined;
  let wildcard: FreigabeEntry | undefined;
  for (const e of matrix.entries) {
    if (e.tier !== ctx.tier || e.server !== ctx.server) continue;
    if (e.tool === ctx.tool) exact = e;
    else if (e.tool === WILDCARD) wildcard = e;
  }
  const chosen = exact ?? wildcard;
  return chosen ? { channel: chosen.channel, decider: chosen.decider } : null;
}

/**
 * Der EINZIGE erlaubte Routbarkeits-Guard (analog `isApproved`): ein Ziel ist nur dann routable, wenn es
 * überhaupt existiert UND einen zustellbaren Kanal-Bezug + einen wohlgeformten Entscheider trägt. Aufrufer
 * dürfen NIE selbst Teilbedingungen prüfen — sie rufen `resolveEntry` und dann `isRoutable`. (Die Kanal-
 * *Liveness* gegen die Registry ist Slice B; hier wird nur die intrinsische Wohlgeformtheit geprüft.)
 */
export function isRoutable(target: MatrixTarget | null): boolean {
  if (target === null) return false;
  if (typeof target.channel !== 'string' || target.channel.length === 0) return false;
  const d = target.decider;
  if (d.kind === 'human') return d.id.length > 0;
  if (d.kind === 'consensus') return Number.isInteger(d.quorum) && d.quorum >= 2;
  return false;
}
