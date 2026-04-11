# ADR-015: Mesh-basierte Update-Distribution (OTS — Over-The-SPIFFE)

**Status:** Proposed
**Datum:** 2026-04-11
**Autor:** Christian (Idee), Claude Code (Dokumentation)
**Verwandt:** ADR-008 (Dynamic Capabilities), SKILL_ANNOUNCE Mechanismus

## Kontext

Aktuell erfordert ein Code-Update auf einem Remote-Peer manuelles SSH:
`ssh peer → git pull → systemctl restart`. Bei 3+ Nodes ist das umstaendlich
und fehleranfaellig. Der Skill-Transport (PR #110/#112) zeigt, dass signierte
Payloads ueber mTLS zuverlaessig zwischen Peers fliessen koennen.

## Idee

Ein Peer der eine neuere Daemon-Version hat, kann Updates an andere Peers
im Mesh verteilen — signiert mit der Mesh-CA, verifiziert vom Empfaenger,
automatisch installiert und neugestartet.

## Geplanter Flow

```
1. Admin updated einen Node (git pull + restart)
2. Agent-Card zeigt neue version (z.B. 0.33)
3. Andere Peers sehen den Versions-Unterschied (Gossip/Heartbeat)
4. Peer fragt: UPDATE_REQUEST → neuer Node
5. Neuer Node sendet: UPDATE_PACKAGE (signiert, CBOR, via mTLS)
6. Empfaenger verifiziert Signatur + Integritaet
7. Empfaenger installiert + restartet automatisch
```

## Offene Fragen

- Welche Update-Granularitaet? (ganzes Repo vs. diff vs. nur daemon-Binary)
- Rollback bei fehlgeschlagenem Update? (Config-Revisions aus ADR-007 nutzen)
- Approval-Gate vor automatischem Update? (ADR-007 PR #97)
- Wie mit npm-Dependencies umgehen? (node_modules sind plattformabhaengig)

## Prioritaet

Deferred — nach Abschluss der aktuellen Stabilisierung. Kein Blocker fuer
den operativen Betrieb (SSH-Updates funktionieren weiterhin).
