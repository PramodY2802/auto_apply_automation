import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { and, asc, count, desc, eq, invoices, isNull, notifications, plans, sql } from '@autoapply/database';
import { DomainError, type BillingOwner } from '@autoapply/services';
import { changeSubscriptionSchema } from '@autoapply/shared';
import { Auth, InjectContainer, Public, RequirePermissions, ZodPipe, actorOf, parseUuid, type AuthContext, type Container } from '../../common/core';

@ApiTags('notifications')
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(@InjectContainer() private readonly c: Container) {}

  @Get()
  async list(@Auth() a: AuthContext, @Query('unread') unread?: string, @Query('limit') limit?: string) {
    const where = and(eq(notifications.userId, a.userId), unread === 'true' ? isNull(notifications.readAt) : undefined);
    const [items, [u]] = await Promise.all([
      this.c.db.select().from(notifications).where(where).orderBy(desc(notifications.createdAt)).limit(Math.min(Number(limit) || 30, 100)),
      this.c.db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, a.userId), isNull(notifications.readAt))),
    ]);
    return { items, unread: Number(u?.n ?? 0) };
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.c.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, parseUuid(id)), eq(notifications.userId, a.userId)));
  }

  @Post('read-all')
  @HttpCode(204)
  async readAll(@Auth() a: AuthContext) {
    await this.c.db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, a.userId), isNull(notifications.readAt)));
  }
}

@ApiTags('billing')
@Controller({ path: 'billing', version: '1' })
export class BillingController {
  constructor(@InjectContainer() private readonly c: Container) {}

  private owner(a: AuthContext, forWrite: boolean): BillingOwner {
    if (a.enterpriseId) {
      if (forWrite && !a.permissions.has('enterprise:billing:manage')) throw new DomainError('FORBIDDEN', 'Only enterprise admins can manage the subscription');
      return { enterpriseId: a.enterpriseId };
    }
    return { userId: a.userId };
  }

  @Public()
  @Get('plans')
  async plans() {
    return this.c.db
      .select({ key: plans.key, name: plans.name, priceMonthlyCents: plans.priceMonthlyCents, priceAnnualCents: plans.priceAnnualCents, currency: plans.currency, limits: plans.limits, features: plans.features, aiMarkupPercent: plans.aiMarkupPercent })
      .from(plans)
      .where(and(eq(plans.isActive, true), eq(plans.isCustom, false)))
      .orderBy(asc(plans.sortOrder));
  }

  @Get('subscription')
  async subscription(@Auth() a: AuthContext) {
    const owner = this.owner(a, false);
    const cur = await this.c.billing.current(owner);
    const usage = await this.c.usage.summary(actorOf(a));
    const [pending] = cur?.subscription.pendingPlanId ? await this.c.db.select({ key: plans.key, name: plans.name }).from(plans).where(eq(plans.id, cur.subscription.pendingPlanId)) : [];
    return { subscription: cur?.subscription ?? null, plan: cur?.plan ?? null, pendingPlan: pending ?? null, usage: usage.usage, period: usage.period, paymentProvider: { key: this.c.payments.key, status: this.c.payments.status } };
  }

  @Post('subscription')
  @HttpCode(200)
  async change(@Auth() a: AuthContext, @Body(new ZodPipe(changeSubscriptionSchema)) body: z.infer<typeof changeSubscriptionSchema>) {
    const owner = this.owner(a, true);
    const r = await this.c.billing.changePlan(owner, body.planKey, body.interval);
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: a.enterpriseId, action: 'billing.change_plan', targetType: 'subscription', targetId: r.subscription.id, metadata: { planKey: body.planKey, interval: body.interval, effective: r.effective } });
    return r;
  }

  @Post('subscription/cancel')
  @HttpCode(200)
  async cancel(@Auth() a: AuthContext) {
    const s = await this.c.billing.cancel(this.owner(a, true));
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: a.enterpriseId, action: 'billing.cancel', targetType: 'subscription', targetId: s.id });
    return s;
  }

  @Get('invoices')
  async invoices(@Auth() a: AuthContext) {
    const owner = this.owner(a, false);
    if (owner.enterpriseId && !a.permissions.has('enterprise:read')) throw new DomainError('FORBIDDEN', 'Not allowed');
    return this.c.db
      .select()
      .from(invoices)
      .where(owner.enterpriseId ? eq(invoices.enterpriseId, owner.enterpriseId) : eq(invoices.userId, owner.userId!))
      .orderBy(desc(invoices.issuedAt))
      .limit(100);
  }

  @Get('usage')
  async usage(@Auth() a: AuthContext) {
    return this.c.usage.summary(actorOf(a));
  }
}

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(@InjectContainer() private readonly c: Container) {}

  @Public()
  @Get()
  live() {
    return { status: 'ok', time: new Date().toISOString() };
  }

  @Public()
  @Get('ready')
  async ready() {
    const checks: Record<string, { ok: boolean; error?: string }> = {};
    try {
      await this.c.db.execute(sql`select 1`);
      checks.database = { ok: true };
    } catch (e: any) {
      checks.database = { ok: false, error: 'unreachable' };
    }
    try {
      await this.c.queues!.queue('scheduler').client.then((r) => (r as any).ping());
      checks.redis = { ok: true };
    } catch {
      checks.redis = { ok: false, error: 'unreachable' };
    }
    const ok = Object.values(checks).every((c) => c.ok);
    if (!ok) throw new DomainError('PRECONDITION', 'Not ready', checks);
    return { status: 'ready', checks };
  }
}

export { RequirePermissions };
