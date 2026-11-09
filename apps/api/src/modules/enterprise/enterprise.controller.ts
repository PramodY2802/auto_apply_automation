import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
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
  gt,
  gte,
  isNull,
  jobMatches,
  sql,
  teams,
  users,
} from '@autoapply/database';
import { DomainError, hashToken, randomToken } from '@autoapply/services';
import { createTeamSchema, inviteMemberSchema, updateMemberSchema } from '@autoapply/shared';
import { ApiZodBody, Auth, InjectConfig, InjectContainer, RequirePermissions, ZodPipe, parseUuid, type AppConfig, type AuthContext, type Container } from '../../common/core';

function ent(a: AuthContext): string {
  if (!a.enterpriseId) throw new DomainError('FORBIDDEN', 'You are not a member of an enterprise');
  return a.enterpriseId;
}

/**
 * Enterprise admin panel API. Every query is scoped to the caller's own
 * enterprise id (from the server-side membership, never from the request).
 */
@ApiTags('enterprise')
@Controller({ path: 'enterprise', version: '1' })
export class EnterpriseController {
  constructor(@InjectContainer() private readonly c: Container, @InjectConfig() private readonly config: AppConfig) {}

  @Get()
  @RequirePermissions('enterprise:read')
  async overview(@Auth() a: AuthContext) {
    const id = ent(a);
    const [e] = await this.c.db.select().from(enterprises).where(eq(enterprises.id, id));
    const [[members], [apps], [applied], [jobsN]] = await Promise.all([
      this.c.db.select({ n: count() }).from(enterpriseMembers).where(eq(enterpriseMembers.enterpriseId, id)),
      this.c.db.select({ n: count() }).from(applications).where(eq(applications.enterpriseId, id)),
      this.c.db.select({ n: count() }).from(applications).where(and(eq(applications.enterpriseId, id), eq(applications.status, 'APPLIED'))),
      this.c.db.select({ n: sql<number>`count(distinct ${jobMatches.jobId})::int` }).from(jobMatches).innerJoin(enterpriseMembers, eq(enterpriseMembers.userId, jobMatches.userId)).where(eq(enterpriseMembers.enterpriseId, id)),
    ]);
    const sub = await this.c.billing.current({ enterpriseId: id });
    return { enterprise: e, stats: { members: Number(members?.n ?? 0), applications: Number(apps?.n ?? 0), applied: Number(applied?.n ?? 0), jobsDiscovered: Number(jobsN?.n ?? 0) }, subscription: sub };
  }

  @Put('settings')
  @RequirePermissions('enterprise:members:manage')
  async settings(@Auth() a: AuthContext, @Body(new ZodPipe(z.object({ name: z.string().trim().min(2).max(120).optional(), allowUserAiKeys: z.boolean().optional(), allowPlatformAi: z.boolean().optional(), defaultApplicationMode: z.enum(['MANUAL', 'AUTOMATIC']).optional() }))) body: Record<string, unknown>) {
    const id = ent(a);
    const [e] = await this.c.db.select().from(enterprises).where(eq(enterprises.id, id));
    const { name, ...settings } = body;
    const [row] = await this.c.db.update(enterprises).set({ ...(name ? { name: name as string } : {}), settings: { ...e!.settings, ...settings } }).where(eq(enterprises.id, id)).returning();
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: id, action: 'enterprise.settings', metadata: body });
    return row;
  }

  @Get('members')
  @RequirePermissions('enterprise:read')
  async members(@Auth() a: AuthContext) {
    const id = ent(a);
    return this.c.db
      .select({
        id: enterpriseMembers.id,
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        role: enterpriseMembers.role,
        status: enterpriseMembers.status,
        teamId: enterpriseMembers.teamId,
        lastLoginAt: users.lastLoginAt,
        joinedAt: enterpriseMembers.createdAt,
        applications: sql<number>`(select count(*)::int from applications ap where ap.user_id = ${users.id} and ap.enterprise_id = ${id})`,
      })
      .from(enterpriseMembers)
      .innerJoin(users, eq(users.id, enterpriseMembers.userId))
      .where(eq(enterpriseMembers.enterpriseId, id))
      .orderBy(users.fullName);
  }

  @Put('members/:memberId')
  @RequirePermissions('enterprise:members:manage')
  async updateMember(@Auth() a: AuthContext, @Param('memberId') memberId: string, @Body(new ZodPipe(updateMemberSchema)) body: z.infer<typeof updateMemberSchema>) {
    const id = ent(a);
    const [m] = await this.c.db.select().from(enterpriseMembers).where(and(eq(enterpriseMembers.id, parseUuid(memberId)), eq(enterpriseMembers.enterpriseId, id)));
    if (!m) throw new DomainError('NOT_FOUND', 'Member not found');
    if (m.userId === a.userId && (body.role === 'ENTERPRISE_USER' || body.status === 'SUSPENDED')) throw new DomainError('INVALID', 'You cannot demote or suspend yourself');
    if (body.teamId) {
      const [t] = await this.c.db.select().from(teams).where(and(eq(teams.id, body.teamId), eq(teams.enterpriseId, id)));
      if (!t) throw new DomainError('NOT_FOUND', 'Team not found');
    }
    const [row] = await this.c.db.update(enterpriseMembers).set(body).where(eq(enterpriseMembers.id, m.id)).returning();
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: id, action: 'enterprise.member.update', targetType: 'user', targetId: m.userId, metadata: body });
    return row;
  }

  @Delete('members/:memberId')
  @HttpCode(204)
  @RequirePermissions('enterprise:members:manage')
  async removeMember(@Auth() a: AuthContext, @Param('memberId') memberId: string) {
    const id = ent(a);
    const [m] = await this.c.db.select().from(enterpriseMembers).where(and(eq(enterpriseMembers.id, parseUuid(memberId)), eq(enterpriseMembers.enterpriseId, id)));
    if (!m) throw new DomainError('NOT_FOUND', 'Member not found');
    if (m.userId === a.userId) throw new DomainError('INVALID', 'You cannot remove yourself');
    await this.c.db.delete(enterpriseMembers).where(eq(enterpriseMembers.id, m.id));
    await this.c.db.update(users).set({ accountType: 'INDIVIDUAL' }).where(eq(users.id, m.userId));
    await this.c.billing.ensureSubscription({ userId: m.userId }, 'free');
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: id, action: 'enterprise.member.remove', targetType: 'user', targetId: m.userId });
  }

  // ---- invitations
  @Get('invitations')
  @RequirePermissions('enterprise:members:manage')
  async invitations(@Auth() a: AuthContext) {
    return this.c.db
      .select({ id: enterpriseInvitations.id, email: enterpriseInvitations.email, role: enterpriseInvitations.role, teamId: enterpriseInvitations.teamId, expiresAt: enterpriseInvitations.expiresAt, acceptedAt: enterpriseInvitations.acceptedAt, revokedAt: enterpriseInvitations.revokedAt, createdAt: enterpriseInvitations.createdAt })
      .from(enterpriseInvitations)
      .where(eq(enterpriseInvitations.enterpriseId, ent(a)))
      .orderBy(desc(enterpriseInvitations.createdAt));
  }

  @Post('invitations')
  @RequirePermissions('enterprise:members:manage')
  @ApiZodBody(inviteMemberSchema)
  async invite(@Auth() a: AuthContext, @Body(new ZodPipe(inviteMemberSchema)) body: z.infer<typeof inviteMemberSchema>) {
    const id = ent(a);
    const { plan } = await this.c.usage.resolvePlan({ userId: a.userId, enterpriseId: id });
    const [n] = await this.c.db.select({ n: count() }).from(enterpriseMembers).where(eq(enterpriseMembers.enterpriseId, id));
    const [pendingN] = await this.c.db.select({ n: count() }).from(enterpriseInvitations).where(and(eq(enterpriseInvitations.enterpriseId, id), isNull(enterpriseInvitations.acceptedAt), isNull(enterpriseInvitations.revokedAt), gt(enterpriseInvitations.expiresAt, new Date())));
    if (plan.limits.users != null && Number(n?.n ?? 0) + Number(pendingN?.n ?? 0) >= plan.limits.users) throw new DomainError('LIMIT_EXCEEDED', `Your plan allows ${plan.limits.users} users`);
    const [existingUser] = await this.c.db.select({ id: users.id }).from(users).where(eq(users.email, body.email));
    if (existingUser) {
      const [mem] = await this.c.db.select().from(enterpriseMembers).where(eq(enterpriseMembers.userId, existingUser.id));
      if (mem) throw new DomainError('CONFLICT', mem.enterpriseId === id ? 'Already a member' : 'This user belongs to another enterprise');
    }
    const token = randomToken(32);
    const [inv] = await this.c.db
      .insert(enterpriseInvitations)
      .values({ enterpriseId: id, email: body.email, role: body.role, teamId: body.teamId ?? null, tokenHash: hashToken(token), invitedBy: a.userId, expiresAt: new Date(Date.now() + 7 * 86_400_000) })
      .returning({ id: enterpriseInvitations.id, email: enterpriseInvitations.email, expiresAt: enterpriseInvitations.expiresAt });
    const [e] = await this.c.db.select({ name: enterprises.name }).from(enterprises).where(eq(enterprises.id, id));
    const link = existingUser ? `${this.config.WEB_ORIGIN}/invitations/accept?token=${token}` : `${this.config.WEB_ORIGIN}/signup?invitation=${token}&email=${encodeURIComponent(body.email)}`;
    await this.c.mailer.send(body.email, `You're invited to join ${e!.name} on AutoApply`, `${a.fullName} invited you to join ${e!.name}.\n\n${link}\n\nThis invitation expires in 7 days.`);
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: id, action: 'enterprise.invite', targetType: 'invitation', targetId: inv!.id, metadata: { role: body.role } });
    return inv;
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermissions('enterprise:members:manage')
  async revoke(@Auth() a: AuthContext, @Param('id') invId: string) {
    await this.c.db.update(enterpriseInvitations).set({ revokedAt: new Date() }).where(and(eq(enterpriseInvitations.id, parseUuid(invId)), eq(enterpriseInvitations.enterpriseId, ent(a))));
  }

  /** An existing (individual) user accepts an invitation. */
  @Post('invitations/accept')
  @HttpCode(200)
  async accept(@Auth() a: AuthContext, @Body(new ZodPipe(z.object({ token: z.string().min(10).max(200) }))) body: { token: string }) {
    if (a.enterpriseId) throw new DomainError('CONFLICT', 'You already belong to an enterprise');
    const [inv] = await this.c.db
      .select()
      .from(enterpriseInvitations)
      .where(and(eq(enterpriseInvitations.tokenHash, hashToken(body.token)), isNull(enterpriseInvitations.acceptedAt), isNull(enterpriseInvitations.revokedAt), gt(enterpriseInvitations.expiresAt, new Date())));
    if (!inv || inv.email !== a.email) throw new DomainError('INVALID', 'Invitation is invalid, expired or for another email');
    await this.c.db.transaction(async (tx) => {
      await tx.insert(enterpriseMembers).values({ enterpriseId: inv.enterpriseId, userId: a.userId, role: inv.role, teamId: inv.teamId });
      await tx.update(enterpriseInvitations).set({ acceptedAt: new Date() }).where(eq(enterpriseInvitations.id, inv.id));
      await tx.update(users).set({ accountType: 'ENTERPRISE' }).where(eq(users.id, a.userId));
      await tx.execute(sql`update applications set enterprise_id = ${inv.enterpriseId} where user_id = ${a.userId}`);
    });
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: inv.enterpriseId, action: 'enterprise.invite.accept', targetType: 'invitation', targetId: inv.id });
    return { enterpriseId: inv.enterpriseId };
  }

  // ---- teams
  @Get('teams')
  @RequirePermissions('enterprise:read')
  async teams(@Auth() a: AuthContext) {
    const id = ent(a);
    return this.c.db
      .select({ id: teams.id, name: teams.name, createdAt: teams.createdAt, members: sql<number>`(select count(*)::int from enterprise_members m where m.team_id = ${teams.id})` })
      .from(teams)
      .where(eq(teams.enterpriseId, id))
      .orderBy(teams.name);
  }

  @Post('teams')
  @RequirePermissions('enterprise:members:manage')
  async createTeam(@Auth() a: AuthContext, @Body(new ZodPipe(createTeamSchema)) body: { name: string }) {
    const [t] = await this.c.db.insert(teams).values({ enterpriseId: ent(a), name: body.name }).returning();
    await this.c.audit.log({ actorUserId: a.userId, enterpriseId: a.enterpriseId, action: 'enterprise.team.create', targetType: 'team', targetId: t!.id });
    return t;
  }

  @Delete('teams/:id')
  @HttpCode(204)
  @RequirePermissions('enterprise:members:manage')
  async deleteTeam(@Auth() a: AuthContext, @Param('id') teamId: string) {
    await this.c.db.delete(teams).where(and(eq(teams.id, parseUuid(teamId)), eq(teams.enterpriseId, ent(a))));
  }

  // ---- analytics
  @Get('analytics')
  @RequirePermissions('enterprise:read')
  async analytics(@Auth() a: AuthContext, @Query('days') daysRaw = '30') {
    const id = ent(a);
    const since = new Date(Date.now() - Math.min(365, Number(daysRaw) || 30) * 86_400_000);
    const byStatus = await this.c.db.select({ status: applications.status, n: count() }).from(applications).where(eq(applications.enterpriseId, id)).groupBy(applications.status);
    const byTeam = await this.c.db
      .select({ team: sql<string>`coalesce(${teams.name}, 'Unassigned')`, applications: sql<number>`count(${applications.id})::int`, applied: sql<number>`sum(case when ${applications.status} = 'APPLIED' then 1 else 0 end)::int` })
      .from(enterpriseMembers)
      .leftJoin(teams, eq(teams.id, enterpriseMembers.teamId))
      .leftJoin(applications, and(eq(applications.userId, enterpriseMembers.userId), eq(applications.enterpriseId, id)))
      .where(eq(enterpriseMembers.enterpriseId, id))
      .groupBy(sql`1`);
    const daily = await this.c.db
      .select({ day: sql<string>`to_char(date_trunc('day', ${applications.createdAt}), 'YYYY-MM-DD')`, n: count() })
      .from(applications)
      .where(and(eq(applications.enterpriseId, id), gte(applications.createdAt, since)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const [ai] = await this.c.db
      .select({ tokens: sql<number>`coalesce(sum(${aiUsageLogs.inputTokens} + ${aiUsageLogs.outputTokens}),0)::int`, cost: sql<string>`coalesce(sum(${aiUsageLogs.costUsd}),0)` })
      .from(aiUsageLogs)
      .where(and(eq(aiUsageLogs.enterpriseId, id), gte(aiUsageLogs.createdAt, since)));
    return {
      applicationsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])),
      byTeam,
      daily: daily.map((d) => ({ day: d.day, count: Number(d.n) })),
      ai: { tokens: ai?.tokens ?? 0, costUsd: Number(ai?.cost ?? 0) },
    };
  }

  @Get('activity')
  @RequirePermissions('enterprise:read')
  async activity(@Auth() a: AuthContext, @Query('limit') limit?: string) {
    return this.c.db
      .select({ id: auditLogs.id, action: auditLogs.action, actorUserId: auditLogs.actorUserId, actorEmail: users.email, targetType: auditLogs.targetType, targetId: auditLogs.targetId, createdAt: auditLogs.createdAt })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(eq(auditLogs.enterpriseId, ent(a)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(Math.min(Number(limit) || 100, 500));
  }
}
