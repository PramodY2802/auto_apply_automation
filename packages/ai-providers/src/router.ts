import { z } from 'zod';
import type { AIProviderKey, AITask } from '@autoapply/shared';
import { AnthropicAdapter, GeminiAdapter, MockAIAdapter, OpenAIAdapter, type FetchLike } from './adapters';
import {
  AIProviderError,
  type AICompletionRequest,
  type AICompletionResult,
  type AIConfigSource,
  type AIProviderInterface,
  type AIRequestContext,
  type ResolvedAIConfig,
} from './types';

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------
export type ProviderFactory = (apiKey: string | null, baseUrl?: string | null) => AIProviderInterface;

export class AIProviderRegistry {
  private readonly factories = new Map<AIProviderKey, ProviderFactory>();

  register(key: AIProviderKey, factory: ProviderFactory): this {
    this.factories.set(key, factory);
    return this;
  }

  has(key: AIProviderKey): boolean {
    return this.factories.has(key);
  }

  create(key: AIProviderKey, apiKey: string | null, baseUrl?: string | null): AIProviderInterface {
    const f = this.factories.get(key);
    if (!f) throw new AIProviderError('NOT_CONFIGURED', `No adapter registered for provider "${key}"`, key);
    return f(apiKey, baseUrl);
  }

  keys(): AIProviderKey[] {
    return [...this.factories.keys()];
  }

  static withDefaults(opts: { fetchImpl?: FetchLike; allowMock?: boolean; mock?: MockAIAdapter } = {}): AIProviderRegistry {
    const f = opts.fetchImpl ?? fetch;
    const r = new AIProviderRegistry()
      .register('openai', (k, b) => new OpenAIAdapter(k, b ?? undefined, f))
      .register('anthropic', (k, b) => new AnthropicAdapter(k, b ?? undefined, f))
      .register('gemini', (k, b) => new GeminiAdapter(k, b ?? undefined, f));
    if (opts.allowMock) {
      const mock = opts.mock ?? new MockAIAdapter();
      r.register('mock', () => mock);
    }
    return r;
  }
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------
export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

export class AICostCalculator {
  constructor(private readonly prices: Map<string, ModelPrice> = new Map()) {}

  static key(provider: string, model: string): string {
    return `${provider}:${model}`;
  }

  setPrice(provider: string, model: string, price: ModelPrice): void {
    this.prices.set(AICostCalculator.key(provider, model), price);
  }

  /** USD cost, rounded to 6 dp. Unknown models cost 0 and are flagged by `known: false`. */
  calculate(provider: string, model: string, inputTokens: number, outputTokens: number): { costUsd: number; known: boolean } {
    const p = this.prices.get(AICostCalculator.key(provider, model));
    if (!p) return { costUsd: 0, known: false };
    const cost = (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M;
    return { costUsd: Math.round(cost * 1e6) / 1e6, known: true };
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
export interface RoutedCompletion extends AICompletionResult {
  configId: string | null;
  scope: ResolvedAIConfig['scope'];
  costUsd: number;
  usageLogId: string | null;
  fallbackFrom?: string;
}

export function modelForTask(cfg: ResolvedAIConfig, task: AITask): string {
  return cfg.taskModels[task] ?? cfg.defaultModel;
}

/**
 * Selects the provider configuration for a request and executes it.
 *
 * Rules:
 *  1. The first enabled config returned by the source wins (the source applies
 *     USER → ENTERPRISE → PLATFORM precedence and subscription policy).
 *  2. Fallback is only attempted when that config has allowFallback=true, only
 *     to providers listed in its fallbackProviderKeys, and only using configs of
 *     the SAME scope/owner — we never silently switch a user's request onto a
 *     different payer's credentials.
 *  3. Monthly token limits are checked before each call.
 */
export class AIProviderRouter {
  constructor(
    private readonly registry: AIProviderRegistry,
    private readonly source: AIConfigSource,
    private readonly cost: AICostCalculator,
  ) {}

  async resolve(ctx: AIRequestContext): Promise<{ primary: ResolvedAIConfig; fallbacks: ResolvedAIConfig[] }> {
    const configs = (await this.source.resolveConfigs(ctx)).filter((c) => c.enabled && this.registry.has(c.providerKey));
    const primary = configs[0];
    if (!primary) throw new AIProviderError('NOT_CONFIGURED', 'No AI provider is configured for this account');
    const fallbacks = primary.allowFallback
      ? primary.fallbackProviderKeys
          .map((k) => configs.find((c) => c.providerKey === k && c.scope === primary.scope && c.enterpriseId === primary.enterpriseId && c.userId === primary.userId))
          .filter((c): c is ResolvedAIConfig => !!c && c !== primary)
      : [];
    return { primary, fallbacks };
  }

  async complete(ctx: AIRequestContext, req: Omit<AICompletionRequest, 'model'> & { model?: string }): Promise<RoutedCompletion> {
    const { primary, fallbacks } = await this.resolve(ctx);
    const chain = [primary, ...fallbacks];
    let lastErr: unknown;
    for (let i = 0; i < chain.length; i++) {
      const cfg = chain[i]!;
      const model = i === 0 && req.model ? req.model : modelForTask(cfg, ctx.task);
      try {
        return await this.execute(ctx, cfg, { ...req, model }, i > 0 ? primary.providerKey : undefined);
      } catch (err) {
        lastErr = err;
        // Only fail over on availability problems, never on policy/limit/validation errors.
        const retryable = err instanceof AIProviderError && (err.retryable || err.code === 'AUTH');
        if (!retryable) break;
      }
    }
    throw lastErr;
  }

  private async execute(ctx: AIRequestContext, cfg: ResolvedAIConfig, req: AICompletionRequest, fallbackFrom?: string): Promise<RoutedCompletion> {
    if (cfg.monthlyTokenLimit != null && cfg.configId) {
      const used = await this.source.monthlyTokensUsed(cfg.configId);
      if (used >= cfg.monthlyTokenLimit) {
        throw new AIProviderError('LIMIT_EXCEEDED', `Monthly AI token limit reached for ${cfg.scope.toLowerCase()} configuration`, cfg.providerKey);
      }
    }
    const provider = this.registry.create(cfg.providerKey, cfg.apiKey, cfg.baseUrl);
    const started = Date.now();
    try {
      const res = await provider.complete(req);
      const { costUsd } = this.cost.calculate(cfg.providerKey, res.model, res.usage.inputTokens, res.usage.outputTokens);
      const usageLogId = await this.source.recordUsage({
        userId: ctx.userId,
        enterpriseId: ctx.enterpriseId,
        configId: cfg.configId,
        scope: cfg.scope,
        provider: cfg.providerKey,
        model: res.model,
        task: ctx.task,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        costUsd,
        latencyMs: res.latencyMs,
        status: 'ok',
        fallbackFrom,
      });
      return { ...res, configId: cfg.configId, scope: cfg.scope, costUsd, usageLogId, fallbackFrom };
    } catch (err) {
      await this.source.recordUsage({
        userId: ctx.userId,
        enterpriseId: ctx.enterpriseId,
        configId: cfg.configId,
        scope: cfg.scope,
        provider: cfg.providerKey,
        model: req.model,
        task: ctx.task,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - started,
        status: 'error',
        errorCode: err instanceof AIProviderError ? err.code : 'UNKNOWN',
        fallbackFrom,
      });
      throw err;
    }
  }

  /**
   * Structured generation: asks for JSON matching the zod schema, validates it,
   * and performs one repair round-trip on validation failure.
   */
  async generateStructured<T extends z.ZodTypeAny>(
    ctx: AIRequestContext,
    schema: T,
    req: { system: string; prompt: string; schemaName: string; maxTokens?: number; mockResponse?: string },
  ): Promise<{ data: z.infer<T>; completion: RoutedCompletion }> {
    const jsonSchema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    const messages: AICompletionRequest['messages'] = [{ role: 'user', content: req.prompt }];
    let completion = await this.complete(ctx, {
      system: req.system,
      messages,
      maxTokens: req.maxTokens,
      jsonSchema: { name: req.schemaName, schema: jsonSchema },
      temperature: 0,
      mockResponse: req.mockResponse,
    });
    let parsed = parseJsonLoose(completion.text);
    let result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      completion = await this.complete(ctx, {
        system: req.system,
        messages: [...messages, { role: 'assistant', content: completion.text }, { role: 'user', content: `Your JSON failed validation: ${issues}. Return only the corrected JSON object.` }],
        maxTokens: req.maxTokens,
        jsonSchema: { name: req.schemaName, schema: jsonSchema },
        temperature: 0,
        mockResponse: req.mockResponse,
      });
      parsed = parseJsonLoose(completion.text);
      result = schema.safeParse(parsed);
      if (!result.success) {
        throw new AIProviderError('BAD_RESPONSE', `AI output failed schema validation: ${result.error.issues[0]?.message ?? 'invalid'}`, completion.provider);
      }
    }
    return { data: result.data, completion };
  }
}

/** Extract a JSON object from model text (tolerates code fences / leading prose). */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
