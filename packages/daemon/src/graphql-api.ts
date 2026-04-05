/**
 * graphql-api.ts — GraphQL API fuer das Dashboard und externe Clients
 *
 * Verwendet Mercurius (Fastify GraphQL Plugin) mit Subscriptions.
 * Ersetzt nicht die REST-API — laeuft parallel fuer Clients die GraphQL bevorzugen.
 *
 * Schema:
 * - Query: status, peers, capabilities, auditEvents
 * - Subscription: meshEvents (Echtzeit-Events via WebSocket)
 */

import type { FastifyInstance } from 'fastify';
import mercurius from 'mercurius';
import type { MeshEventBus, MeshEvent } from './events.js';
import type { Logger } from 'pino';

const schema = `
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
`;

interface GraphQLContext {
  daemonUrl: string;
}

/**
 * Registriert die GraphQL API auf einer Fastify-Instanz.
 */
export async function registerGraphQL(
  app: FastifyInstance,
  daemonUrl: string,
  eventBus: MeshEventBus,
  log?: Logger,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await app.register(mercurius as any, {
    schema,
    resolvers: {
      Query: {
        status: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
          const res = await fetch(`${ctx.daemonUrl}/api/status`, { signal: AbortSignal.timeout(5_000) });
          if (!res.ok) throw new Error(`Daemon-API nicht erreichbar: ${res.status} ${res.statusText}`);
          return res.json();
        },
        peers: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
          const res = await fetch(`${ctx.daemonUrl}/api/peers`, { signal: AbortSignal.timeout(5_000) });
          if (!res.ok) throw new Error(`Peers nicht abrufbar: ${res.status}`);
          const data = (await res.json()) as { peers: unknown[] };
          return data.peers;
        },
        capabilities: async (_: unknown, __: unknown, ctx: GraphQLContext) => {
          const res = await fetch(`${ctx.daemonUrl}/api/capabilities`, { signal: AbortSignal.timeout(5_000) });
          if (!res.ok) throw new Error(`Capabilities nicht abrufbar: ${res.status}`);
          const data = (await res.json()) as { capabilities: unknown[] };
          return data.capabilities;
        },
        auditEvents: async (_: unknown, args: { limit?: number }, ctx: GraphQLContext) => {
          const limit = args.limit ?? 20;
          const res = await fetch(`${ctx.daemonUrl}/api/audit?limit=${limit}`, { signal: AbortSignal.timeout(5_000) });
          if (!res.ok) throw new Error(`Audit-Events nicht abrufbar: ${res.status}`);
          const data = (await res.json()) as { events: unknown[] };
          return data.events;
        },
      },
      Subscription: {
        meshEvents: {
          subscribe: async function* (_: unknown, __: unknown) {
            // EventBus-basierter Async Generator
            const queue: MeshEvent[] = [];
            let resolve: (() => void) | null = null;

            const handler = (event: MeshEvent) => {
              // Heartbeats filtern
              if (event.type === 'peer:heartbeat') return;
              queue.push(event);
              if (resolve) {
                resolve();
                resolve = null;
              }
            };

            eventBus.onAny(handler);

            try {
              while (true) {
                if (queue.length > 0) {
                  const event = queue.shift()!;
                  yield {
                    meshEvents: {
                      type: event.type,
                      timestamp: event.timestamp,
                      data: JSON.stringify(event.data),
                    },
                  };
                } else {
                  await new Promise<void>((r) => { resolve = r; });
                }
              }
            } finally {
              eventBus.offAny(handler);
            }
          },
        },
      },
    },
    context: (): GraphQLContext => ({ daemonUrl }),
    subscription: true,
    graphiql: true, // GraphiQL UI unter /graphiql
  });

  log?.info('GraphQL API registriert (/graphql + /graphiql)');
}
