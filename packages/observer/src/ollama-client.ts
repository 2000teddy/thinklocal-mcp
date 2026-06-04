/**
 * ollama-client.ts — Minimaler Ollama-Client fuer Observer-Agent
 *
 * Keine externen Dependencies. Nutzt den globalen fetch() von Node 22+.
 * Bewusst schlank gehalten — nur die 2 Endpoints die der Observer braucht:
 *   - /api/tags  (Modell-Liste — Health-Check)
 *   - /api/chat  (Analyse der Probe-Ergebnisse)
 */

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  eval_count?: number;
}

export interface OllamaClientOptions {
  /** Base URL, default: http://localhost:11434 */
  baseUrl?: string;
  /** Default request timeout in ms. Default: 300_000 (5 min — Cold-Load kann 20s+ brauchen) */
  timeoutMs?: number;
  /**
   * Keep-alive Dauer fuer das Modell im VRAM.
   * Default Observer: '1h' (statt Ollama-Default 5m).
   * Verhindert Cold-Load bei haeufigen Anfragen.
   * Siehe: https://github.com/ollama/ollama/blob/main/docs/api.md#parameters
   */
  keepAlive?: string;
}

export class OllamaClient {
  private baseUrl: string;
  private timeoutMs: number;
  private keepAlive: string;

  constructor(opts: OllamaClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? process.env['OLLAMA_HOST'] ?? 'http://localhost:11434';
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.keepAlive = opts.keepAlive ?? process.env['TLMCP_OBSERVER_KEEP_ALIVE'] ?? '1h';
  }

  /**
   * Prueft ob Ollama erreichbar ist und das Modell verfuegbar ist.
   */
  async isModelAvailable(model: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const data = await res.json() as { models?: Array<{ name: string }> };
      return (data.models ?? []).some(m =>
        m.name === model
        || m.name.startsWith(`${model}:`)
        || m.name.startsWith(`${model}-`),
      );
    } catch {
      return false;
    }
  }

  /**
   * Sendet einen Chat-Request an Ollama und liefert die Antwort.
   */
  async chat(
    model: string,
    messages: OllamaMessage[],
    options: { temperature?: number; num_predict?: number } = {},
  ): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        keep_alive: this.keepAlive,
        options: {
          temperature: options.temperature ?? 0.2,
          num_predict: options.num_predict ?? 2048,
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json() as OllamaChatResponse;
    return data.message?.content ?? '';
  }
}
