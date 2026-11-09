import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { modelForTask } from '@autoapply/ai-providers';
import { aiProviderConfigs, aiProviders, aiUsageLogs, and, desc, eq, gte, isNull, sql, type SQL } from '@autoapply/database';
import { DomainError, type Actor } from '@autoapply/services';
import { AI_CONFIG_SCOPES, AI_TASKS, aiProviderConfigInputSchema, type AIConfigScope, type AIProviderConfigInput } from '@autoapply/shared';
import { ApiZodBody, Auth, InjectContainer, RequirePermissions, ZodPipe, actorOf, parseUuid, type AuthContext, type Container } from '../../common/core';

type ConfigRow = typeof aiProviderConfigs.$inferSelect;

function sanitize(r: ConfigRow) {
  const { encryptedApiKey: _k, ...rest } = r;
  return { ...rest, hasApiKey: !!r.encryptedApiKey };
}

@ApiTags('ai')
@Controller({ path: 'ai', version: '1' })
export class AiController {
  constructor(@InjectContainer() private readonly c: Container) {}

  /** Owner filter + permission check for a scope. */
  private async scopeOwner(a: AuthContext, scope: AIConfigScope): Promise<{ where: SQL; owner: { enterpriseId: string | null; userId: string | null } }> {
    if (scope === 'PLATFORM') {
      if (!a.permissions.has('admin:ai:configure')) throw new DomainError('FORBIDDEN', 'Only Super Admins can manage platform AI providers');
      return { where: and(eq(aiProviderConfigs.scope, 'PLATFORM'), isNull(aiProviderConfigs.enterpriseId), isNull(aiProviderConfigs.userId))!, owner: { enterpriseId: null, userId: null } };
    }
    if (scope === 'ENTERPRISE') {
      if (!a.enterpriseId || !a.permissions.has('enterprise:ai:configure')) throw new DomainError('FORBIDDEN', 'Only enterprise admins can manage enterprise AI providers');
      return { where: and(eq(aiProviderConfigs.scope, 'ENTERPRISE'), eq(aiProviderConfigs.enterpriseId, a.enterpriseId))!, owner: { enterpriseId: a.enterpriseId, userId: null } };
    }
    if (!a.permissions.has('ai:configure:user')) throw new DomainError('FORBIDDEN', 'Not allowed');
    return { where: and(eq(aiProviderConfigs.scope, 'USER'), eq(aiProviderConfigs.userId, a.userId))!, owner: { enterpriseId: null, userId: a.userId } };
  }

  private async ownedConfig(a: AuthContext, id: string): Promise<ConfigRow> {
    const [row] = await this.c.db.select().from(aiProviderConfigs).where(eq(aiProviderConfigs.id, parseUuid(id)));
    if (!row) throw new DomainError('NOT_FOUND', 'Configuration not found');
    const { where } = await this.scopeOwner(a, row.scope);
    const [mine] = await this.c.db.select({ id: aiProviderConfigs.id }).from(aiProviderConfigs).where(and(where, eq(aiProviderConfigs.id, row.id)));
    if (!mine) throw new DomainError('NOT_FOUND', 'Configuration not found');
    return row;
  }

  @Get('providers')
  async providers() {
    const rows = await this.c.db.select().from(aiProviders);
    const allowMock = await this.c.settings.get<boolean>('ai.allowMockProvider', process.env.NODE_ENV !== 'production');
    return rows.filter((p) => p.key !== 'mock' || allowMock).map((p) => ({ key: p.key, name: p.name, enabled: p.enabled, models: p.models }));
  }

  @Get('configs')
  async list(@Auth() a: AuthContext, @Query('scope') scopeRaw = 'USER') {
    const scope = z.enum(AI_CONFIG_SCOPES).parse(scopeRaw);
    const { where } = await this.scopeOwner(a, scope);
    return (await this.c.db.select().from(aiProviderConfigs).where(where).orderBy(desc(aiProviderConfigs.isActive), aiProviderConfigs.providerKey)).map(sanitize);
  }

  @Post('configs')
  @ApiZodBody(aiProviderConfigInputSchema)
  async upsert(@Auth() a: AuthContext, @Body(new ZodPipe(aiProviderConfigInputSchema.extend({ scope: z.enum(AI_CONFIG_SCOPES).default('USER') }))) body: AIProviderConfigInput & { scope: AIConfigScope }) {
    const { where, owner } = await this.scopeOwner(a, body.scope);
    if (body.scope === 'USER') {
      await this.c.usage.assertFeature(actorOf(a), 'byoAiKey');
      if (a.enterpriseId) {
        const r = await this.c.db.execute(sql`select settings from enterprises where id = ${a.enterpriseId}`);
        if ((r.rows[0] as any)?.settings?.allowUserAiKeys !== true) throw new DomainError('FORBIDDEN', 'Your enterprise does not allow personal AI keys');
      }
    }
    const [provider] = await this.c.db.select().from(aiProviders).where(eq(aiProviders.key, body.providerKey));
    if (!provider || !provider.enabled) throw new DomainError('INVALID', 'Provider is not available');
    if (body.providerKey === 'mock' && !(await this.c.settings.get<boolean>('ai.allowMockProvider', process.env.NODE_ENV !== 'production'))) throw new DomainError('INVALID', 'Mock provider is disabled');
    const models = new Set(provider.models.map((m) => m.id));
    for (const m of [body.defaultModel, ...Object.values(body.taskModels)]) if (m && !models.has(m)) throw new DomainError('INVALID', `Model "${m}" is not offered for ${provider.name}`);
    const existing = await this.c.db.select().from(aiProviderConfigs).where(where);
    const prior = existing.find((e) => e.providerKey === body.providerKey);
    if (!body.apiKey && !prior?.encryptedApiKey && body.providerKey !== 'mock') throw new DomainError('INVALID', 'An API key is required');
    const values = {
      scope: body.scope,
      enterpriseId: owner.enterpriseId,
      userId: owner.userId,
      providerKey: body.providerKey,
      encryptedApiKey: body.apiKey ? this.c.box.encrypt(body.apiKey) : (prior?.encryptedApiKey ?? null),
      apiKeyLast4: body.apiKey ? body.apiKey.slice(-4) : (prior?.apiKeyLast4 ?? null),
      defaultModel: body.defaultModel,
      taskModels: body.taskModels,
      fallbackProviderKeys: body.fallbackProviderKeys.filter((k) => k !== body.providerKey),
      allowFallback: body.allowFallback,
      monthlyTokenLimit: body.monthlyTokenLimit,
      enabled: body.enabled,
      isActive: prior?.isActive ?? existing.length === 0,
    };
    const [row] = prior
      ? await this.c.db.update(aiProviderConfigs).set(values).where(eq(aiProviderConfigs.id, prior.id)).returning()
      : await this.c.db.insert(aiProviderConfigs).values(values).returning();
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: owner.enterpriseId, action: 'ai.config.upsert', targetType: 'ai_config', targetId: row!.id, metadata: { scope: body.scope, provider: body.providerKey, keyChanged: !!body.apiKey } });
    return sanitize(row!);
  }

  @Post('configs/:id/activate')
  @HttpCode(200)
  async activate(@Auth() a: AuthContext, @Param('id') id: string) {
    const row = await this.ownedConfig(a, id);
    const { where } = await this.scopeOwner(a, row.scope);
    await this.c.db.transaction(async (tx) => {
      await tx.update(aiProviderConfigs).set({ isActive: false }).where(where);
      await tx.update(aiProviderConfigs).set({ isActive: true, enabled: true }).where(eq(aiProviderConfigs.id, row.id));
    });
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: row.enterpriseId, action: 'ai.config.activate', targetType: 'ai_config', targetId: row.id });
    return { ok: true };
  }

  @Delete('configs/:id')
  @HttpCode(204)
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    const row = await this.ownedConfig(a, id);
    await this.c.db.delete(aiProviderConfigs).where(eq(aiProviderConfigs.id, row.id));
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: row.enterpriseId, action: 'ai.config.delete', targetType: 'ai_config', targetId: row.id });
  }

  @Post('configs/:id/health')
  @HttpCode(200)
  async health(@Auth() a: AuthContext, @Param('id') id: string) {
    const row = await this.ownedConfig(a, id);
    const [p] = await this.c.db.select().from(aiProviders).where(eq(aiProviders.key, row.providerKey));
    const provider = this.c.ai.registry.create(row.providerKey as any, row.encryptedApiKey ? this.c.box.decrypt(row.encryptedApiKey) : null, p?.baseUrl);
    const r = await provider.healthCheck(row.defaultModel);
    const lastHealth = { ...r, at: new Date().toISOString() };
    await this.c.db.update(aiProviderConfigs).set({ lastHealth }).where(eq(aiProviderConfigs.id, row.id));
    return lastHealth;
  }

  /** Which provider/model would serve each task for the caller — transparency, no secrets. */
  @Get('effective')
  async effective(@Auth() a: AuthContext) {
    const actor: Actor = actorOf(a);
    const out: Record<string, { provider: string; model: string; scope: string } | null> = {};
    for (const task of AI_TASKS) {
      try {
        const { primary } = await this.c.ai.router.resolve({ ...actor, task });
        out[task] = { provider: primary.providerKey, model: modelForTask(primary, task), scope: primary.scope };
      } catch {
        out[task] = null;
      }
    }
    return out;
  }

  @Get('usage')
  async usage(@Auth() a: AuthContext, @Query('scope') scopeRaw = 'USER', @Query('days') daysRaw = '30') {
    const scope = z.enum(AI_CONFIG_SCOPES).parse(scopeRaw);
    const days = Math.min(365, Math.max(1, Number(daysRaw) || 30));
    let owner: SQL;
    if (scope === 'PLATFORM') {
      if (!a.permissions.has('admin:billing:read')) throw new DomainError('FORBIDDEN', 'Not allowed');
      owner = sql`true`;
    } else if (scope === 'ENTERPRISE') {
      if (!a.enterpriseId || !a.permissions.has('enterprise:read')) throw new DomainError('FORBIDDEN', 'Not allowed');
      owner = eq(aiUsageLogs.enterpriseId, a.enterpriseId);
    } else owner = eq(aiUsageLogs.userId, a.userId);
    const where = and(owner, gte(aiUsageLogs.createdAt, new Date(Date.now() - days * 86_400_000)));
    const byModel = await this.c.db
      .select({
        provider: aiUsageLogs.provider,
        model: aiUsageLogs.model,
        scope: aiUsageLogs.scope,
        requests: sql<number>`count(*)::int`,
        errors: sql<number>`sum(case when ${aiUsageLogs.status} = 'error' then 1 else 0 end)::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens}),0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsageLogs.outputTokens}),0)::int`,
        costUsd: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}),0)`,
      })
      .from(aiUsageLogs)
      .where(where)
      .groupBy(aiUsageLogs.provider, aiUsageLogs.model, aiUsageLogs.scope);
    const byTask = await this.c.db
      .select({ task: aiUsageLogs.task, requests: sql<number>`count(*)::int`, tokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens} + ${aiUsageLogs.outputTokens}),0)::int`, costUsd: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}),0)` })
      .from(aiUsageLogs)
      .where(where)
      .groupBy(aiUsageLogs.task);
    const daily = await this.c.db
      .select({ day: sql<string>`to_char(date_trunc('day', ${aiUsageLogs.createdAt}), 'YYYY-MM-DD')`, tokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens} + ${aiUsageLogs.outputTokens}),0)::int`, costUsd: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}),0)` })
      .from(aiUsageLogs)
      .where(where)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const totalCost = byModel.reduce((s, r) => s + Number(r.costUsd), 0);
    return { scope, days, totalCostUsd: Math.round(totalCost * 1e6) / 1e6, byModel: byModel.map((r) => ({ ...r, costUsd: Number(r.costUsd) })), byTask: byTask.map((r) => ({ ...r, costUsd: Number(r.costUsd) })), daily: daily.map((d) => ({ ...d, costUsd: Number(d.costUsd) })) };
  }
}

@ApiTags('admin')
@RequirePermissions('admin:ai:configure')
@Controller({ path: 'admin/ai/providers', version: '1' })
export class AdminAiProvidersController {
  constructor(@InjectContainer() private readonly c: Container) {}

  @Put(':key')
  async update(
    @Auth() a: AuthContext,
    @Param('key') key: string,
    @Body(new ZodPipe(z.object({ enabled: z.boolean().optional(), baseUrl: z.string().url().nullable().optional(), models: z.array(z.object({ id: z.string().min(1).max(120), label: z.string().min(1).max(120), inputPer1M: z.number().min(0), outputPer1M: z.number().min(0) })).optional() })))
    body: { enabled?: boolean; baseUrl?: string | null; models?: { id: string; label: string; inputPer1M: number; outputPer1M: number }[] },
  ) {
    const [row] = await this.c.db.update(aiProviders).set(body).where(eq(aiProviders.key, key)).returning();
    if (!row) throw new DomainError('NOT_FOUND', 'Provider not found');
    await this.c.ai.loadPrices(true);
    await this.c.audit.log({ actorUserId: a.userId, action: 'ai.provider.update', targetType: 'ai_provider', targetId: key, metadata: { enabled: body.enabled, models: body.models?.length } });
    return row;
  }
}
