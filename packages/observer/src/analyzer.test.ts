import { describe, it, expect, vi } from 'vitest';
import { parseModelResponse, analyzeProbes } from './analyzer.js';
import type { ProbeResult } from './system-probes.js';
import type { OllamaClient } from './ollama-client.js';

describe('parseModelResponse', () => {
  it('parses direct JSON', () => {
    const raw = '{"findings":[{"severity":"warning","category":"disk","message":"95% full"}]}';
    const findings = parseModelResponse(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('warning');
    expect(findings[0]!.category).toBe('disk');
  });

  it('extracts JSON from markdown-wrapped response', () => {
    const raw = '```json\n{"findings":[{"severity":"info","category":"updates","message":"12 pkgs"}]}\n```';
    const findings = parseModelResponse(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.category).toBe('updates');
  });

  it('extracts JSON from verbose prose response', () => {
    const raw = 'Here are my findings:\n\n{"findings":[{"severity":"error","category":"services","message":"nginx failed"}]}\n\nThat is all.';
    const findings = parseModelResponse(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseModelResponse('not json at all')).toEqual([]);
    expect(parseModelResponse('')).toEqual([]);
  });

  it('returns empty array for missing findings key', () => {
    expect(parseModelResponse('{"other":"data"}')).toEqual([]);
  });

  it('drops findings with invalid severity', () => {
    const raw = '{"findings":[{"severity":"superbad","category":"x","message":"y"}]}';
    expect(parseModelResponse(raw)).toEqual([]);
  });

  it('drops findings with missing required fields', () => {
    const raw = '{"findings":[{"severity":"info","message":"no category"}]}';
    expect(parseModelResponse(raw)).toEqual([]);
  });

  it('truncates overly long messages', () => {
    const longMsg = 'x'.repeat(2000);
    const raw = `{"findings":[{"severity":"info","category":"test","message":"${longMsg}"}]}`;
    const findings = parseModelResponse(raw);
    expect(findings[0]!.message.length).toBeLessThanOrEqual(1000);
  });

  it('normalizes suggested_action and evidence', () => {
    const raw = '{"findings":[{"severity":"info","category":"test","message":"m","evidence":"e","suggested_action":"s"}]}';
    const findings = parseModelResponse(raw);
    expect(findings[0]!.evidence).toBe('e');
    expect(findings[0]!.suggested_action).toBe('s');
  });

  it('defaults auto_fix_available to false', () => {
    const raw = '{"findings":[{"severity":"info","category":"test","message":"m"}]}';
    const findings = parseModelResponse(raw);
    expect(findings[0]!.auto_fix_available).toBe(false);
  });
});

describe('analyzeProbes', () => {
  function mockOllama(response: string): OllamaClient {
    return {
      chat: vi.fn().mockResolvedValue(response),
      isModelAvailable: vi.fn().mockResolvedValue(true),
    } as unknown as OllamaClient;
  }

  const sampleProbes: ProbeResult[] = [
    {
      id: 'disk-usage',
      category: 'disk',
      command: 'df -h',
      output: '/dev/sda1  100G  95G  5G  95%  /',
      error: null,
      duration_ms: 42,
      truncated: false,
    },
  ];

  it('returns report with findings from model', async () => {
    const ollama = mockOllama('{"findings":[{"severity":"warning","category":"disk","message":"95% full"}]}');
    const report = await analyzeProbes(ollama, 'qwen3.5:4b', sampleProbes, 'test-node');

    expect(report.node).toBe('test-node');
    expect(report.model).toBe('qwen3.5:4b');
    expect(report.checks_run).toBe(1);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]!.severity).toBe('warning');
    expect(report.raw_error).toBeUndefined();
  });

  it('returns report with raw_error when model call fails', async () => {
    const ollama = {
      chat: vi.fn().mockRejectedValue(new Error('Connection refused')),
      isModelAvailable: vi.fn(),
    } as unknown as OllamaClient;

    const report = await analyzeProbes(ollama, 'qwen3.5:4b', sampleProbes, 'test-node');
    expect(report.findings).toEqual([]);
    expect(report.raw_error).toContain('Connection refused');
  });

  it('returns empty findings when model says nothing is wrong', async () => {
    const ollama = mockOllama('{"findings":[]}');
    const report = await analyzeProbes(ollama, 'qwen3.5:4b', sampleProbes, 'test-node');
    expect(report.findings).toEqual([]);
    expect(report.raw_error).toBeUndefined();
  });

  it('includes timestamp in ISO 8601 format', async () => {
    const ollama = mockOllama('{"findings":[]}');
    const report = await analyzeProbes(ollama, 'qwen3.5:4b', sampleProbes, 'test-node');
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('handles probe errors gracefully in prompt', async () => {
    const probesWithError: ProbeResult[] = [
      {
        id: 'user-cron',
        category: 'cron',
        command: 'crontab -l',
        output: '',
        error: 'no crontab for user',
        duration_ms: 10,
        truncated: false,
      },
    ];
    const ollama = mockOllama('{"findings":[]}');
    const report = await analyzeProbes(ollama, 'qwen3.5:4b', probesWithError, 'test-node');
    expect(report.checks_run).toBe(1);
    expect(report.findings).toEqual([]);
  });
});
