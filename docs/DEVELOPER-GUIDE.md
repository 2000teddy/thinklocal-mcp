# thinklocal-mcp Entwicklerhandbuch

Anleitung zum Erstellen eigener Adapter und Skills.

---

## 1. Eigenen Skill erstellen

### Skill-Manifest

Jeder Skill braucht ein Manifest (`manifest.json`):

```json
{
  "id": "my-skill",
  "version": "1.0.0",
  "description": "Mein erster thinklocal Skill",
  "author_agent": "spiffe://thinklocal/host/myhost/agent/claude-code",
  "category": "custom",
  "runtime": "node",
  "entrypoint": "index.ts",
  "permissions": ["system.read"],
  "dependencies": [],
  "input_schema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" }
    }
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "result": { "type": "string" }
    }
  }
}
```

### Skill-Code

```typescript
// index.ts — Skill-Einstiegspunkt
// Empfaengt Input via IPC, sendet Ergebnis zurueck

process.on('message', async (msg: { type: string; input: unknown }) => {
  if (msg.type !== 'execute') return;

  const input = msg.input as { query?: string };

  try {
    // Deine Logik hier
    const result = { answer: `Ergebnis fuer: ${input.query}` };

    // Ergebnis zurueck an den Daemon
    process.send!({ success: true, result });
  } catch (err) {
    process.send!({ success: false, error: String(err) });
  }
});
```

### Skill registrieren

Skills werden automatisch erkannt wenn sie in `~/.thinklocal/skills/` liegen:

```
~/.thinklocal/skills/
  my-skill/
    manifest.json
    index.ts
```

---

## 2. Eigenen Adapter erstellen

Adapter verbinden externe AI-Tools mit dem Mesh.

### Architektur

```
AI-Tool ←[Protokoll]→ Adapter ←[HTTP]→ Daemon (localhost:9440)
```

### MeshDaemonClient verwenden

```typescript
import { MeshDaemonClient } from './mesh-client.js';

const client = new MeshDaemonClient({
  baseUrl: 'http://localhost:9440',
});

// Peers abfragen
const peers = await client.listPeers();

// Skill ausfuehren
const result = await client.executeSkill('system.health');

// Capabilities abfragen
const caps = await client.listCapabilities();
```

### BaseHttpMeshAdapter erweitern

```typescript
import { BaseHttpMeshAdapter } from './mesh-adapter.js';

class MyCliAdapter extends BaseHttpMeshAdapter {
  readonly name = 'my-cli-adapter';

  async start(): Promise<void> {
    // Dein Protokoll-Server starten
    // z.B. stdin/stdout, HTTP, WebSocket, gRPC
  }

  stop(): void {
    // Cleanup
  }
}
```

---

## 3. Daemon-API Referenz

Basis-URL: `http://localhost:9440`

| Endpoint | Methode | Beschreibung |
|----------|---------|-------------|
| `/health` | GET | Liveness-Check |
| `/.well-known/agent-card.json` | GET | Agent-Identitaet |
| `/api/status` | GET | Daemon-Status |
| `/api/peers` | GET | Peer-Liste |
| `/api/capabilities` | GET | Capability-Registry |
| `/api/tasks/execute` | POST | Skill ausfuehren |
| `/api/vault` | GET/POST | Credentials |
| `/api/audit` | GET | Audit-Events |
| `/api/auth/token` | POST | JWT-Token (nur localhost) |
| `/graphql` | POST | GraphQL API |
| `/graphiql` | GET | GraphQL IDE |
| `/ws` | WS | WebSocket Events |
| `/message` | POST | CBOR Mesh-Nachrichten |

Vollstaendige Spec: [docs/openapi.yaml](openapi.yaml)

---

## 4. Event-System

### EventBus

```typescript
import { MeshEventBus } from './events.js';

const bus = new MeshEventBus();

// Alle Events hoeren
bus.onAny((event) => {
  console.log(event.type, event.data);
});

// Spezifische Events
bus.on('peer:join', (event) => {
  console.log('Neuer Peer:', event.data.agentId);
});
```

### Event-Typen

| Event | Daten |
|-------|-------|
| `peer:join` | agentId, host, port |
| `peer:leave` | agentId |
| `task:completed` | skillId, result |
| `task:failed` | skillId, error |
| `system:startup` | agentId |
| `system:shutdown` | — |

---

## 5. Policy-System

### Custom-Policy erstellen

`~/.thinklocal/policies.json`:

```json
[
  {
    "name": "block-dangerous-skills",
    "description": "Blockiere gefaehrliche Skills von externen Agents",
    "action": "skill.execute",
    "subject": "spiffe://thinklocal/host/untrusted/*",
    "resource": "credential.*",
    "effect": "deny",
    "priority": 100
  }
]
```

### Approval-Gate konfigurieren

`~/.thinklocal/approval-gates.json`:

```json
[
  {
    "skillPattern": "database.*",
    "requesterPattern": "*",
    "action": "approve",
    "description": "Datenbank-Zugriff erfordert Genehmigung"
  }
]
```

---

## 6. Testing

```bash
# Alle Tests
cd ~/Entwicklung_local/thinklocal-mcp && npm test

# Einzelne Test-Datei
npx vitest run packages/daemon/src/policy.test.ts

# Watch-Modus
npx vitest packages/daemon/src/
```

---

## 7. Projekt-Struktur

```
thinklocal-mcp/
  packages/
    daemon/src/        # Mesh-Daemon (TypeScript)
      index.ts         # Einstiegspunkt
      identity.ts      # Agent-Identitaet (ECDSA)
      tls.ts           # mTLS-Zertifikate
      discovery.ts     # mDNS Service Discovery
      mesh.ts          # Heartbeat + Peer-Management
      gossip.ts        # Registry-Synchronisation
      registry.ts      # CRDT Capability-Registry
      vault.ts         # Credential-Vault (AES-256-GCM)
      policy.ts        # Policy Engine
      audit.ts         # Audit-Log (SQLite)
      messages.ts      # CBOR Nachrichtenprotokoll
      agent-card.ts    # HTTP-Server + Agent Card
      tasks.ts         # Task-Management
      sandbox.ts       # Skill-Sandboxing
      telegram-gateway.ts  # Telegram Bot
      mcp-stdio.ts     # MCP Server (Claude Code)
      graphql-api.ts   # GraphQL API
      api-auth.ts      # JWT-Authentifizierung
    dashboard-ui/src/  # React Dashboard
    cli/src/           # CLI-Tools
  config/              # Konfigurationsdateien
  scripts/             # Install-Scripts
  docs/                # Dokumentation
```
