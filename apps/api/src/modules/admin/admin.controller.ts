import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  aiUsageLogs,
  and,
  applications,
  auditLogs,
  count,
  desc,
  enterpriseInvitations,
  enterpriseMembers,
  enterprises,
  eq,
  gte,
  ilike,
  invoices,
  jobDiscoveryRuns,
  jobs,
  jobSources,
  or,
  platformConnections,
  plans,
  sessions,
  sql,
  subscriptions,
  users,
} from '@autoapply/database';
import { DomainError, QUEUES, hashToken, randomToken } from '@autoapply/services';
import { adminUpdateUserSchema, createEnterpriseSchema, matchingWeightsSchema, planInputSchema, type PlanInput } from '@autoapply/shared';
import { ApiZodBody, Auth, InjectConfig, InjectContainer, RequirePermissions, ZodPipe, parseUuid, type AppConfig, type AuthContext, type Container } from '../../common/core';

const SETTINGS_SCHEMAS: Record<string, z.ZodTypeAny> = {
  'matching.weights': matchingWeightsSchema,
  'limits.global': z.object({ maxConcurrentBrowserSessions: z.number().int().min(1).max(64), maxApplicationsPerUserPerDay: z.number().int().min(0).max(500), discoveryMaxJobsPerPlatform: z.number().int().min(1).max(1000) }),
  'features.registrationOpen': z.boolean(),
  'ai.allowMockProvider': z.boolean(),
};

@ApiTags('admin')
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(@InjectContainer() private readonly c: Container, @InjectConfig() private readonly config: AppConfig) {}

  @Get('metrics')
  @RequirePermissions('admin:system:read')
  async metrics(@Auth() a: AuthContext) {
    const since30 = new Date(Date.now() - 30 * 86_400_000);
    const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
    const [totalUsers, activeUsers, totalEnterprises, activeSubs, jobsDiscovered, submitted, failed, needsVerification] = await Promise.all([
      n(this.c.db.select({ n: count() }).from(users).where(sql`${users.status} <> 'DELETED'`)),
      n(this.c.db.select({ n: count() }).from(users).where(gte(users.lastLoginAt, since30))),
      n(this.c.db.select({ n: count() }).from(enterprises)),
      n(this.c.db.select({ n: count() }).from(subscriptions).where(sql`${subscriptions.status} in ('ACTIVE','TRIALING')`)),
      n(this.c.db.select({ n: count() }).from(jobs)),
      n(this.c.db.select({ n: count() }).from(applications).where(eq(applications.status, 'APPLIED'))),
      n(this.c.db.select({ n: count() }).from(applications).where(eq(applications.status, 'FAILED'))),
      n(this.c.db.select({ n: count() }).from(applications).where(eq(applications.status, 'NEEDS_VERIFICATION'))),
    ]);
    const finance = a.permissions.has('admin:billing:read');
    let revenue = null;
    let ai = null;
    if (finance) {
      const rev = await this.c.db.select({ kind: invoices.kind, status: invoices.status, cents: sql<string>`coalesce(sum(${invoices.amountCents}),0)` }).from(invoices).groupBy(invoices.kind, invoices.status);
      const mrr = await this.c.db.execute(sql`select coalesce(sum(case when s.interval = 'ANNUAL' then p.price_annual_cents / 12.0 else p.price_monthly_cents end),0)::bigint as mrr from subscriptions s join plans p on p.id = s.plan_id where s.status in ('ACTIVE','PAST_DUE')`);
      revenue = { invoices: rev.map((r) => ({ ...r, cents: Number(r.cents) })), mrrCents: Number((mrr.rows[0] as any)?.mrr ?? 0) };
      const byProvider = await this.c.db
        .select({ provider: aiUsageLogs.provider, scope: aiUsageLogs.scope, requests: sql<number>`count(*)::int`, errors: sql<number>`sum(case when ${aiUsageLogs.status}='error' then 1 else 0 end)::int`, tokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens}+${aiUsageLogs.outputTokens}),0)::bigint`, cost: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}),0)` })
        .from(aiUsageLogs)
        .where(gte(aiUsageLogs.createdAt, since30))
        .groupBy(aiUsageLogs.provider, aiUsageLogs.scope);
      ai = { last30Days: byProvider.map((r) => ({ ...r, tokens: Number(r.tokens), costUsd: Number(r.cost) })) };
    }
    const queues = this.c.queues ? await this.c.queues.counts().catch(() => null) : null;
    const workers = await this.workerHeartbeats();
    const runs = await this.c.db.select({ status: jobDiscoveryRuns.status, n: count() }).from(jobDiscoveryRuns).where(gte(jobDiscoveryRuns.createdAt, since30)).groupBy(jobDiscoveryRuns.status);
    return {
      users: { total: totalUsers, active30d: activeUsers },
      enterprises: totalEnterprises,
      activeSubscriptions: activeSubs,
      jobsDiscovered,
      applications: { submitted, failed, needsVerification },
      discoveryRuns30d: Object.fromEntries(runs.map((r) => [r.status, Number(r.n)])),
      revenue,
      ai,
      queues,
      workers,
    };
  }

  private async workerHeartbeats() {
    try {
      const redis = (await this.c.queues!.queue(QUEUES.SCHEDULER).client) as any;
      const keys = await redis.keys('autoapply:worker:*');
      const out = [];
      for (const k of keys.slice(0, 50)) {
        const v = await redis.get(k);
        if (v) out.push(JSON.parse(v));
      }
      return out;
    } catch {
      return [];
    }
  }

  @Get('system')
  @RequirePermissions('admin:system:read')
  async system() {
    const queues = await this.c.queues!.counts();
    const dead = await this.c.queues!.queue(QUEUES.DEAD_LETTER).getJobs(['waiting', 'completed', 'failed'], 0, 20);
    return { queues, workers: await this.workerHeartbeats(), deadLetters: dead.map((j) => ({ id: j.id, data: { queue: j.data.queue, name: j.data.name, failedReason: j.data.failedReason, attemptsMade: j.data.attemptsMade }, timestamp: j.timestamp })) };
  }

  @Get('integrations')
  @RequirePermissions('admin:system:read')
  async integrations() {
    const since7 = new Date(Date.now() - 7 * 86_400_000);
    const seen = await this.c.db.select({ platform: jobSources.platform, n: count() }).from(jobSources).where(gte(jobSources.lastSeenAt, since7)).groupBy(jobSources.platform);
    const conns = await this.c.db.select({ platform: platformConnections.platform, status: platformConnections.status, n: count() }).from(platformConnections).groupBy(platformConnections.platform, platformConnections.status);
    return this.c.registry.describe().map((d) => ({
      ...d,
      jobsSeen7d: Number(seen.find((s) => s.platform === d.key)?.n ?? 0),
      connections: Object.fromEntries(conns.filter((c) => c.platform === d.key).map((c) => [c.status, Number(c.n)])),
    }));
  }

  // ---- users
  @Get('users')
  @RequirePermissions('admin:users:read')
  async users(@Query('q') q?: string, @Query('page') pageRaw?: string) {
    const page = Math.max(1, Number(pageRaw) || 1);
    const where = q ? or(ilike(users.email, `%${q}%`), ilike(users.fullName, `%${q}%`)) : undefined;
    const [items, [total]] = await Promise.all([
      this.c.db
        .select({ id: users.id, email: users.email, fullName: users.fullName, accountType: users.accountType, platformRole: users.platformRole, status: users.status, emailVerifiedAt: users.emailVerifiedAt, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt, enterpriseId: enterpriseMembers.enterpriseId, enterpriseName: enterprises.name })
        .from(users)
        .leftJoin(enterpriseMembers, eq(enterpriseMembers.userId, users.id))
        .leftJoin(enterprises, eq(enterprises.id, enterpriseMembers.enterpriseId))
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(50)
        .offset((page - 1) * 50),
      this.c.db.select({ n: count() }).from(users).where(where),
    ]);
    return { items, page, pageSize: 50, total: Number(total?.n ?? 0) };
  }

  @Put('users/:id')
  @RequirePermissions('admin:users:manage')
  @ApiZodBody(adminUpdateUserSchema)
  async updateUser(@Auth() a: AuthContext, @Param('id') id: string, @Body(new ZodPipe(adminUpdateUserSchema)) body: z.infer<typeof adminUpdateUserSchema>) {
    const userId = parseUuid(id);
    if (userId === a.userId) throw new DomainError('INVALID', 'You cannot change your own role or status');
    const [target] = await this.c.db.select().from(users).where(eq(users.id, userId));
    if (!target) throw new DomainError('NOT_FOUND', 'User not found');
    if (body.platformRole && !a.permissions.has('admin:roles:manage')) throw new DomainError('FORBIDDEN', 'Only Super Admins can change platform roles');
    // Platform admins cannot act on (super) admins.
    if (target.platformRole !== 'USER' && a.platformRole !== 'SUPER_ADMIN') throw new DomainError('FORBIDDEN', 'Only Super Admins can modify administrators');
    const [row] = await this.c.db.update(users).set(body).where(eq(users.id, userId)).returning({ id: users.id, platformRole: users.platformRole, status: users.status });
    if (body.status === 'SUSPENDED') await this.c.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId));
    await this.c.audit.log({ actorUserId: a.userId, action: 'admin.user.update', targetType: 'user', targetId: userId, metadata: body });
    return row;
  }

  // ---- enterprises
  @Get('enterprises')
  @RequirePermissions('admin:users:read')
  async enterprises() {
    return this.c.db
      .select({
        id: enterprises.id,
        name: enterprises.name,
        slug: enterprises.slug,
        status: enterprises.status,
        createdAt: enterprises.createdAt,
        members: sql<number>`(select count(*)::int from enterprise_members m where m.enterprise_id = ${enterprises.id})`,
        plan: sql<string>`(select p.name from subscriptions s join plans p on p.id = s.plan_id where s.enterprise_id = ${enterprises.id} and s.status <> 'CANCELED' order by s.created_at desc limit 1)`,
      })
      .from(enterprises)
      .orderBy(desc(enterprises.createdAt));
  }

  @Post('enterprises')
  @RequirePermissions('admin:users:manage')
  @ApiZodBody(createEnterpriseSchema)
  async createEnterprise(@Auth() a: AuthContext, @Body(new ZodPipe(createEnterpriseSchema)) body: z.infer<typeof createEnterpriseSchema>) {
    const slug = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    const [e] = await this.c.db.insert(enterprises).values({ name: body.name, slug, createdBy: a.userId }).returning();
    await this.c.billing.ensureSubscription({ enterpriseId: e!.id }, body.planKey, 'MONTHLY', { trialDays: 14 });
    const [u] = await this.c.db.select().from(users).where(eq(users.email, body.adminEmail));
    if (u) {
      const [mem] = await this.c.db.select().from(enterpriseMembers).where(eq(enterpriseMembers.userId, u.id));
      if (mem) throw new DomainError('CONFLICT', 'That user already belongs to an enterprise');
      await this.c.db.insert(enterpriseMembers).values({ enterpriseId: e!.id, userId: u.id, role: 'ENTERPRISE_ADMIN' });
      await this.c.db.update(users).set({ accountType: 'ENTERPRISE' }).where(eq(users.id, u.id));
    } else {
      const token = randomToken(32);
      await this.c.db.insert(enterpriseInvitations).values({ enterpriseId: e!.id, email: body.adminEmail, role: 'ENTERPRISE_ADMIN', tokenHash: hashToken(token), invitedBy: a.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) });
      await this.c.mailer.send(body.adminEmail, `Your ${body.name} workspace on AutoApply`, `You have been made administrator of ${body.name}.\n${this.config.WEB_ORIGIN}/signup?invitation=${token}&email=${encodeURIComponent(body.adminEmail)}`);
    }
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: e!.id, action: 'admin.enterprise.create', targetType: 'enterprise', targetId: e!.id, metadata: { planKey: body.planKey } });
    return e;
  }

  @Put('enterprises/:id')
  @RequirePermissions('admin:users:manage')
  async updateEnterprise(@Auth() a: AuthContext, @Param('id') id: string, @Body(new ZodPipe(z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }))) body: { status: 'ACTIVE' | 'SUSPENDED' }) {
    const [row] = await this.c.db.update(enterprises).set(body).where(eq(enterprises.id, parseUuid(id))).returning();
    if (!row) throw new DomainError('NOT_FOUND', 'Enterprise not found');
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: row.id, action: 'admin.enterprise.update', targetType: 'enterprise', targetId: row.id, metadata: body });
    return row;
  }

  // ---- plans
  @Get('plans')
  @RequirePermissions('admin:plans:manage')
  async plans() {
    return this.c.db.select().from(plans).orderBy(plans.sortOrder);
  }

  @Post('plans')
  @RequirePermissions('admin:plans:manage')
  @ApiZodBody(planInputSchema)
  async createPlan(@Auth() a: AuthContext, @Body(new ZodPipe(planInputSchema)) body: PlanInput) {
    const [row] = await this.c.db.insert(plans).values(body).returning();
    await this.c.audit.log({ actorUserId: a.userId, action: 'admin.plan.create', targetType: 'plan', targetId: body.key });
    return row;
  }

  @Put('plans/:key')
  @RequirePermissions('admin:plans:manage')
  async updatePlan(@Auth() a: AuthContext, @Param('key') key: string, @Body(new ZodPipe(planInputSchema.omit({ key: true }).partial())) body: Partial<PlanInput>) {
    const [row] = await this.c.db.update(plans).set(body).where(eq(plans.key, key)).returning();
    if (!row) throw new DomainError('NOT_FOUND', 'Plan not found');
    await this.c.audit.log({ actorUserId: a.userId, action: 'admin.plan.update', targetType: 'plan', targetId: key, metadata: body as Record<string, unknown> });
    return row;
  }

  // ---- billing
  @Get('subscriptions')
  @RequirePermissions('admin:billing:read')
  async subscriptions() {
    return this.c.db
      .select({ id: subscriptions.id, status: subscriptions.status, interval: subscriptions.interval, currentPeriodEnd: subscriptions.currentPeriodEnd, cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd, plan: plans.name, userEmail: users.email, enterpriseName: enterprises.name, createdAt: subscriptions.createdAt })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .leftJoin(users, eq(users.id, subscriptions.userId))
      .leftJoin(enterprises, eq(enterprises.id, subscriptions.enterpriseId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(200);
  }

  @Get('invoices')
  @RequirePermissions('admin:billing:read')
  async invoices(@Query('status') status?: string) {
    return this.c.db
      .select({ id: invoices.id, number: invoices.number, kind: invoices.kind, status: invoices.status, amountCents: invoices.amountCents, currency: invoices.currency, periodStart: invoices.periodStart, periodEnd: invoices.periodEnd, issuedAt: invoices.issuedAt, paidAt: invoices.paidAt, userEmail: users.email, enterpriseName: enterprises.name })
      .from(invoices)
      .leftJoin(users, eq(users.id, invoices.userId))
      .leftJoin(enterprises, eq(enterprises.id, invoices.enterpriseId))
      .where(status ? sql`${invoices.status} = ${status}` : undefined)
      .orderBy(desc(invoices.issuedAt))
      .limit(200);
  }

  @Post('invoices/:id/mark-paid')
  @HttpCode(204)
  @RequirePermissions('admin:plans:manage')
  async markPaid(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.c.billing.markPaid(parseUuid(id));
    await this.c.audit.log({ actorUserId: a.userId, action: 'admin.invoice.mark_paid', targetType: 'invoice', targetId: id });
  }

  @Post('billing/run')
  @HttpCode(202)
  @RequirePermissions('admin:plans:manage')
  async runBilling(@Body(new ZodPipe(z.object({ type: z.enum(['RENEWALS', 'AI_USAGE_INVOICES']), periodKey: z.string().regex(/^\d{4}-\d{2}$/).optional() }))) body: { type: 'RENEWALS' | 'AI_USAGE_INVOICES'; periodKey?: string }) {
    await this.c.queues!.add(QUEUES.BILLING, body, { idempotencyKey: `billing:${body.type}:${body.periodKey ?? ''}:${Math.floor(Date.now() / 60_000)}` });
    return { queued: true };
  }

  // ---- audit & settings
  @Get('audit-logs')
  @RequirePermissions('admin:audit:read')
  async audit(@Query('action') action?: string, @Query('actor') actor?: string, @Query('page') pageRaw?: string) {
    const page = Math.max(1, Number(pageRaw) || 1);
    const where = and(action ? ilike(auditLogs.action, `${action}%`) : undefined, actor ? ilike(users.email, `%${actor}%`) : undefined);
    return this.c.db
      .select({ id: auditLogs.id, action: auditLogs.action, actorEmail: users.email, actorUserId: auditLogs.actorUserId, enterpriseId: auditLogs.enterpriseId, targetType: auditLogs.targetType, targetId: auditLogs.targetId, ip: auditLogs.ip, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(100)
      .offset((page - 1) * 100);
  }

  @Get('settings')
  @RequirePermissions('admin:settings:manage')
  async settings() {
    return this.c.settings.all();
  }

  @Put('settings/:key')
  @RequirePermissions('admin:settings:manage')
  async setSetting(@Auth() a: AuthContext, @Param('key') key: string, @Body() body: { value: unknown }) {
    const schema = SETTINGS_SCHEMAS[key];
    if (!schema) throw new DomainError('NOT_FOUND', 'Unknown setting');
    const value = schema.parse(body?.value);
    await this.c.settings.set(key, value, a.userId);
    await this.c.audit.log({ actorUserId: a.userId, action: 'admin.settings.update', targetType: 'setting', targetId: key, metadata: { value } });
    return { key, value };
  }
}
