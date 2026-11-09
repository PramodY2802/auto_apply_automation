import {
  AICostCalculator,
  AIProviderRegistry,
  AIProviderRouter,
  type AIConfigSource,
  type AIRequestContext,
  type AIUsageEntry,
  type ResolvedAIConfig,
} from '@autoapply/ai-providers';
import type { AnswerGenerator } from '@autoapply/answer-engine';
import { aiProviderConfigs, aiProviders, aiUsageLogs, and, eq, gte, isNull, sql, type Database } from '@autoapply/database';
import type { StructuredGenerator } from '@autoapply/document-extraction';
import { generatedAnswerSchema, extractedResumeSchema, type AIProviderKey, type AITask } from '@autoapply/shared';
import type { SecretBox } from './infra';
import { periodStart, UsageService, type Actor } from './platform';

type ConfigRow = typeof aiProviderConfigs.$inferSelect;

/**
 * Postgres-backed AIConfigSource implementing the configuration precedence:
 *   USER (own key; only if the plan allows BYO and the enterprise permits it)
 *   → ENTERPRISE (enterprise-managed)
 *   → PLATFORM (platform-managed; skipped when an enterprise disallows it).
 * Within a scope, the config marked is_active is primary; the others in that
 * same scope are the only candidates for fallback.
 */
export class DbAIConfigSource implements AIConfigSource {
  constructor(
    private readonly db: Database,
    private readonly box: SecretBox,
    private readonly usage: UsageService,
    private readonly opts: { allowMock: boolean },
  ) {}

  private resolve(row: ConfigRow, baseUrl: string | null): ResolvedAIConfig {
    return {
      configId: row.id,
      scope: row.scope,
      enterpriseId: row.enterpriseId,
      userId: row.userId,
      providerKey: row.providerKey as AIProviderKey,
      apiKey: row.encryptedApiKey ? this.box.decrypt(row.encryptedApiKey) : null,
      baseUrl,
      defaultModel: row.defaultModel,
      taskModels: row.taskModels as Partial<Record<AITask, string>>,
      allowFallback: row.allowFallback,
      fallbackProviderKeys: row.fallbackProviderKeys as AIProviderKey[],
      monthlyTokenLimit: row.monthlyTokenLimit,
      enabled: row.enabled,
    };
  }

  async resolveConfigs(ctx: AIRequestContext): Promise<ResolvedAIConfig[]> {
    const providers = await this.db.select().from(aiProviders);
    const enabledProviders = new Map(providers.filter((p) => p.enabled && (this.opts.allowMock || p.key !== 'mock')).map((p) => [p.key, p.baseUrl]));
    const usable = (r: ConfigRow) => r.enabled && enabledProviders.has(r.providerKey);
    const ordered = (rows: ConfigRow[]) => rows.filter(usable).sort((a, b) => Number(b.isActive) - Number(a.isActive));
    const out: ResolvedAIConfig[] = [];

    let entSettings: Record<string, unknown> = {};
    if (ctx.enterpriseId) {
      const r = await this.db.execute(sql`select settings from enterprises where id = ${ctx.enterpriseId}`);
      entSettings = ((r.rows[0] as any)?.settings ?? {}) as Record<string, unknown>;
    }

    if (ctx.userId) {
      const allowUserKeys = !ctx.enterpriseId || entSettings.allowUserAiKeys === true;
      if (allowUserKeys) {
        let byo = false;
        try {
          await this.usage.assertFeature({ userId: ctx.userId, enterpriseId: ctx.enterpriseId }, 'byoAiKey');
          byo = true;
        } catch {
          byo = false;
        }
        if (byo) {
          const rows = await this.db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.scope, 'USER'), eq(aiProviderConfigs.userId, ctx.userId)));
          for (const r of ordered(rows)) out.push(this.resolve(r, enabledProviders.get(r.providerKey) ?? null));
        }
      }
    }
    if (ctx.enterpriseId) {
      const rows = await this.db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.scope, 'ENTERPRISE'), eq(aiProviderConfigs.enterpriseId, ctx.enterpriseId)));
      for (const r of ordered(rows)) out.push(this.resolve(r, enabledProviders.get(r.providerKey) ?? null));
    }
    const platformAllowed = !ctx.enterpriseId || entSettings.allowPlatformAi !== false;
    if (platformAllowed) {
      const rows = await this.db.select().from(aiProviderConfigs).where(and(eq(aiProviderConfigs.scope, 'PLATFORM'), isNull(aiProviderConfigs.enterpriseId), isNull(aiProviderConfigs.userId)));
      for (const r of ordered(rows)) out.push(this.resolve(r, enabledProviders.get(r.providerKey) ?? null));
    }
    return out;
  }

  async monthlyTokensUsed(configId: string): Promise<number> {
    const [r] = await this.db
      .select({ t: sql<string>`coalesce(sum(${aiUsageLogs.inputTokens} + ${aiUsageLogs.outputTokens}),0)` })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.configId, configId), gte(aiUsageLogs.createdAt, periodStart())));
    return Number(r?.t ?? 0);
  }

  async recordUsage(e: AIUsageEntry): Promise<string | null> {
    const [row] = await this.db
      .insert(aiUsageLogs)
      .values({
        userId: e.userId,
        enterpriseId: e.enterpriseId,
        configId: e.configId,
        scope: e.scope,
        provider: e.provider,
        model: e.model,
        task: e.task,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        costUsd: e.costUsd.toFixed(6),
        latencyMs: e.latencyMs,
        status: e.status,
        errorCode: e.errorCode ?? null,
        fallbackFrom: e.fallbackFrom ?? null,
      })
      .returning({ id: aiUsageLogs.id });
    // Platform-managed tokens count against the subscription's AI token allowance.
    if (e.status === 'ok' && e.scope === 'PLATFORM' && e.userId) {
      await this.usage.record({ userId: e.userId, enterpriseId: e.enterpriseId }, 'AI_TOKENS', e.inputTokens + e.outputTokens, { sourceId: row!.id, costUsd: e.costUsd });
    }
    return row?.id ?? null;
  }
}

export interface AIServiceDeps {
  db: Database;
  box: SecretBox;
  usage: UsageService;
  allowMock: boolean;
  registry?: AIProviderRegistry;
}

/** Facade used by the API and workers. */
export class AIService {
  readonly router: AIProviderRouter;
  readonly registry: AIProviderRegistry;
  readonly cost = new AICostCalculator();
  private pricesLoadedAt = 0;

  constructor(private readonly deps: AIServiceDeps) {
    this.registry = deps.registry ?? AIProviderRegistry.withDefaults({ allowMock: deps.allowMock });
    const source = new DbAIConfigSource(deps.db, deps.box, deps.usage, { allowMock: deps.allowMock });
    this.router = new AIProviderRouter(this.registry, source, this.cost);
  }

  async loadPrices(force = false): Promise<void> {
    if (!force && Date.now() - this.pricesLoadedAt < 60_000) return;
    for (const p of await this.deps.db.select().from(aiProviders)) {
      for (const m of p.models) this.cost.setPrice(p.key, m.id, { inputPer1M: m.inputPer1M, outputPer1M: m.outputPer1M });
    }
    this.pricesLoadedAt = Date.now();
  }

  /** Whether any provider is configured for this actor (without calling it). */
  async isConfigured(actor: Actor, task: AITask): Promise<boolean> {
    try {
      await this.router.resolve({ userId: actor.userId, enterpriseId: actor.enterpriseId, task });
      return true;
    } catch {
      return false;
    }
  }

  async assertTokenAllowance(actor: Actor): Promise<void> {
    await this.deps.usage.assertWithin(actor, 'AI_TOKENS', 1);
  }

  resumeGenerator(actor: Actor): StructuredGenerator {
    return async ({ system, prompt, schemaName, maxTokens }) => {
      await this.loadPrices();
      const { data, completion } = await this.router.generateStructured({ userId: actor.userId, enterpriseId: actor.enterpriseId, task: 'RESUME_EXTRACTION' }, extractedResumeSchema, { system, prompt, schemaName, maxTokens });
      return { data, provider: completion.provider, model: completion.model };
    };
  }

  answerGenerator(actor: Actor, task: AITask = 'APPLICATION_ANSWER'): AnswerGenerator {
    return async ({ system, prompt }) => {
      await this.loadPrices();
      const { data, completion } = await this.router.generateStructured({ userId: actor.userId, enterpriseId: actor.enterpriseId, task }, generatedAnswerSchema, { system, prompt, schemaName: 'generated_answer', maxTokens: 1500 });
      return { data, usageLogId: completion.usageLogId, provider: completion.provider, model: completion.model };
    };
  }
}
