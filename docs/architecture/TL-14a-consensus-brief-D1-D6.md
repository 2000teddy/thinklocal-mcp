# TL-14a — CA Zweistufen-Umzug: Consensus-Brief (D1–D6)

**Zweck:** Dieses Dokument bereitet die 6 Kernfragen (D1–D6) aus der CA-Umzugs-Scoping-Phase präzise für den formalen Konsens-Prozess (`pal:consensus`) und das anschließende Sign-off durch Christian vor. Es trifft **keine** verbindlichen Architekturentscheidungen, sondern aggregiert die Optionen und Empfehlungen aus `TL-14a-decision-checklist.md` in einem für die Agenten-Abstimmung optimalen Format.

## Abstimmungs-Gegenstände (Entscheidungsvorlagen)

### D1: Trust-Domain-Kopplung
- **Frage:** Soll der CA-Umzug zeitgleich mit dem Trust-Domain-Flip auf `axxsys-software.de` stattfinden?
- **Optionen:** (a) Gekoppelt (ein Fenster) vs. (b) Entkoppelt (zwei separate Fenster).
- **Empfehlung:** **(b) Entkoppeln**. Reduziert das Risiko, da Signierpfad und Namensraum-Flip getrennt diagnostiziert werden können.

### D2: `pathLenConstraint` der Root
- **Frage:** Welcher `pathLenConstraint` wird für die neue Offline-Root konfiguriert?
- **Optionen:** (a) `0` (Intermediates dürfen keine Sub-CAs erstellen) vs. (b) `1`.
- **Empfehlung:** **(a) 0**. Entspricht dem Prinzip der minimalen Rechtevergabe; zwei Stufen sind genau ausreichend.

### D3: Intermediate-Validität & Erneuerung
- **Frage:** Welchen Lebenszyklus sollen die neuen Intermediates erhalten?
- **Optionen:** (a) Kurz + über `renew_before_days` gekoppelt vs. (b) Lang (z.B. ≥ 5 Jahre) + eigener Zyklus.
- **Empfehlung:** **(b) Lang**. Vermeidet häufige, teure Air-Gap-Zeremonien der Offline-Root.

### D4: Cross-Sign vs. harter Cutover
- **Frage:** Wie wird der Übergang von alter zu neuer Root am Client validiert?
- **Optionen:** (a) Cross-Sign der neuen Intermediates durch die alte Root vs. (b) Harter Cutover per Doppel-Pin.
- **Empfehlung:** **(b) Doppel-Pin**. Mechanismus existiert im Repo bereits; Cross-Signing würde neuen, komplexen Validierungscode erfordern.

### D5: Chain-Ausroll-Mechanik
- **Frage:** Wie erhalten die Nodes die neue Kette?
- **Optionen:** (a) Token-Re-Onboard je Node vs. (b) `ca.crt.pem`-Chain-Swap.
- **Empfehlung:** **(a) Token-Re-Onboard**. Verhindert dokumentierte Fallen wie das Überschreiben hub-signierter Zertifikate bei einem Reissue.

### D6: TH02-Geschwister-Rolle
- **Frage:** Welche Rolle spielt das zweite Intermediate auf TH02?
- **Optionen:** (a) Heiß (parallele Ausstellung) vs. (b) Kalt (versiegelte Reserve, identische Kette).
- **Empfehlung:** **(b) Kalt**. Deckt Ausfälle ab, ohne die Angriffsfläche durch zwei gleichzeitig aktive Signierschlüssel zu verdoppeln.

## Nächste Schritte
1. Ausführung von `pal:consensus` (Evaluation der Vorlage durch 2-3 Modelle).
2. Dokumentation der Agenten-Voten.
3. Finales Sign-off durch Christian (insb. D1, D4, D5, D6).
4. Überführung in die finale ADR (CA-Hierarchie).
