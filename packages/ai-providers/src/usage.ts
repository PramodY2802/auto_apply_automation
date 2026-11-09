import type { AIConfigSource, AIRequestContext, AIUsageEntry, ResolvedAIConfig } from './types';

/**
 * In-memory AIConfigSource + usage tracker. Used in tests and as a reference
 * implementation; the API ships a Postgres-backed implementation.
 */
export class InMemoryAIConfigSource implements AIConfigSource {
  readonly usage: (AIUsageEntry & { id: string; at: Date })[] = [];
  constructor(public configs: ResolvedAIConfig[] = []) {}

  async resolveConfigs(ctx: AIRequestContext): Promise<ResolvedAIConfig[]> {
    const user = this.configs.filter((c) => c.scope === 'USER' && c.userId === ctx.userId);
    const ent = this.configs.filter((c) => c.scope === 'ENTERPRISE' && ctx.enterpriseId && c.enterpriseId === ctx.enterpriseId);
    const plat = this.configs.filter((c) => c.scope === 'PLATFORM');
    return [...user, ...ent, ...plat];
  }

  async monthlyTokensUsed(configId: string): Promise<number> {
    const now = new Date();
    return this.usage
      .filter((u) => u.configId === configId && u.at.getUTCMonth() === now.getUTCMonth() && u.at.getUTCFullYear() === now.getUTCFullYear())
      .reduce((s, u) => s + u.inputTokens + u.outputTokens, 0);
  }

  async recordUsage(entry: AIUsageEntry): Promise<string> {
    const id = `usage-${this.usage.length + 1}`;
    this.usage.push({ ...entry, id, at: new Date() });
    return id;
  }
}

/** Aggregates usage entries into per-provider/model totals (for dashboards and billing). */
export class AIUsageTracker {
  static summarize(entries: Pick<AIUsageEntry, 'provider' | 'model' | 'inputTokens' | 'outputTokens' | 'costUsd' | 'status'>[]) {
    const byKey = new Map<string, { provider: string; model: string; requests: number; errors: number; inputTokens: number; outputTokens: number; costUsd: number }>();
    for (const e of entries) {
      const k = `${e.provider}:${e.model}`;
      const cur = byKey.get(k) ?? { provider: e.provider, model: e.model, requests: 0, errors: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
      cur.requests++;
      if (e.status === 'error') cur.errors++;
      cur.inputTokens += e.inputTokens;
      cur.outputTokens += e.outputTokens;
      cur.costUsd = Math.round((cur.costUsd + e.costUsd) * 1e6) / 1e6;
      byKey.set(k, cur);
    }
    return [...byKey.values()];
  }
}
