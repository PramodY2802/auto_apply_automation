import nodemailer from 'nodemailer';
import {
  and,
  auditLogs,
  enterpriseMembers,
  eq,
  gte,
  notifications,
  plans,
  platformSettings,
  sql,
  subscriptions,
  usageRecords,
  users,
  type Database,
  type DbExecutor,
} from '@autoapply/database';
import { DEFAULT_MATCHING_WEIGHTS } from '@autoapply/database';
import { matchingWeightsSchema, type MatchingWeights, type PlanFeatures, type PlanLimits, type UsageMetric } from '@autoapply/shared';
import { createLogger, type Logger } from './infra';

export interface Actor {
  userId: string;
  enterpriseId: string | null;
}

export class DomainError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'CONFLICT' | 'INVALID' | 'LIMIT_EXCEEDED' | 'FEATURE_UNAVAILABLE' | 'PRECONDITION',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function periodKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

// ---------------------------------------------------------------------------
export class AuditService {
  constructor(private readonly db: Database) {}
  async log(entry: { actorUserId: string | null; enterpriseId?: string | null; action: string; targetType?: string; targetId?: string; ip?: string | null; metadata?: Record<string, unknown> }, tx: DbExecutor = this.db): Promise<void> {
    await tx.insert(auditLogs).values({
      actorUserId: entry.actorUserId,
      enterpriseId: entry.enterpriseId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      ip: entry.ip ?? null,
      metadata: entry.metadata ?? {},
    });
  }
}

// ---------------------------------------------------------------------------
export class SettingsService {
  private cache = new Map<string, { v: unknown; at: number }>();
  constructor(private readonly db: Database, private readonly ttlMs = 30_000) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const c = this.cache.get(key);
    if (c && Date.now() - c.at < this.ttlMs) return c.v as T;
    const [row] = await this.db.select().from(platformSettings).where(eq(platformSettings.key, key));
    const v = (row?.value ?? fallback) as T;
    this.cache.set(key, { v, at: Date.now() });
    return v;
  }

  async set(key: string, value: unknown, updatedBy: string | null): Promise<void> {
    await this.db
      .insert(platformSettings)
      .values({ key, value, updatedBy })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy, updatedAt: new Date() } });
    this.cache.delete(key);
  }

  async all(): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(platformSettings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async matchingWeights(): Promise<MatchingWeights> {
    const raw = await this.get<unknown>('matching.weights', DEFAULT_MATCHING_WEIGHTS);
    const p = matchingWeightsSchema.safeParse(raw);
    return p.success ? p.data : DEFAULT_MATCHING_WEIGHTS;
  }
}

// ---------------------------------------------------------------------------
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(url: string, private readonly from: string) {
    this.transport = nodemailer.createTransport(url);
  }
  async send(to: string, subject: string, text: string): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, text });
  }
}

/** Development mailer: logs that an email was sent (never the token-bearing body unless MAIL_LOG_BODIES=true). */
export class LogMailer implements Mailer {
  readonly outbox: { to: string; subject: string; text: string }[] = [];
  constructor(private readonly logger: Logger = createLogger('mailer')) {}
  async send(to: string, subject: string, text: string): Promise<void> {
    this.outbox.push({ to, subject, text });
    if (this.outbox.length > 200) this.outbox.shift();
    this.logger.info('email (dev transport)', { subject, body: process.env.MAIL_LOG_BODIES === 'true' ? text : undefined });
  }
}

export function createMailer(env = process.env): Mailer {
  return env.SMTP_URL ? new SmtpMailer(env.SMTP_URL, env.MAIL_FROM ?? 'AutoApply <no-reply@localhost>') : new LogMailer();
}

export class NotificationService {
  constructor(private readonly db: Database, private readonly mailer: Mailer, private readonly enqueueEmail?: (notificationId: string) => Promise<void>) {}

  async notify(userId: string, n: { type: string; title: string; body?: string; data?: Record<string, unknown>; email?: boolean }, tx: DbExecutor = this.db) {
    const [row] = await tx
      .insert(notifications)
      .values({ userId, type: n.type, title: n.title, body: n.body ?? '', data: n.data ?? {}, channel: n.email ? 'EMAIL' : 'IN_APP' })
      .returning();
    if (n.email && this.enqueueEmail) await this.enqueueEmail(row!.id);
    return row!;
  }

  /** Worker side: deliver an EMAIL-channel notification. Idempotent via emailed_at. */
  async deliver(notificationId: string): Promise<void> {
    const [n] = await this.db.select().from(notifications).where(eq(notifications.id, notificationId));
    if (!n || n.emailedAt) return;
    const [u] = await this.db.select({ email: users.email, status: users.status }).from(users).where(eq(users.id, n.userId));
    if (!u || u.status !== 'ACTIVE') return;
    await this.mailer.send(u.email, n.title, `${n.body}\n\n— AutoApply`);
    await this.db.update(notifications).set({ emailedAt: new Date() }).where(eq(notifications.id, notificationId));
  }
}

// ---------------------------------------------------------------------------
export class UsageService {
  constructor(private readonly db: Database) {}

  async enterpriseOf(userId: string): Promise<string | null> {
    const [m] = await this.db.select({ e: enterpriseMembers.enterpriseId }).from(enterpriseMembers).where(and(eq(enterpriseMembers.userId, userId), eq(enterpriseMembers.status, 'ACTIVE')));
    return m?.e ?? null;
  }

  /** Effective plan: enterprise subscription for members, otherwise personal; Free if none. */
  async resolvePlan(actor: Actor): Promise<{ plan: typeof plans.$inferSelect; subscription: typeof subscriptions.$inferSelect | null }> {
    const owner = actor.enterpriseId ? eq(subscriptions.enterpriseId, actor.enterpriseId) : eq(subscriptions.userId, actor.userId);
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(and(owner, sql`${subscriptions.status} in ('ACTIVE','TRIALING','PAST_DUE')`))
      .orderBy(sql`${subscriptions.createdAt} desc`)
      .limit(1);
    if (sub) {
      const [plan] = await this.db.select().from(plans).where(eq(plans.id, sub.planId));
      if (plan) return { plan, subscription: sub };
    }
    const [free] = await this.db.select().from(plans).where(eq(plans.key, 'free'));
    if (!free) throw new DomainError('PRECONDITION', 'Free plan missing — run the database seed');
    return { plan: free, subscription: null };
  }

  async used(actor: Actor, metric: UsageMetric, key = periodKey()): Promise<number> {
    const owner = actor.enterpriseId ? eq(usageRecords.enterpriseId, actor.enterpriseId) : eq(usageRecords.userId, actor.userId);
    const [r] = await this.db
      .select({ total: sql<string>`coalesce(sum(${usageRecords.quantity}), 0)` })
      .from(usageRecords)
      .where(and(owner, eq(usageRecords.metric, metric), eq(usageRecords.periodKey, key)));
    return Number(r?.total ?? 0);
  }

  static limitFor(limits: PlanLimits, metric: UsageMetric): number | null {
    switch (metric) {
      case 'SEARCH':
        return limits.searchesPerMonth;
      case 'APPLICATION':
        return limits.applicationsPerMonth;
      case 'AI_TOKENS':
        return limits.aiTokensPerMonth;
      case 'STORAGE_BYTES':
        return limits.storageMb == null ? null : limits.storageMb * 1024 * 1024;
      case 'BROWSER_MINUTES':
        return limits.browserMinutesPerMonth;
    }
  }

  async assertWithin(actor: Actor, metric: UsageMetric, qty = 1): Promise<void> {
    const { plan } = await this.resolvePlan(actor);
    const limit = UsageService.limitFor(plan.limits, metric);
    if (limit == null) return;
    const used = metric === 'STORAGE_BYTES' ? await this.storageUsed(actor) : await this.used(actor, metric);
    if (used + qty > limit) {
      throw new DomainError('LIMIT_EXCEEDED', `Your ${plan.name} plan limit for ${metric.toLowerCase().replace('_', ' ')} has been reached (${used}/${limit} this period)`, { metric, used, limit, plan: plan.key });
    }
  }

  async assertFeature(actor: Actor, feature: keyof PlanFeatures): Promise<void> {
    const { plan } = await this.resolvePlan(actor);
    if (!plan.features[feature]) throw new DomainError('FEATURE_UNAVAILABLE', `${feature} is not included in your ${plan.name} plan`, { feature, plan: plan.key });
  }

  async record(actor: Actor, metric: UsageMetric, quantity: number, opts: { sourceId?: string; costUsd?: number; subscriptionId?: string | null } = {}, tx: DbExecutor = this.db): Promise<void> {
    await tx
      .insert(usageRecords)
      .values({
        userId: actor.userId,
        enterpriseId: actor.enterpriseId,
        subscriptionId: opts.subscriptionId ?? null,
        metric,
        quantity,
        costUsd: String(opts.costUsd ?? 0),
        periodKey: periodKey(),
        sourceId: opts.sourceId ?? null,
      })
      .onConflictDoNothing();
  }

  async storageUsed(actor: Actor): Promise<number> {
    const owner = actor.enterpriseId ? sql`r.enterprise_id = ${actor.enterpriseId}` : sql`r.user_id = ${actor.userId}`;
    const res = await this.db.execute(sql`select coalesce(sum(r.size_bytes),0)::bigint as total from resumes r where ${owner} and r.deleted_at is null`);
    return Number((res.rows[0] as any)?.total ?? 0);
  }

  async summary(actor: Actor) {
    const { plan, subscription } = await this.resolvePlan(actor);
    const metrics: UsageMetric[] = ['SEARCH', 'APPLICATION', 'AI_TOKENS', 'STORAGE_BYTES', 'BROWSER_MINUTES'];
    const out = [];
    for (const m of metrics) {
      out.push({ metric: m, used: m === 'STORAGE_BYTES' ? await this.storageUsed(actor) : await this.used(actor, m), limit: UsageService.limitFor(plan.limits, m) });
    }
    return { plan: { key: plan.key, name: plan.name, features: plan.features }, subscription, period: periodKey(), usage: out };
  }

  async recentDailyCount(userId: string, metric: UsageMetric, sinceHours = 24): Promise<number> {
    const [r] = await this.db
      .select({ c: sql<string>`coalesce(sum(${usageRecords.quantity}),0)` })
      .from(usageRecords)
      .where(and(eq(usageRecords.userId, userId), eq(usageRecords.metric, metric), gte(usageRecords.createdAt, new Date(Date.now() - sinceHours * 3600_000))));
    return Number(r?.c ?? 0);
  }
}
