/**
 * telegram-gateway.ts — Telegram Gateway-Peer fuer Mesh-Monitoring + Control
 *
 * Eigener Mesh-Peer der als Bridge zwischen Telegram und dem lokalen Mesh fungiert.
 * Basierend auf dem Multi-Modell-Konsensus (GPT-5.4, Gemini 2.5 Pro, GPT-5.1):
 *
 * MVP-Scope:
 * - Mesh-Events an Telegram senden (Peer-Join/Leave, Task-Status, Audit)
 * - User-Befehle aus Telegram empfangen (/status, /peers, /health)
 * - Approval-Requests ueber Telegram (User genehmigt per Klick)
 *
 * Architektur-Entscheidungen:
 * - Gateway ist ein eigener Mesh-Peer, kein Skill in jedem Agent
 * - CBOR bleibt Core-Protokoll — Telegram nur Adapter
 * - Keine sensitiven Daten ueber Telegram (nur Summaries, Status, Approvals)
 * - Transport-Adapter abstrahiert fuer spaeter Matrix/Signal
 */

import TelegramBot from 'node-telegram-bot-api';
import type { MeshEventBus, MeshEvent } from './events.js';
import type { Logger } from 'pino';

export interface TelegramGatewayConfig {
  /** Telegram Bot Token (aus .env oder Vault) */
  botToken: string;
  /** Chat-ID fuer Mesh-Notifications (wird beim ersten /start gesetzt) */
  chatId?: string;
  /** Daemon-URL fuer API-Abfragen */
  daemonUrl: string;
}

export class TelegramGateway {
  private bot: TelegramBot;
  private chatId: string | null;
  private enabled = false;

  constructor(
    private config: TelegramGatewayConfig,
    private eventBus: MeshEventBus,
    private log?: Logger,
  ) {
    this.chatId = config.chatId ?? null;
    this.bot = new TelegramBot(config.botToken, { polling: true });
    this.setupCommands();
    this.setupEventBridge();
    this.enabled = true;
    this.log?.info('Telegram Gateway gestartet');
  }

  // --- Telegram-Befehle ---

  private setupCommands(): void {
    // /start — Registriert den Chat fuer Notifications
    this.bot.onText(/\/start/, (msg) => {
      this.chatId = String(msg.chat.id);
      this.bot.sendMessage(msg.chat.id,
        '🟢 *thinklocal-mcp Mesh verbunden*\n\n' +
        'Ich sende dir Mesh-Events und du kannst Befehle ausfuehren:\n\n' +
        '/status — Daemon-Status\n' +
        '/peers — Verbundene Peers\n' +
        '/health — System-Health\n' +
        '/skills — Verfuegbare Skills\n' +
        '/audit — Letzte Audit-Events\n' +
        '/help — Diese Hilfe',
        { parse_mode: 'Markdown' },
      );
      this.log?.info({ chatId: this.chatId }, 'Telegram Chat registriert');
    });

    // /status — Daemon-Status
    this.bot.onText(/\/status/, async (msg) => {
      try {
        const res = await fetch(`${this.config.daemonUrl}/api/status`, { signal: AbortSignal.timeout(5_000) });
        const status = (await res.json()) as Record<string, unknown>;
        this.bot.sendMessage(msg.chat.id,
          `📊 *Mesh-Status*\n\n` +
          `Agent: \`${status['agent_id']}\`\n` +
          `Host: ${status['hostname']}:${status['port']}\n` +
          `Uptime: ${formatUptime(status['uptime_seconds'] as number)}\n` +
          `Peers: ${status['peers_online']} online\n` +
          `Capabilities: ${status['capabilities_count']}\n` +
          `Tasks: ${status['active_tasks']} aktiv`,
          { parse_mode: 'Markdown' },
        );
      } catch {
        this.bot.sendMessage(msg.chat.id, '❌ Daemon nicht erreichbar');
      }
    });

    // /peers — Verbundene Peers
    this.bot.onText(/\/peers/, async (msg) => {
      try {
        const res = await fetch(`${this.config.daemonUrl}/api/peers`, { signal: AbortSignal.timeout(5_000) });
        const data = (await res.json()) as { peers: Array<Record<string, unknown>> };

        if (data.peers.length === 0) {
          this.bot.sendMessage(msg.chat.id, '📡 Keine Peers verbunden (allein im Mesh)');
          return;
        }

        let text = `📡 *${data.peers.length} Peer(s) verbunden*\n\n`;
        for (const p of data.peers) {
          const card = p['agent_card'] as Record<string, unknown> | null;
          const health = card?.['health'] as Record<string, number> | null;
          text += `• *${p['name']}*\n`;
          text += `  ${p['host']}:${p['port']}\n`;
          if (health) {
            text += `  CPU: ${health['cpu_percent']}% | RAM: ${health['memory_percent']}% | Disk: ${health['disk_percent']}%\n`;
          }
          text += '\n';
        }
        this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
      } catch {
        this.bot.sendMessage(msg.chat.id, '❌ Peer-Daten nicht abrufbar');
      }
    });

    // /health — System-Health
    this.bot.onText(/\/health/, async (msg) => {
      try {
        const res = await fetch(`${this.config.daemonUrl}/api/tasks/execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ skill_id: 'system.health' }),
          signal: AbortSignal.timeout(10_000),
        });
        const data = (await res.json()) as { result: Record<string, unknown> };
        const r = data.result;
        const cpu = r['cpu'] as Record<string, unknown>;
        const mem = r['memory'] as Record<string, unknown>;
        const os = r['os'] as Record<string, unknown>;

        this.bot.sendMessage(msg.chat.id,
          `🖥 *System-Health*\n\n` +
          `OS: ${os['distro']} ${os['release']} (${os['arch']})\n` +
          `Host: ${os['hostname']}\n` +
          `CPU: ${cpu['load_percent']}% (${cpu['cores']} Cores)\n` +
          `RAM: ${mem['used_gb']}/${mem['total_gb']} GB (${mem['used_percent']}%)\n` +
          `Uptime: ${(r['uptime'] as Record<string, unknown>)['formatted']}`,
          { parse_mode: 'Markdown' },
        );
      } catch {
        this.bot.sendMessage(msg.chat.id, '❌ Health-Daten nicht abrufbar');
      }
    });

    // /skills — Verfuegbare Skills
    this.bot.onText(/\/skills/, async (msg) => {
      try {
        const res = await fetch(`${this.config.daemonUrl}/api/capabilities`, { signal: AbortSignal.timeout(5_000) });
        const data = (await res.json()) as { capabilities: Array<Record<string, unknown>> };

        if (data.capabilities.length === 0) {
          this.bot.sendMessage(msg.chat.id, '🧩 Keine Skills registriert');
          return;
        }

        let text = `🧩 *${data.capabilities.length} Skill(s)*\n\n`;
        for (const c of data.capabilities) {
          const agent = String(c['agent_id'] ?? '').split('/').pop();
          text += `• *${c['skill_id']}* v${c['version']} (${agent})\n`;
        }
        this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
      } catch {
        this.bot.sendMessage(msg.chat.id, '❌ Skills nicht abrufbar');
      }
    });

    // /audit — Letzte Events
    this.bot.onText(/\/audit/, async (msg) => {
      try {
        const res = await fetch(`${this.config.daemonUrl}/api/audit?limit=5`, { signal: AbortSignal.timeout(5_000) });
        const data = (await res.json()) as { events: Array<Record<string, unknown>> };

        let text = `📝 *Letzte ${data.events.length} Audit-Events*\n\n`;
        for (const e of data.events) {
          const time = String(e['timestamp'] ?? '').slice(11, 19);
          text += `\`${time}\` ${e['event_type']} — ${e['details'] ?? '—'}\n`;
        }
        this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
      } catch {
        this.bot.sendMessage(msg.chat.id, '❌ Audit-Log nicht abrufbar');
      }
    });

    // /help
    this.bot.onText(/\/help/, (msg) => {
      this.bot.sendMessage(msg.chat.id,
        '🔧 *thinklocal-mcp Befehle*\n\n' +
        '/status — Daemon-Status\n' +
        '/peers — Verbundene Peers mit Health\n' +
        '/health — System-Health (CPU/RAM/Disk)\n' +
        '/skills — Verfuegbare Skills im Mesh\n' +
        '/audit — Letzte 5 Audit-Events\n',
        { parse_mode: 'Markdown' },
      );
    });
  }

  // --- Event-Bridge: Mesh → Telegram ---

  private setupEventBridge(): void {
    this.eventBus.onAny((event: MeshEvent) => {
      if (!this.chatId) return;

      // Nur relevante Events weiterleiten (kein Spam)
      switch (event.type) {
        case 'peer:join':
          this.sendNotification(`🟢 Peer beigetreten: ${event.data['agentId'] ?? 'unknown'}`);
          break;
        case 'peer:leave':
          this.sendNotification(`🔴 Peer verlassen: ${event.data['agentId'] ?? 'unknown'}`);
          break;
        case 'task:completed':
          this.sendNotification(`✅ Task abgeschlossen: ${event.data['skillId'] ?? 'unknown'}`);
          break;
        case 'task:failed':
          this.sendNotification(`❌ Task fehlgeschlagen: ${event.data['skillId'] ?? ''} — ${event.data['error'] ?? ''}`);
          break;
        case 'system:startup':
          this.sendNotification(`🚀 Daemon gestartet: ${event.data['agentId'] ?? ''}`);
          break;
        case 'system:shutdown':
          this.sendNotification(`⏹️ Daemon gestoppt`);
          break;
        // Heartbeats, capability:synced etc. werden NICHT gesendet (zu viel Spam)
      }
    });
  }

  private sendNotification(text: string): void {
    if (!this.chatId || !this.enabled) return;
    this.bot.sendMessage(this.chatId, text).catch((err) => {
      this.log?.warn({ err: String(err) }, 'Telegram-Nachricht fehlgeschlagen');
    });
  }

  stop(): void {
    this.enabled = false;
    this.bot.stopPolling();
    this.log?.info('Telegram Gateway gestoppt');
  }
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
