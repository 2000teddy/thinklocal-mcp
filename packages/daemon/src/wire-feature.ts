// Copyright (c) 2026 Christian — ThinkLocal/ThinkHub. Licensed under the Elastic License 2.0 (ELv2). See LICENSE.
/**
 * wire-feature.ts — ADR-046 receiver-advertised Wire-Feature-Support (Consumer-Kern, fail-closed).
 *
 * Der **kleinste ungegatete** Baustein aus ADR-046 (Wire-Feature/Version-Exchange). ADR-046 lässt
 * bewusst ZWEI Fragen offen, die vor dem eigentlichen Groundwork ein CO (Cross-Vendor-`pal:consensus`,
 * derzeit pal-PATH-blockiert) brauchen:
 *   1. **Platzierung** der annoncierten Feature-Liste auf der Agent-Card (eigener `protocol`-Block
 *      vs. Wiederverwendung von `capabilities.services`) — ADR-046 §Konsequenzen „−/offen (CO)".
 *   2. **Vokabular + Semver-Politik** der Feature-Flags (Namen, `protocol_version`-Semver, ob Flags
 *      additiv/nie-entfernt) — ADR-046 §3.
 *
 * Dieser Kern nimmt darum die **annoncierte Feature-Liste selbst** entgegen (NICHT die `AgentCard`) und
 * ist damit **platzierungs- UND vokabular-agnostisch**: er nimmt keine der beiden CO-offenen Fragen
 * vorweg (kein neues Card-Feld, kein Feature-Name geseedet, keine Semver-Politik). Er kodifiziert
 * ausschließlich die **non-negotiable Invariante** aus ADR-046 §2 als getesteten, wiederverwendbaren
 * Primitiv: **fail-closed** — absent / unbekannt / leer / malformed ⇒ `false`. **NIEMALS**
 * „absent ⇒ assume yes".
 *
 * Kein State, kein I/O, deterministisch, rein additiv (kein Aufrufer heute → kein Runtime-Verhalten geändert).
 * Die CO-gegatete Folge-Slice (Producer füllt die Liste, Feature-Registry, `version-compat`-Verdrahtung,
 * Card-Platzierung) ruft diesen Kern mit `card.<platzierung>?.features` — dann bleibt die fail-closed-
 * Semantik strukturell an EINER Stelle.
 *
 * Siehe docs/architecture/ADR-046-wire-feature-version-exchange.md §2.
 */

/**
 * Unterstützt ein Peer (laut seiner **annoncierten** Empfangs-Feature-Liste) die Wire-Fähigkeit `feature`?
 *
 * **Fail-closed / total:** gibt `true` **nur** zurück, wenn `advertisedFeatures` ein echtes Array ist,
 * das den exakten String `feature` enthält. Jeder andere Fall — `undefined`/`null` (Peer ohne Feature-
 * Advertisement, z.B. alte Version), Nicht-Array (malformed/geforgt), leere Liste, non-string-Elemente,
 * leeres/nicht-string `feature` — ⇒ `false`. Wirft nie.
 *
 * @param advertisedFeatures Die vom Peer annoncierte Empfangs-Feature-Liste (Herkunft/Card-Platzierung
 *                           ist CO-offen und bewusst NICHT hier verdrahtet — der Aufrufer liest sie).
 * @param feature            Das abgefragte Wire-Feature-Flag (Aufrufer-geliefert; kein Vokabular hier).
 */
export function supportsFeature(advertisedFeatures: unknown, feature: string): boolean {
  if (typeof feature !== 'string' || feature === '') return false;
  if (!Array.isArray(advertisedFeatures)) return false;
  // Exakter String-Match; non-string-Elemente einer geforgten Liste matchen nie einen string-`feature`.
  return advertisedFeatures.includes(feature);
}
