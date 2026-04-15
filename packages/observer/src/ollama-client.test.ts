import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaClient } from './ollama-client.js';

describe('OllamaClient', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('uses default baseUrl when none provided', () => {
    const c = new OllamaClient();
    expect(c).toBeDefined();
  });

  it('uses OLLAMA_HOST env var', () => {
    const origEnv = process.env['OLLAMA_HOST'];
    process.env['OLLAMA_HOST'] = 'http://custom:8080';
    const c = new OllamaClient();
    expect(c).toBeDefined();
    if (origEnv !== undefined) {
      process.env['OLLAMA_HOST'] = origEnv;
    } else {
      delete process.env['OLLAMA_HOST'];
    }
  });

  describe('isModelAvailable', () => {
    it('returns true when model is in tags list (exact name)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'qwen3.5:4b' }, { name: 'gemma4:e2b' }] }),
      } as Response);

      const c = new OllamaClient({ baseUrl: 'http://test:11434' });
      expect(await c.isModelAvailable('qwen3.5:4b')).toBe(true);
    });

    it('returns true when model matches by prefix', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'qwen3.5:4b-q4_K_M' }] }),
      } as Response);

      const c = new OllamaClient();
      expect(await c.isModelAvailable('qwen3.5:4b')).toBe(true);
    });

    it('returns false when model is not in tags', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: 'llama3:8b' }] }),
      } as Response);

      const c = new OllamaClient();
      expect(await c.isModelAvailable('qwen3.5:4b')).toBe(false);
    });

    it('returns false when Ollama is unreachable', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
      const c = new OllamaClient();
      expect(await c.isModelAvailable('qwen3.5:4b')).toBe(false);
    });

    it('returns false when API returns non-ok status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      } as Response);
      const c = new OllamaClient();
      expect(await c.isModelAvailable('qwen3.5:4b')).toBe(false);
    });
  });

  describe('chat', () => {
    it('sends correct request body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ model: 'qwen3.5:4b', message: { role: 'assistant', content: 'hello' }, done: true }),
      } as Response);
      global.fetch = mockFetch;

      const c = new OllamaClient({ baseUrl: 'http://test:11434' });
      const result = await c.chat('qwen3.5:4b', [{ role: 'user', content: 'hi' }]);

      expect(result).toBe('hello');
      expect(mockFetch).toHaveBeenCalled();
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('http://test:11434/api/chat');
      const body = JSON.parse((callArgs[1] as RequestInit).body as string);
      expect(body.model).toBe('qwen3.5:4b');
      expect(body.stream).toBe(false);
      expect(body.options.temperature).toBe(0.2);
    });

    it('throws on non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'internal error',
      } as Response);

      const c = new OllamaClient();
      await expect(
        c.chat('qwen3.5:4b', [{ role: 'user', content: 'hi' }]),
      ).rejects.toThrow(/500/);
    });

    it('returns empty string when message.content missing', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ model: 'x', message: {}, done: true }),
      } as Response);

      const c = new OllamaClient();
      const result = await c.chat('qwen3.5:4b', [{ role: 'user', content: 'hi' }]);
      expect(result).toBe('');
    });

    it('respects custom temperature and num_predict', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ model: 'x', message: { role: 'assistant', content: 'y' }, done: true }),
      } as Response);
      global.fetch = mockFetch;

      const c = new OllamaClient();
      await c.chat('x', [{ role: 'user', content: 'hi' }], { temperature: 0.9, num_predict: 500 });
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.options.temperature).toBe(0.9);
      expect(body.options.num_predict).toBe(500);
    });

    it('sends keep_alive parameter (default 1h)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ model: 'x', message: { role: 'assistant', content: 'y' }, done: true }),
      } as Response);
      global.fetch = mockFetch;

      const c = new OllamaClient();
      await c.chat('x', [{ role: 'user', content: 'hi' }]);
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.keep_alive).toBe('1h');
    });

    it('respects custom keepAlive', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ model: 'x', message: { role: 'assistant', content: 'y' }, done: true }),
      } as Response);
      global.fetch = mockFetch;

      const c = new OllamaClient({ keepAlive: '24h' });
      await c.chat('x', [{ role: 'user', content: 'hi' }]);
      const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
      expect(body.keep_alive).toBe('24h');
    });

    it('respects TLMCP_OBSERVER_KEEP_ALIVE env var', async () => {
      const orig = process.env['TLMCP_OBSERVER_KEEP_ALIVE'];
      process.env['TLMCP_OBSERVER_KEEP_ALIVE'] = '30m';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ model: 'x', message: { role: 'assistant', content: 'y' }, done: true }),
      } as Response);
      global.fetch = mockFetch;

      try {
        const c = new OllamaClient();
        await c.chat('x', [{ role: 'user', content: 'hi' }]);
        const body = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
        expect(body.keep_alive).toBe('30m');
      } finally {
        if (orig !== undefined) {
          process.env['TLMCP_OBSERVER_KEEP_ALIVE'] = orig;
        } else {
          delete process.env['TLMCP_OBSERVER_KEEP_ALIVE'];
        }
      }
    });
  });
});
