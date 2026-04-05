# GraphQL Schema — thinklocal-mcp

Endpoint: `http://localhost:9440/graphql`
GraphiQL UI: `http://localhost:9440/graphiql`

## Schema

```graphql
type Status {
  agent_id: String!
  hostname: String!
  port: Int!
  uptime_seconds: Float!
  peers_online: Int!
  capabilities_count: Int!
  active_tasks: Int!
}

type Health {
  cpu_percent: Float
  memory_percent: Float
  disk_percent: Float
  uptime_seconds: Float
}

type Peer {
  name: String!
  host: String!
  port: Int!
  agentId: String!
  status: String!
  health: Health
}

type Capability {
  skill_id: String!
  version: String!
  agent_id: String!
  health: String!
  description: String
  category: String
}

type AuditEvent {
  id: Int!
  timestamp: String!
  event_type: String!
  agent_id: String!
  peer_id: String
  details: String
}

type MeshEvent {
  type: String!
  timestamp: String!
  data: String
}

type Query {
  status: Status
  peers: [Peer!]!
  capabilities: [Capability!]!
  auditEvents(limit: Int): [AuditEvent!]!
}

type Subscription {
  meshEvents: MeshEvent
}
```

## Beispiel-Queries

### Mesh-Status abfragen

```graphql
query {
  status {
    agent_id
    hostname
    port
    uptime_seconds
    peers_online
    capabilities_count
    active_tasks
  }
}
```

### Peers mit Health-Daten

```graphql
query {
  peers {
    name
    host
    port
    agentId
    status
    health {
      cpu_percent
      memory_percent
      disk_percent
    }
  }
}
```

### Capabilities filtern

```graphql
query {
  capabilities {
    skill_id
    version
    agent_id
    health
    category
    description
  }
}
```

### Audit-Log (letzte 50 Events)

```graphql
query {
  auditEvents(limit: 50) {
    id
    timestamp
    event_type
    agent_id
    peer_id
    details
  }
}
```

### Echtzeit-Events (Subscription)

```graphql
subscription {
  meshEvents {
    type
    timestamp
    data
  }
}
```

Subscription-Events werden ueber WebSocket geliefert.
Heartbeat-Events (`peer:heartbeat`) werden automatisch gefiltert.

## Authentifizierung

- **Localhost**: Kein Token erforderlich
- **Remote**: JWT-Token im Header: `Authorization: Bearer <token>`
- Token generieren: `POST /api/auth/token` (nur von localhost)

## Hinweise

- GraphiQL UI ist nur im Entwicklungsmodus aktiviert
- Subscriptions nutzen den gleichen WebSocket-Pfad (`/graphql`)
- Timeout fuer Queries: 5 Sekunden
- Die GraphQL-API laeuft parallel zur REST-API
