import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AICostCalculator,
  AIProviderError,
  AIProviderRegistry,
  AIProviderRouter,
  AnthropicAdapter,
  GeminiAdapter,
  InMemoryAIConfigSource,
  MockAIAdapter,
  OpenAIAdapter,
  parseJsonLoose,
  type ResolvedAIConfig,
} from './index';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const base: Omit<ResolvedAIConfig, 'providerKey' | 'scope' | 'configId'> = {
  enterpriseId: null,
  userId: null,
  apiKey: 'test-key-123456',
  defaultModel: 'm-default',
  taskModels: {},
  allowFallback: false,
  fallbackProviderKeys: [],
  monthlyTokenLimit: null,
  enabled: true,
};

describe('adapters', () => {
  it('OpenAI sends bearer auth and json_schema response format', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ model: 'gpt-x', choices: [{ message: { content: '{"a":1}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    );
    const a = new OpenAIAdapter('sk-secret', undefined, fetchImpl as any);
    const r = await a.complete({ model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }], jsonSchema: { name: 's', schema: { type: 'object' } } });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init!.headers as any).authorization).toBe('Bearer sk-secret');
    expect(JSON.parse(init!.body as string).response_format.type).toBe('json_schema');
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('Anthropic uses x-api-key and parses text blocks', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ model: 'c', content: [{ type: 'text', text: 'hello' }], usage: { input_tokens: 3, output_tokens: 1 }, stop_reason: 'end_turn' }));
    const r = await new AnthropicAdapter('ak', undefined, fetchImpl as any).complete({ model: 'c', system: 'sys', messages: [{ role: 'user', content: 'x' }] });
    const init = (fetchImpl.mock.calls[0] as any)[1];
    expect(init.headers['x-api-key']).toBe('ak');
    expect(JSON.parse(init.body).system).toBe('sys');
    expect(r.text).toBe('hello');
  });

  it('Gemini keeps the API key out of the URL', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 } }));
    await new GeminiAdapter('AIzaSecret', undefined, fetchImpl as any).complete({ model: 'gemini-2.5-flash', messages: [{ role: 'user', content: 'x' }] });
    const [url, init] = fetchImpl.mock.calls[0] as any;
    expect(url).not.toContain('AIzaSecret');
    expect(init.headers['x-goog-api-key']).toBe('AIzaSecret');
  });

  it('maps HTTP errors to typed errors', async () => {
    const a = new OpenAIAdapter('k', undefined, (async () => jsonResponse({ error: 'x' }, 401)) as any);
    await expect(a.complete({ model: 'm', messages: [] })).rejects.toMatchObject({ code: 'AUTH' });
    const b = new OpenAIAdapter('k', undefined, (async () => jsonResponse({}, 429)) as any);
    await expect(b.complete({ model: 'm', messages: [] })).rejects.toMatchObject({ code: 'RATE_LIMIT', retryable: true });
  });

  it('fails clearly without an API key', async () => {
    await expect(new OpenAIAdapter(null).complete({ model: 'm', messages: [] })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});

describe('router', () => {
  const cost = new AICostCalculator();
  cost.setPrice('mock', 'm-default', { inputPer1M: 1, outputPer1M: 2 });

  it('prefers USER over ENTERPRISE over PLATFORM config', async () => {
    const mock = new MockAIAdapter(() => 'ok');
    const src = new InMemoryAIConfigSource([
      { ...base, configId: 'p', scope: 'PLATFORM', providerKey: 'mock' },
      { ...base, configId: 'e', scope: 'ENTERPRISE', enterpriseId: 'ent1', providerKey: 'mock' },
      { ...base, configId: 'u', scope: 'USER', userId: 'u1', providerKey: 'mock' },
    ]);
    const router = new AIProviderRouter(AIProviderRegistry.withDefaults({ allowMock: true, mock }), src, cost);
    expect((await router.complete({ userId: 'u1', enterpriseId: 'ent1', task: 'QUESTION_ANSWERING' }, { messages: [{ role: 'user', content: 'x' }] })).configId).toBe('u');
    expect((await router.complete({ userId: 'u2', enterpriseId: 'ent1', task: 'QUESTION_ANSWERING' }, { messages: [{ role: 'user', content: 'x' }] })).configId).toBe('e');
    expect((await router.complete({ userId: 'u2', enterpriseId: null, task: 'QUESTION_ANSWERING' }, { messages: [{ role: 'user', content: 'x' }] })).configId).toBe('p');
    expect(src.usage).toHaveLength(3);
  });

  it('uses task-specific models', async () => {
    const mock = new MockAIAdapter(() => 'ok');
    const src = new InMemoryAIConfigSource([{ ...base, configId: 'p', scope: 'PLATFORM', providerKey: 'mock', taskModels: { RESUME_EXTRACTION: 'big-model' } }]);
    const router = new AIProviderRouter(AIProviderRegistry.withDefaults({ allowMock: true, mock }), src, cost);
    await router.complete({ userId: null, enterpriseId: null, task: 'RESUME_EXTRACTION' }, { messages: [{ role: 'user', content: 'x' }] });
    expect(mock.calls[0]!.model).toBe('big-model');
  });

  it('never falls back across scopes, and only when allowed', async () => {
    const failing = vi.fn(async () => new Response('down', { status: 503 }));
    const registry = AIProviderRegistry.withDefaults({ fetchImpl: failing as any, allowMock: true, mock: new MockAIAdapter(() => 'from-mock') });
    // User config on openai (down) with fallback to mock, but only a PLATFORM mock config exists → must NOT be used.
    const src = new InMemoryAIConfigSource([
      { ...base, configId: 'u', scope: 'USER', userId: 'u1', providerKey: 'openai', allowFallback: true, fallbackProviderKeys: ['mock'] },
      { ...base, configId: 'p', scope: 'PLATFORM', providerKey: 'mock' },
    ]);
    const router = new AIProviderRouter(registry, src, cost);
    await expect(router.complete({ userId: 'u1', enterpriseId: null, task: 'QUESTION_ANSWERING' }, { messages: [] })).rejects.toMatchObject({ code: 'UNAVAILABLE' });

    // Same-scope fallback is honoured.
    src.configs.push({ ...base, configId: 'u-mock', scope: 'USER', userId: 'u1', providerKey: 'mock' });
    const r = await router.complete({ userId: 'u1', enterpriseId: null, task: 'QUESTION_ANSWERING' }, { messages: [] });
    expect(r.text).toBe('from-mock');
    expect(r.fallbackFrom).toBe('openai');
  });

  it('enforces monthly token limits', async () => {
    const mock = new MockAIAdapter(() => 'x'.repeat(4000));
    const src = new InMemoryAIConfigSource([{ ...base, configId: 'p', scope: 'PLATFORM', providerKey: 'mock', monthlyTokenLimit: 500 }]);
    const router = new AIProviderRouter(AIProviderRegistry.withDefaults({ allowMock: true, mock }), src, cost);
    await router.complete({ userId: null, enterpriseId: null, task: 'COVER_LETTER' }, { messages: [{ role: 'user', content: 'go' }] });
    await expect(router.complete({ userId: null, enterpriseId: null, task: 'COVER_LETTER' }, { messages: [] })).rejects.toBeInstanceOf(AIProviderError);
  });

  it('throws NOT_CONFIGURED when nothing is set up', async () => {
    const router = new AIProviderRouter(AIProviderRegistry.withDefaults(), new InMemoryAIConfigSource([]), cost);
    await expect(router.complete({ userId: 'x', enterpriseId: null, task: 'JOB_ANALYSIS' }, { messages: [] })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('validates structured output and repairs once', async () => {
    const replies = ['{"name": 5}', '```json\n{"name":"Ada"}\n```'];
    const mock = new MockAIAdapter(() => replies.shift()!);
    const src = new InMemoryAIConfigSource([{ ...base, configId: 'p', scope: 'PLATFORM', providerKey: 'mock' }]);
    const router = new AIProviderRouter(AIProviderRegistry.withDefaults({ allowMock: true, mock }), src, cost);
    const { data } = await router.generateStructured({ userId: null, enterpriseId: null, task: 'JOB_ANALYSIS' }, z.object({ name: z.string() }), { system: 's', prompt: 'p', schemaName: 'x' });
    expect(data.name).toBe('Ada');
    expect(mock.calls).toHaveLength(2);
  });

  it('calculates cost', () => {
    expect(cost.calculate('mock', 'm-default', 1_000_000, 500_000)).toEqual({ costUsd: 2, known: true });
    expect(cost.calculate('mock', 'unknown', 10, 10).known).toBe(false);
  });

  it('parses loose JSON', () => {
    expect(parseJsonLoose('Sure! {"a": 1} hope that helps')).toEqual({ a: 1 });
    expect(parseJsonLoose('nope')).toBeUndefined();
  });
});
