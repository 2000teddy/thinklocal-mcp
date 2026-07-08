# Runbook-Readiness für .52 Mesh-Node

Die Dokumentation `docs/REENROLL-52-RUNBOOK.md` wurde ausgebaut, um die Sicherheit und Nachvollziehbarkeit bei der Anmeldung des `.52` (iobroker) Nodes am Mesh zu gewährleisten. Dies beinhaltet detaillierte Preflight-Prüfungen (Zertifikats-Validierung gegen den CA-Trust-Anker) sowie manuell angelegte Backup-Anker vor Mutation der `paired-peers.json`.

Keine Auswirkungen auf die Daemon-Laufzeit oder CLI-Tools.
