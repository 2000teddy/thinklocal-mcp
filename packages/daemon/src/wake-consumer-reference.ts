// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * wake-consumer-reference.ts — TL-11: der **konsumentenseitige** Kern des Wake-Kontrakts (KEIN Transport).
 *
 * Der Daemon (dieser Repo) emittiert das gerichtete, inhaltsfreie `agent:wake` — diese Seite ist
 * end-to-end getestet (`wake-contract.ts`, `websocket.ts`, `tl11-wake-wire.conformance.test.ts`). Was der
 * **Out-of-Repo Agent-Home-Supervisor** (TL-11 Slice B) daraus macht, stand bisher **nur als Pseudocode**
 * in `TL-11-wake-consumer-contract.md` §6. Dieses Modul zieht daraus den **einen nicht-transportgebundenen
 * Teil** heraus und macht ihn zu getestetem Code: *„gegeben ein empfangener WS-Frame — soll ich den CLI
 * wecken, und wie interpretiere ich den Payload?"*
 *
 * **Warum das ein echter Slice ist, kein Kosmetik-Punkt:** die §6-Pseudocode-Referenz las den Grund als
 * `ev.reason` — die Draht-Wahrheit ist aber `ev.data.reason` (der Fanout sendet das GANZE `MeshEvent`,
 * `websocket.ts` `JSON.stringify(event)`; Befund aus `tl11-wake-wire.conformance.test.ts`). Genau diese
 * Fehlklasse (Payload flach statt unter `.data` lesen) hatte **konsumentenseitig keinen Test**. Hier wird
 * sie gepinnt: {@link interpretWakeFrame} liest ausschließlich unter `.data`, ein Top-Level-`reason` wird
 * bewusst **ignoriert**.
 *
 * **Bewusst NICHT hier** (das bleibt der out-of-repo/gatete Teil von Slice B — dieses Modul entfernt den
 * Blocker NICHT, es de-riskt ihn):
 *  - **Transport:** WS-Client, mTLS-Cert-Handhabung, Reconnect-Backoff — host-/deploy-spezifisch.
 *  - **`pokeCli()`:** wie genau der lokale CLI-Prozess geweckt wird (Signal/FIFO/IPC) — die eigentliche
 *    Supervisor-Entscheidung (Contract §6, §8). Dieses Modul liefert nur das **Ob**, nicht das **Wie**.
 *
 * **Fail-safe & rein**, konsistent zu den daemon-seitigen Kernen (`sweep-targets.ts`, `wake-contract.ts`):
 *  - Wirft **nie** — ein unlesbarer/fremder Frame darf einen Supervisor nicht crashen.
 *  - **0 Aufrufer** im Repo (Referenz für den externen Konsumenten; keine Runtime-Verdrahtung).
 *  - **Zero-Content bewahrt:** aus dem Frame werden nur `instanceId`/`spiffeUri`/`reason` gelesen — nie ein
 *    etwaiger Nachrichteninhalt. Das Wake bleibt ein reiner Trigger.
 */

/** Warum ein Poke ausgelöst wird. `wake` = empfangenes `agent:wake`; `cold-start-sweep` = §5-Pflicht beim (Re-)Connect. */
export type PokeTrigger = 'wake' | 'cold-start-sweep';

/** Warum ein Frame **nicht** zum Poke führt. `unparseable`/`not-an-object` = malformed; `not-a-wake-event` = anderer Typ. */
export type IgnoreCause = 'unparseable' | 'not-an-object' | 'not-a-wake-event';

/**
 * Die konsumentenseitige Entscheidung zu genau einem Ereignis. Diskriminiert über `poke`.
 * `reason` ist der **normalisierte** Grund: der Draht-Wert unter `.data.reason`, falls ein nicht-leerer
 * String — sonst der Default `'inbox'` (tolerant, §4: unbekannte `reason` ⇒ trotzdem „prüfe dein Postfach").
 */
export type WakeDecision =
  | {
      readonly poke: true;
      readonly trigger: PokeTrigger;
      readonly reason: string;
      /** Roher `.data.reason` vom Draht, falls vorhanden (für Logging/Diagnose). Bei fehlendem `.data` `undefined`. */
      readonly wireReason?: string;
      readonly instanceId?: string;
      readonly spiffeUri?: string;
    }
  | { readonly poke: false; readonly ignore: IgnoreCause; readonly observedType?: string };

/** Der Event-Typ, auf den ein Supervisor pokt. Alle anderen Typen werden ignoriert (§3 Event-Typ-Filter). */
const WAKE_EVENT_TYPE = 'agent:wake';
/** Einziger heute definierter `WakeReason`; auch der tolerante Default für unbekannte/fehlende Gründe (§4). */
const DEFAULT_REASON = 'inbox';

/** Liest ein nicht-leeres String-Feld aus einem Objekt, sonst `undefined`. */
function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

/**
 * Interpretiert einen empfangenen WS-Frame aus Sicht des Wake-Konsumenten (Agent-Home-Supervisor).
 *
 * @param raw ein empfangener Frame — als JSON-String (wie vom Socket, `String(ev.data)`) **oder** bereits
 *   geparstes Objekt. Beides zulässig, damit der Aufrufer nicht doppelt parsen muss.
 * @returns eine {@link WakeDecision}. `poke:true` ⇒ CLI wecken (Postfach prüfen); `poke:false` ⇒ ignorieren.
 *   **Wirft nie.**
 *
 * Kontrakt-Verankerung (`TL-11-wake-consumer-contract.md`):
 *  - **§4 Wire-Shape:** Payload wird **ausschließlich** unter `.data` gelesen; ein Top-Level-`reason`
 *    wird ignoriert (schützt vor der §6-Pseudocode-Fehlklasse `ev.reason`).
 *  - **§4 Zero-Content:** es werden nur `instance_id`/`spiffe_uri`/`reason` übernommen — nie Inhalt.
 *  - **§4 Toleranz:** ein unbekannter `reason` führt **trotzdem** zum Poke (Default `'inbox'`).
 *  - **§3 Event-Typ-Filter:** nur `agent:wake` pokt; `inbox:new`/`heartbeat`/`system:*` ⇒ ignorieren.
 *  - **§5 Idempotenz:** mehrfaches Poken ist harmlos — der Aufrufer darf jeden `poke:true` bedenkenlos ausführen.
 */
export function interpretWakeFrame(raw: unknown): WakeDecision {
  let frame: unknown = raw;
  if (typeof raw === 'string') {
    try {
      frame = JSON.parse(raw);
    } catch {
      return { poke: false, ignore: 'unparseable' };
    }
  }
  if (frame == null || typeof frame !== 'object' || Array.isArray(frame)) {
    return { poke: false, ignore: 'not-an-object' };
  }

  const env = frame as Record<string, unknown>;
  const type = readString(env, 'type');
  if (type !== WAKE_EVENT_TYPE) {
    // §3: der Event-Typ greift ZUERST. Alles außer `agent:wake` (inkl. system:connected/heartbeat/
    // inbox:new) ist für den Wake-Konsumenten kein Trigger. `observedType` nur zur Diagnose.
    return { poke: false, ignore: 'not-a-wake-event', ...(type !== undefined ? { observedType: type } : {}) };
  }

  // §4: der Payload liegt NESTED unter `.data`. Fehlt `.data` (oder ist kein Objekt), bleibt es dennoch ein
  // `agent:wake` — die Zero-Content-Semantik heißt: das Wake ist auch OHNE lesbaren Payload ein gültiger
  // Trigger. Wir poken dann mit dem Default-Grund, statt am Top-Level zu lesen (das wäre die §6-Fehlklasse).
  const data =
    env['data'] != null && typeof env['data'] === 'object' && !Array.isArray(env['data'])
      ? (env['data'] as Record<string, unknown>)
      : undefined;

  const wireReason = data !== undefined ? readString(data, 'reason') : undefined;
  return {
    poke: true,
    trigger: 'wake',
    reason: wireReason ?? DEFAULT_REASON,
    ...(wireReason !== undefined ? { wireReason } : {}),
    ...(data !== undefined && readString(data, 'instance_id') !== undefined
      ? { instanceId: readString(data, 'instance_id') as string }
      : {}),
    ...(data !== undefined && readString(data, 'spiffe_uri') !== undefined
      ? { spiffeUri: readString(data, 'spiffe_uri') as string }
      : {}),
  };
}

/**
 * Die §5-**Cold-Start-Sweep-Pflicht** als Code: beim (Re-)Connect MUSS der Konsument **einmal** das
 * Postfach pollen — Wakes sind best-effort/lossy, die Reconnect-Lücke verliert sonst Nachrichten. Diese
 * Funktion trägt keine Logik, sie **benennt** die Pflicht als aufrufbaren Trigger (der Supervisor ruft sie
 * im WS-`open`-Handler auf: `ws.on('open', () => execute(coldStartSweepDecision()))`).
 */
export function coldStartSweepDecision(): WakeDecision {
  return { poke: true, trigger: 'cold-start-sweep', reason: DEFAULT_REASON };
}
