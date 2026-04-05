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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MeshEventBus, MeshEvent } from './events.js';
import type { Logger } from 'pino';

/** Escape Telegram Markdown V1 special characters in dynamic data */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*`[\]]/g, '\\$&');
}

/** Parse allowed chat IDs from env (comma-separated) */
const ALLOWED_CHAT_IDS = (process.env['TELEGRAM_ALLOWED_CHATS'] ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

export interface TelegramGatewayConfig {
  /** Telegram Bot Token (aus .env oder Vault) */
  botToken: string;
  /** Chat-ID fuer Mesh-Notifications (wird beim ersten /start gesetzt) */
  chatId?: string;
  /** Daemon-URL fuer API-Abfragen */
  daemonUrl: string;
  /** Pfad zur Persistenz-Datei fuer chatId (optional) */
  chatIdFile?: string;
}

export class TelegramGateway {
  private bot: TelegramBot;
  private chatId: string | null;
  private enabled = false;
  private eventHandler?: (event: MeshEvent) => void;
  private lastCommandAt: Map<string, number> = new Map();

  constructor(
    private config: TelegramGatewayConfig,
    private eventBus: MeshEventBus,
    private log?: Logger,
  ) {
    this.chatId = config.chatId ?? this.loadChatId();
    this.bot = new TelegramBot(config.botToken, { polling: true });
    this.setupCommands();
    this.setupEventBridge();
    this.enabled = true;
    if (this.chatId) {
      this.log?.info({ chatId: this.chatId }, 'Telegram Gateway gestartet (chatId aus Datei geladen)');
    } else {
      this.log?.info('Telegram Gateway gestartet — sende /start an den Bot');
    }
  }

  /** Laedt gespeicherte chatId aus Datei */
  private loadChatId(): string | null {
    if (!this.config.chatIdFile) return null;
    try {
      const data = readFileSync(this.config.chatIdFile, 'utf-8').trim();
      return data || null;
    } catch { return null; }
  }

  /** Speichert chatId in Datei fuer Persistenz ueber Restarts */
  private saveChatId(chatId: string): void {
    if (!this.config.chatIdFile) return;
    try {
      mkdirSync(dirname(this.config.chatIdFile), { recursive: true });
      writeFileSync(this.config.chatIdFile, chatId, { mode: 0o600 });
    } catch (err) {
      this.log?.warn({ err }, 'chatId-Persistenz fehlgeschlagen');
    }
  }

  /** Simple per-command rate limiter (min interval in ms) */
  private isRateLimited(chatId: string, command: string, minMs = 5000): boolean {
    const key = `${chatId}:${command}`;
    const now = Date.now();
    const last = this.lastCommandAt.get(key) ?? 0;
    if (now - last < minMs) return true;
    this.lastCommandAt.set(key, now);
    return false;
  }

  // --- Telegram-Befehle ---

  private setupCommands(): void {
    // /start — Registriert den Chat fuer Notifications (mit optionaler Allowlist)
    this.bot.onText(/^\/start(?:\s+.*)?$/, (msg) => {
      const chatId = String(msg.chat.id);

      // Zugriffskontrolle: Wenn TELEGRAM_ALLOWED_CHATS gesetzt, nur diese erlauben
      if (ALLOWED_CHAT_IDS.length > 0 && !ALLOWED_CHAT_IDS.includes(chatId)) {
        this.bot.sendMessage(msg.chat.id, '⛔️ Zugriff verweigert');
        this.log?.warn({ chatId }, 'Unberechtigter Telegram-Startversuch');
        return;
      }

      this.chatId = chatId;
      this.saveChatId(chatId);
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
    this.bot.onText(/^\/status$/, async (msg) => {
      if (this.isRateLimited(String(msg.chat.id), '/status')) return;
      try {
        const res = await fetch(`${this.config.daemonUrl}/api/status`, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) {
          this.log?.warn({ status: res.status }, 'Daemon /api/status nicht OK');
          this.bot.sendMessage(msg.chat.id, '❌ Daemon-API Fehler');
          return;
        }
        const status = (await res.json()) as Record<string, unknown>;
        const agentId = escapeMarkdown(String(status['agent_id'] ?? 'unknown'));
        const host = escapeMarkdown(String(status['hostname'] ?? 'unknown'));
        this.bot.sendMessage(msg.chat.id,
          `📊 *Mesh-Status*\n\n` +
          `Agent: \`${agentId}\`\n` +
          `Host: ${host}:${status['port']}\n` +
          `Uptime: ${formatUptime(status['uptime_seconds'] as number)}\n` +
          `Peers: ${status['peers_online']} online\n` +
          `Capabilities: ${status['capabilities_count']}\n` +
          `Tasks: ${status['active_tasks']} aktiv`,
          { parse_mode: 'Markdown' },
        );
      } catch (err) {
        this.log?.warn({ err, command: '/status' }, 'Telegram-Befehl fehlgeschlagen');
        this.bot.sendMessage(msg.chat.id, '❌ Daemon nicht erreichbar');
      }
    });

    // /peers — Verbundene Peers
    this.bot.onText(/^\/peers$/, async (msg) => {
      if (this.isRateLimited(String(msg.chat.id), '/peers')) return;
      try {
        const res = await fetch(`${this.config.daemonUrl}/api/peers`, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) {
          this.log?.warn({ status: res.status }, 'Daemon /api/peers nicht OK');
          this.bot.sendMessage(msg.chat.id, '❌ Daemon-API Fehler');
          return;
        }
        const data = (await res.json()) as { peers: Array<Record<string, unknown>> };

        if (data.peers.length === 0) {
          this.bot.sendMessage(msg.chat.id, '📡 Keine Peers verbunden (allein im Mesh)');
          return;
        }

        let text = `📡 *${data.peers.length} Peer(s) verbunden*\n\n`;
        for (const p of data.peers) {
          const card = p['agent_card'] as Record<string, unknown> | null;
          const health = card?.['health'] as Record<string, number> | null;
          const name = escapeMarkdown(String(p['name'] ?? 'unknown'));
          const host = escapeMarkdown(String(p['host'] ?? ''));
          text += `• *${name}*\n`;
          text += `  ${host}:${p['port']}\n`;
          if (health) {
            text += `  CPU: ${health['cpu_percent']}% | RAM: ${health['memory_percent']}% | Disk: ${health['disk_percent']}%\n`;
          }
          text += '\n';
        }
        this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
      } catch (err) {
        this.log?.warn({ err, command: '/peers' }, 'Telegram-Befehl fehlgeschlagen');
        this.bot.sendMessage(msg.chat.id, '❌ Peer-Daten nicht abrufbar');
      }
    });

    // /health — System-Health (rate-limited: 10s)
    this.bot.onText(/^\/health$/, async (msg) => {
      if (this.isRateLimited(String(msg.chat.id), '/health', 10_000)) {
        this.bot.sendMessage(msg.chat.id, '⏳ Bitte kurz warten...');
        return;
      }
      try {
        const res = await fetch(`${this.config.daemonUrl}/api/tasks/execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ skill_id: 'system.health' }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          this.log?.warn({ status: res.status }, 'Daemon /api/tasks/execute nicht OK');
          this.bot.sendMessage(msg.chat.id, '❌ Daemon-API Fehler');
          return;
        }
        const data = (await res.json()) as { result: Record<string, unknown> };
        const r = data.result;
        const cpu = r['cpu'] as Record<string, unknown>;
        const mem = r['memory'] as Record<string, unknown>;
        const os = r['os'] as Record<string, unknown>;
        const hostname = escapeMarkdown(String(os['hostname'] ?? 'unknown'));
        const distro = escapeMarkdown(String(os['distro'] ?? ''));

        this.bot.sendMessage(msg.chat.id,
          `🖥 *System-Health*\n\n` +
          `OS: ${distro} ${os['release']} (${os['arch']})\n` +
          `Host: ${hostname}\n` +
          `CPU: ${cpu['load_percent']}% (${cpu['cores']} Cores)\n` +
          `RAM: ${mem['used_gb']}/${mem['total_gb']} GB (${mem['used_percent']}%)\n` +
          `Uptime: ${escapeMarkdown(String((r['uptime'] as Record<string, unknown>)['formatted'] ?? ''))}`,
          { parse_mode: 'Markdown' },
        );
      } catch (err) {
        this.log?.warn({ err, command: '/health' }, 'Telegram-Befehl fehlgeschlagen');
        this.bot.sendMessage(msg.chat.id, '❌ Health-Daten nicht abrufbar');
      }
    });

    // /skills — Verfuegbare Skills
    this.bot.onText(/^\/skills$/, async (msg) => {
      if (this.isRateLimited(String(msg.chat.id), '/skills')) return;
      try {
        const res = await fetch(`${this.config.daemonUrl}/api/capabilities`, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) {
          this.log?.warn({ status: res.status }, 'Daemon /api/capabilities nicht OK');
          this.bot.sendMessage(msg.chat.id, '❌ Daemon-API Fehler');
          return;
        }
        const data = (await res.json()) as { capabilities: Array<Record<string, unknown>> };

        if (data.capabilities.length === 0) {
          this.bot.sendMessage(msg.chat.id, '🧩 Keine Skills registriert');
          return;
        }

        let text = `🧩 *${data.capabilities.length} Skill(s)*\n\n`;
        for (const c of data.capabilities) {
          const agent = escapeMarkdown(String(c['agent_id'] ?? '').split('/').pop() ?? '');
          const skillId = escapeMarkdown(String(c['skill_id'] ?? ''));
          text += `• *${skillId}* v${c['version']} (${agent})\n`;
        }
        this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
      } catch (err) {
        this.log?.warn({ err, command: '/skills' }, 'Telegram-Befehl fehlgeschlagen');
        this.bot.sendMessage(msg.chat.id, '❌ Skills nicht abrufbar');
      }
    });

    // /audit — Letzte Events
    this.bot.onText(/^\/audit$/, async (msg) => {
      if (this.isRateLimited(String(msg.chat.id), '/audit')) return;
      try {
        const res = await fetch(`${this.config.daemonUrl}/api/audit?limit=5`, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) {
          this.log?.warn({ status: res.status }, 'Daemon /api/audit nicht OK');
          this.bot.sendMessage(msg.chat.id, '❌ Daemon-API Fehler');
          return;
        }
        const data = (await res.json()) as { events: Array<Record<string, unknown>> };

        let text = `📝 *Letzte ${data.events.length} Audit-Events*\n\n`;
        for (const e of data.events) {
          const time = String(e['timestamp'] ?? '').slice(11, 19);
          const eventType = escapeMarkdown(String(e['event_type'] ?? ''));
          const details = escapeMarkdown(String(e['details'] ?? '—'));
          text += `\`${time}\` ${eventType} — ${details}\n`;
        }
        this.bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
      } catch (err) {
        this.log?.warn({ err, command: '/audit' }, 'Telegram-Befehl fehlgeschlagen');
        this.bot.sendMessage(msg.chat.id, '❌ Audit-Log nicht abrufbar');
      }
    });

    // /help
    this.bot.onText(/^\/help$/, (msg) => {
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
    this.eventHandler = (event: MeshEvent) => {
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
    };
    this.eventBus.onAny(this.eventHandler);
  }

  private sendNotification(text: string): void {
    if (!this.chatId || !this.enabled) return;
    this.bot.sendMessage(this.chatId, text).catch((err: unknown) => {
      const status = (err as Record<string, Record<string, number>>)?.response?.statusCode;
      if (status === 429) {
        this.log?.warn('Telegram Rate-Limit erreicht (429) — Nachricht verworfen');
      } else {
        this.log?.warn({ err: String(err) }, 'Telegram-Nachricht fehlgeschlagen');
      }
    });
  }

  stop(): void {
    this.enabled = false;
    if (this.eventHandler) {
      this.eventBus.offAny(this.eventHandler);
    }
    this.bot.stopPolling();
    this.log?.info('Telegram Gateway gestoppt');
  }
}

function formatUptime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return 'unknown';
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}
