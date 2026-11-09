import crypto from 'node:crypto';
import {
  aiUsageLogs,
  and,
  eq,
  gte,
  invoices,
  lt,
  lte,
  plans,
  sql,
  subscriptions,
  type Database,
  type InvoiceLine,
} from '@autoapply/database';
import type { BillingInterval } from '@autoapply/shared';
import { DomainError, periodKey } from './platform';

type Plan = typeof plans.$inferSelect;
type Subscription = typeof subscriptions.$inferSelect;
type Invoice = typeof invoices.$inferSelect;
export type BillingOwner = { userId: string; enterpriseId?: null } | { enterpriseId: string; userId?: null };

/** Payment provider abstraction. */
export interface PaymentProvider {
  readonly key: string;
  readonly status: 'IMPLEMENTED' | 'AWAITING_CREDENTIALS';
  /** Attempt to collect an invoice. Returns the resulting status. */
  collect(invoice: Invoice): Promise<{ status: 'PAID' | 'OPEN'; providerInvoiceId?: string }>;
  /** Optional hosted checkout URL for upgrades. */
  checkoutUrl?(args: { invoice: Invoice; successUrl: string; cancelUrl: string }): Promise<string | null>;
}

/**
 * Manual / offline settlement (default). Zero-amount invoices are paid
 * immediately; others stay OPEN until a Super Admin marks them paid.
 */
export class ManualPaymentProvider implements PaymentProvider {
  readonly key = 'manual';
  readonly status = 'IMPLEMENTED' as const;
  async collect(invoice: Invoice) {
    return { status: invoice.amountCents === 0 ? ('PAID' as const) : ('OPEN' as const) };
  }
}

/**
 * Stripe (Checkout Sessions REST API). Implemented but awaiting credentials:
 * requires STRIPE_SECRET_KEY; not exercised against Stripe in this repo's tests.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly key = 'stripe';
  readonly status = 'AWAITING_CREDENTIALS' as const;
  constructor(private readonly secretKey: string | undefined = process.env.STRIPE_SECRET_KEY, private readonly fetchImpl: typeof fetch = fetch) {}
  async collect(_invoice: Invoice) {
    return { status: 'OPEN' as const };
  }
  async checkoutUrl(args: { invoice: Invoice; successUrl: string; cancelUrl: string }): Promise<string | null> {
    if (!this.secretKey) throw new DomainError('PRECONDITION', 'Stripe is not configured (STRIPE_SECRET_KEY)');
    const body = new URLSearchParams({
      mode: 'payment',
      success_url: args.successUrl,
      cancel_url: args.cancelUrl,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': args.invoice.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(args.invoice.amountCents),
      'line_items[0][price_data][product_data][name]': `Invoice ${args.invoice.number}`,
      'metadata[invoice_id]': args.invoice.id,
    });
    const res = await this.fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new DomainError('PRECONDITION', `Stripe returned ${res.status}`);
    return ((await res.json()) as { url?: string }).url ?? null;
  }
}

export function addInterval(d: Date, interval: BillingInterval): Date {
  const r = new Date(d);
  if (interval === 'ANNUAL') r.setUTCFullYear(r.getUTCFullYear() + 1);
  else r.setUTCMonth(r.getUTCMonth() + 1);
  return r;
}

export function invoiceNumber(d = new Date()): string {
  return `INV-${periodKey(d).replace('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Subscription lifecycle + invoicing. SaaS subscription invoices and AI
 * consumption invoices are separate invoice kinds and computed independently.
 */
export class BillingService {
  constructor(private readonly db: Database, private readonly payments: PaymentProvider = new ManualPaymentProvider()) {}

  private ownerWhere(owner: BillingOwner) {
    return owner.enterpriseId ? eq(subscriptions.enterpriseId, owner.enterpriseId) : eq(subscriptions.userId, owner.userId!);
  }

  async planByKey(key: string): Promise<Plan> {
    const [p] = await this.db.select().from(plans).where(eq(plans.key, key));
    if (!p || !p.isActive) throw new DomainError('NOT_FOUND', `Plan "${key}" not found`);
    return p;
  }

  async current(owner: BillingOwner): Promise<{ subscription: Subscription; plan: Plan } | null> {
    const [s] = await this.db
      .select()
      .from(subscriptions)
      .where(and(this.ownerWhere(owner), sql`${subscriptions.status} <> 'CANCELED'`))
      .orderBy(sql`${subscriptions.createdAt} desc`)
      .limit(1);
    if (!s) return null;
    const [p] = await this.db.select().from(plans).where(eq(plans.id, s.planId));
    return { subscription: s, plan: p! };
  }

  /** Creates a subscription on the given plan (Free by default) if none exists. */
  async ensureSubscription(owner: BillingOwner, planKey = 'free', interval: BillingInterval = 'MONTHLY', opts: { trialDays?: number } = {}): Promise<Subscription> {
    const cur = await this.current(owner);
    if (cur) return cur.subscription;
    const plan = await this.planByKey(planKey);
    const now = new Date();
    const trialEnd = opts.trialDays ? new Date(now.getTime() + opts.trialDays * 86_400_000) : null;
    const [s] = await this.db
      .insert(subscriptions)
      .values({
        userId: owner.userId ?? null,
        enterpriseId: owner.enterpriseId ?? null,
        planId: plan.id,
        status: trialEnd ? 'TRIALING' : 'ACTIVE',
        interval,
        currentPeriodStart: now,
        currentPeriodEnd: trialEnd ?? addInterval(now, interval),
        paymentProvider: this.payments.key,
      })
      .returning();
    // Trials are invoiced at the first renewal.
    if (!trialEnd) await this.issueSubscriptionInvoice(s!, plan, now);
    return s!;
  }

  private price(plan: Plan, interval: BillingInterval): number {
    return interval === 'ANNUAL' ? plan.priceAnnualCents : plan.priceMonthlyCents;
  }

  async issueSubscriptionInvoice(sub: Subscription, plan: Plan, start: Date): Promise<Invoice | null> {
    const amount = this.price(plan, sub.interval);
    const line: InvoiceLine = { description: `${plan.name} plan (${sub.interval.toLowerCase()})`, quantity: 1, unitAmountCents: amount, amountCents: amount };
    const [inv] = await this.db
      .insert(invoices)
      .values({
        number: invoiceNumber(start),
        subscriptionId: sub.id,
        userId: sub.userId,
        enterpriseId: sub.enterpriseId,
        kind: 'SUBSCRIPTION',
        status: 'OPEN',
        amountCents: amount,
        currency: plan.currency,
        periodStart: start,
        periodEnd: addInterval(start, sub.interval),
        lineItems: [line],
        paymentProvider: this.payments.key,
      })
      .onConflictDoNothing()
      .returning();
    if (!inv) return null;
    const r = await this.payments.collect(inv);
    if (r.status === 'PAID') {
      await this.db.update(invoices).set({ status: 'PAID', paidAt: new Date(), providerInvoiceId: r.providerInvoiceId ?? null }).where(eq(invoices.id, inv.id));
      return { ...inv, status: 'PAID' };
    }
    return inv;
  }

  /**
   * Upgrades take effect immediately (new period + invoice). Downgrades are
   * scheduled for the end of the current period.
   */
  async changePlan(owner: BillingOwner, planKey: string, interval: BillingInterval): Promise<{ subscription: Subscription; effective: 'NOW' | 'PERIOD_END' }> {
    const target = await this.planByKey(planKey);
    if (target.features.enterprise && !owner.enterpriseId) throw new DomainError('INVALID', 'Enterprise plans are only available to enterprise accounts');
    const cur = await this.current(owner);
    if (!cur) return { subscription: await this.ensureSubscription(owner, planKey, interval), effective: 'NOW' };
    if (cur.plan.id === target.id && cur.subscription.interval === interval) {
      const [s] = await this.db.update(subscriptions).set({ cancelAtPeriodEnd: false, pendingPlanId: null }).where(eq(subscriptions.id, cur.subscription.id)).returning();
      return { subscription: s!, effective: 'NOW' };
    }
    const isUpgrade = this.price(target, interval) >= this.price(cur.plan, cur.subscription.interval);
    if (isUpgrade) {
      const now = new Date();
      const [s] = await this.db
        .update(subscriptions)
        .set({ planId: target.id, interval, currentPeriodStart: now, currentPeriodEnd: addInterval(now, interval), pendingPlanId: null, cancelAtPeriodEnd: false, status: 'ACTIVE' })
        .where(eq(subscriptions.id, cur.subscription.id))
        .returning();
      await this.issueSubscriptionInvoice(s!, target, now);
      return { subscription: s!, effective: 'NOW' };
    }
    const [s] = await this.db.update(subscriptions).set({ pendingPlanId: target.id, cancelAtPeriodEnd: false }).where(eq(subscriptions.id, cur.subscription.id)).returning();
    return { subscription: s!, effective: 'PERIOD_END' };
  }

  async cancel(owner: BillingOwner): Promise<Subscription> {
    const cur = await this.current(owner);
    if (!cur) throw new DomainError('NOT_FOUND', 'No active subscription');
    if (cur.plan.key === 'free') throw new DomainError('INVALID', 'The Free plan cannot be canceled');
    const [s] = await this.db.update(subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(subscriptions.id, cur.subscription.id)).returning();
    return s!;
  }

  /** Renewal job: rolls periods, applies scheduled downgrades/cancellations, issues invoices. */
  async processRenewals(now = new Date()): Promise<{ renewed: number; canceled: number }> {
    const due = await this.db.select().from(subscriptions).where(and(lte(subscriptions.currentPeriodEnd, now), sql`${subscriptions.status} <> 'CANCELED'`));
    let renewed = 0;
    let canceled = 0;
    for (const s of due) {
      const owner: BillingOwner = s.enterpriseId ? { enterpriseId: s.enterpriseId } : { userId: s.userId! };
      if (s.cancelAtPeriodEnd) {
        await this.db.update(subscriptions).set({ status: 'CANCELED', canceledAt: now }).where(eq(subscriptions.id, s.id));
        canceled++;
        if (!s.enterpriseId) await this.ensureSubscription(owner, 'free');
        continue;
      }
      const planId = s.pendingPlanId ?? s.planId;
      const [plan] = await this.db.select().from(plans).where(eq(plans.id, planId));
      const start = s.currentPeriodEnd;
      const [ns] = await this.db
        .update(subscriptions)
        .set({ planId, pendingPlanId: null, status: 'ACTIVE', currentPeriodStart: start, currentPeriodEnd: addInterval(start, s.interval) })
        .where(eq(subscriptions.id, s.id))
        .returning();
      await this.issueSubscriptionInvoice(ns!, plan!, start);
      renewed++;
    }
    return { renewed, canceled };
  }

  /**
   * AI consumption invoices for a calendar month: only platform-managed AI usage
   * (scope PLATFORM) is billed; user/enterprise keys are paid to the provider directly.
   */
  async issueAiUsageInvoices(key: string): Promise<number> {
    const [y, m] = key.split('-').map(Number);
    const start = new Date(Date.UTC(y!, m! - 1, 1));
    const end = new Date(Date.UTC(y!, m!, 1));
    const rows = await this.db
      .select({
        userId: aiUsageLogs.userId,
        enterpriseId: aiUsageLogs.enterpriseId,
        cost: sql<string>`sum(${aiUsageLogs.costUsd})`,
        tokens: sql<string>`sum(${aiUsageLogs.inputTokens} + ${aiUsageLogs.outputTokens})`,
      })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.scope, 'PLATFORM'), eq(aiUsageLogs.status, 'ok'), gte(aiUsageLogs.createdAt, start), lt(aiUsageLogs.createdAt, end)))
      .groupBy(aiUsageLogs.userId, aiUsageLogs.enterpriseId);
    // Enterprise usage is billed to the enterprise; individual usage to the user.
    const byOwner = new Map<string, { owner: BillingOwner; cost: number; tokens: number }>();
    for (const r of rows) {
      const owner: BillingOwner | null = r.enterpriseId ? { enterpriseId: r.enterpriseId } : r.userId ? { userId: r.userId } : null;
      if (!owner) continue;
      const k = owner.enterpriseId ? `e:${owner.enterpriseId}` : `u:${owner.userId}`;
      const cur = byOwner.get(k) ?? { owner, cost: 0, tokens: 0 };
      cur.cost += Number(r.cost ?? 0);
      cur.tokens += Number(r.tokens ?? 0);
      byOwner.set(k, cur);
    }
    let issued = 0;
    for (const { owner, cost, tokens } of byOwner.values()) {
      const cur = await this.current(owner);
      const markup = cur?.plan.aiMarkupPercent ?? 0;
      const amountCents = Math.round(cost * (1 + markup / 100) * 100);
      if (amountCents <= 0) continue;
      const ownerCol = owner.enterpriseId ? eq(invoices.enterpriseId, owner.enterpriseId) : eq(invoices.userId, owner.userId!);
      const [existing] = await this.db.select({ id: invoices.id }).from(invoices).where(and(ownerCol, eq(invoices.kind, 'AI_USAGE'), eq(invoices.periodStart, start)));
      if (existing) continue; // idempotent re-runs
      const lines: InvoiceLine[] = [
        { description: `AI usage ${key}: ${tokens.toLocaleString('en-US')} tokens at provider cost`, quantity: 1, unitAmountCents: Math.round(cost * 100), amountCents: Math.round(cost * 100) },
        { description: `Platform AI service fee (${markup}%)`, quantity: 1, unitAmountCents: amountCents - Math.round(cost * 100), amountCents: amountCents - Math.round(cost * 100) },
      ];
      const [inv] = await this.db
        .insert(invoices)
        .values({
          number: invoiceNumber(start),
          subscriptionId: cur?.subscription.id ?? null,
          userId: owner.userId ?? null,
          enterpriseId: owner.enterpriseId ?? null,
          kind: 'AI_USAGE',
          status: 'OPEN',
          amountCents,
          currency: 'USD',
          periodStart: start,
          periodEnd: end,
          lineItems: lines,
          paymentProvider: this.payments.key,
        })
        .onConflictDoNothing()
        .returning();
      if (inv) issued++;
    }
    return issued;
  }

  async markPaid(invoiceId: string): Promise<void> {
    const [inv] = await this.db.update(invoices).set({ status: 'PAID', paidAt: new Date() }).where(and(eq(invoices.id, invoiceId), eq(invoices.status, 'OPEN'))).returning();
    if (!inv) throw new DomainError('NOT_FOUND', 'Open invoice not found');
  }
}
