import type { AIProviderKey } from '@autoapply/shared';
import { AIProviderError, type AICompletionRequest, type AICompletionResult, type AIProviderInterface } from './types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT = 60_000;

async function httpJson(
  provider: AIProviderKey,
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<any> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new AIProviderError('TIMEOUT', `${provider} request timed out`, provider, true);
    }
    throw new AIProviderError('UNAVAILABLE', `${provider} network error: ${err?.message ?? 'unknown'}`, provider, true);
  }
  const bodyText = await res.text();
  if (!res.ok) {
    // Never include request headers (API keys) in errors; response bodies from providers don't echo keys.
    const snippet = bodyText.slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new AIProviderError('AUTH', `${provider} rejected the API key (${res.status})`, provider);
    if (res.status === 429) throw new AIProviderError('RATE_LIMIT', `${provider} rate limited the request`, provider, true);
    if (res.status >= 500) throw new AIProviderError('UNAVAILABLE', `${provider} server error ${res.status}`, provider, true);
    throw new AIProviderError('BAD_REQUEST', `${provider} returned ${res.status}: ${snippet}`, provider);
  }
  try {
    return JSON.parse(bodyText);
  } catch {
    throw new AIProviderError('BAD_RESPONSE', `${provider} returned non-JSON body`, provider);
  }
}

function requireKey(provider: AIProviderKey, key: string | null | undefined): string {
  if (!key) throw new AIProviderError('NOT_CONFIGURED', `${provider} API key is not configured`, provider);
  return key;
}

// ---------------------------------------------------------------------------
export class OpenAIAdapter implements AIProviderInterface {
  readonly key = 'openai' as const;
  constructor(
    private readonly apiKey: string | null,
    private readonly baseUrl = 'https://api.openai.com/v1',
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async complete(req: AICompletionRequest): Promise<AICompletionResult> {
    const key = requireKey(this.key, this.apiKey);
    const started = Date.now();
    const messages = [...(req.system ? [{ role: 'system', content: req.system }] : []), ...req.messages];
    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 2000,
      temperature: req.temperature ?? 0.2,
    };
    if (req.jsonSchema) {
      body.response_format = { type: 'json_schema', json_schema: { name: req.jsonSchema.name, schema: req.jsonSchema.schema, strict: false } };
    }
    const data = await httpJson(
      this.key,
      this.fetchImpl,
      `${this.baseUrl}/chat/completions`,
      { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body) },
      req.timeoutMs ?? DEFAULT_TIMEOUT,
    );
    const choice = data?.choices?.[0];
    if (!choice?.message) throw new AIProviderError('BAD_RESPONSE', 'OpenAI response missing choices', this.key);
    return {
      text: String(choice.message.content ?? ''),
      usage: { inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 },
      model: data.model ?? req.model,
      provider: this.key,
      latencyMs: Date.now() - started,
      finishReason: choice.finish_reason,
    };
  }

  async healthCheck(model: string) {
    const started = Date.now();
    try {
      await this.complete({ model, messages: [{ role: 'user', content: 'Reply with OK' }], maxTokens: 5, timeoutMs: 15_000 });
      return { ok: true, latencyMs: Date.now() - started };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - started, error: `${e.code ?? 'ERROR'}: ${e.message}` };
    }
  }
}

// ---------------------------------------------------------------------------
export class AnthropicAdapter implements AIProviderInterface {
  readonly key = 'anthropic' as const;
  constructor(
    private readonly apiKey: string | null,
    private readonly baseUrl = 'https://api.anthropic.com/v1',
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async complete(req: AICompletionRequest): Promise<AICompletionResult> {
    const key = requireKey(this.key, this.apiKey);
    const started = Date.now();
    let system = req.system ?? '';
    if (req.jsonSchema) {
      system += `\n\nRespond ONLY with a single JSON object (no prose, no code fences) that validates against this JSON Schema:\n${JSON.stringify(req.jsonSchema.schema)}`;
    }
    const body = {
      model: req.model,
      max_tokens: req.maxTokens ?? 2000,
      temperature: req.temperature ?? 0.2,
      system: system.trim() || undefined,
      messages: req.messages,
    };
    const data = await httpJson(
      this.key,
      this.fetchImpl,
      `${this.baseUrl}/messages`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      },
      req.timeoutMs ?? DEFAULT_TIMEOUT,
    );
    const text = Array.isArray(data?.content)
      ? data.content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text)
          .join('')
      : '';
    if (!Array.isArray(data?.content)) throw new AIProviderError('BAD_RESPONSE', 'Anthropic response missing content', this.key);
    return {
      text,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
      model: data.model ?? req.model,
      provider: this.key,
      latencyMs: Date.now() - started,
      finishReason: data.stop_reason,
    };
  }

  async healthCheck(model: string) {
    const started = Date.now();
    try {
      await this.complete({ model, messages: [{ role: 'user', content: 'Reply with OK' }], maxTokens: 5, timeoutMs: 15_000 });
      return { ok: true, latencyMs: Date.now() - started };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - started, error: `${e.code ?? 'ERROR'}: ${e.message}` };
    }
  }
}

// ---------------------------------------------------------------------------
export class GeminiAdapter implements AIProviderInterface {
  readonly key = 'gemini' as const;
  constructor(
    private readonly apiKey: string | null,
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async complete(req: AICompletionRequest): Promise<AICompletionResult> {
    const key = requireKey(this.key, this.apiKey);
    const started = Date.now();
    let system = req.system ?? '';
    if (req.jsonSchema) {
      system += `\n\nRespond ONLY with JSON that validates against this JSON Schema:\n${JSON.stringify(req.jsonSchema.schema)}`;
    }
    const body: Record<string, unknown> = {
      contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 2000,
        temperature: req.temperature ?? 0.2,
        ...(req.jsonSchema ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (system.trim()) body.systemInstruction = { parts: [{ text: system.trim() }] };
    const data = await httpJson(
      this.key,
      this.fetchImpl,
      `${this.baseUrl}/models/${encodeURIComponent(req.model)}:generateContent`,
      // API key in header (not the URL) so it never lands in proxy/access logs.
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body) },
      req.timeoutMs ?? DEFAULT_TIMEOUT,
    );
    const cand = data?.candidates?.[0];
    if (!cand) {
      const block = data?.promptFeedback?.blockReason;
      throw new AIProviderError(block ? 'POLICY' : 'BAD_RESPONSE', block ? `Gemini blocked the prompt: ${block}` : 'Gemini response missing candidates', this.key);
    }
    const text = (cand.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
    return {
      text,
      usage: { inputTokens: data.usageMetadata?.promptTokenCount ?? 0, outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0 },
      model: req.model,
      provider: this.key,
      latencyMs: Date.now() - started,
      finishReason: cand.finishReason,
    };
  }

  async healthCheck(model: string) {
    const started = Date.now();
    try {
      await this.complete({ model, messages: [{ role: 'user', content: 'Reply with OK' }], maxTokens: 5, timeoutMs: 15_000 });
      return { ok: true, latencyMs: Date.now() - started };
    } catch (e: any) {
      return { ok: false, latencyMs: Date.now() - started, error: `${e.code ?? 'ERROR'}: ${e.message}` };
    }
  }
}

// ---------------------------------------------------------------------------
/**
 * Development/test provider. It never pretends to be intelligent: it returns
 * scripted responses (request.mockResponse or a responder queue) and fails
 * loudly otherwise. Disabled in production by platform setting.
 */
export class MockAIAdapter implements AIProviderInterface {
  readonly key = 'mock' as const;
  readonly calls: AICompletionRequest[] = [];
  constructor(private readonly responder?: (req: AICompletionRequest) => string | Promise<string>) {}

  async complete(req: AICompletionRequest): Promise<AICompletionResult> {
    this.calls.push(req);
    const text = req.mockResponse ?? (this.responder ? await this.responder(req) : undefined);
    if (text === undefined) throw new AIProviderError('BAD_RESPONSE', 'Mock provider has no scripted response for this request', this.key);
    const inputTokens = Math.ceil(((req.system ?? '') + req.messages.map((m) => m.content).join('')).length / 4);
    return { text, usage: { inputTokens, outputTokens: Math.ceil(text.length / 4) }, model: req.model, provider: this.key, latencyMs: 1 };
  }

  async healthCheck() {
    return { ok: true, latencyMs: 0 };
  }
}
