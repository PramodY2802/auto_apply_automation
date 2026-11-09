import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  and,
  apiTokens,
  applications,
  candidatePreferences,
  candidateProfiles,
  desc,
  eq,
  enterpriseMembers,
  enterprises,
  isNull,
  resumes,
  sessions,
  users,
} from '@autoapply/database';
import { DomainError, hashToken, randomToken } from '@autoapply/services';
import {
  changePasswordSchema,
  loginSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  signupSchema,
  updateAccountSchema,
  verifyEmailSchema,
} from '@autoapply/shared';
import { ApiZodBody, Auth, ClientIp, InjectContainer, Public, ZodPipe, actorOf, parseUuid, type AuthContext, type Container } from '../../common/core';
import { AuthService } from './auth.service';

const meta = (req: Request, ip: string | null) => ({ ip, userAgent: (req.headers['user-agent'] as string | undefined) ?? null });

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('signup')
  @ApiZodBody(signupSchema)
  async signup(@Body(new ZodPipe(signupSchema)) body: z.infer<typeof signupSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null) {
    return this.auth.signup(body, res, meta(req, ip));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response, @ClientIp() ip: string | null) {
    return this.auth.login(body, res, meta(req, ip));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Auth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(a.sessionId, res);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-email')
  @HttpCode(204)
  async verify(@Body(new ZodPipe(verifyEmailSchema)) body: { token: string }) {
    await this.auth.verifyEmail(body.token);
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(204)
  async resend(@Auth() a: AuthContext) {
    if (!a.emailVerified) await this.auth.sendVerification(a.userId, a.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(204)
  async forgot(@Body(new ZodPipe(requestPasswordResetSchema)) body: { email: string }) {
    await this.auth.requestPasswordReset(body.email);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body(new ZodPipe(resetPasswordSchema)) body: { token: string; password: string }) {
    await this.auth.resetPassword(body.token, body.password);
  }

  @Post('password/change')
  @HttpCode(204)
  async change(@Auth() a: AuthContext, @Body(new ZodPipe(changePasswordSchema)) body: { currentPassword: string; newPassword: string }) {
    await this.auth.changePassword(a, body.currentPassword, body.newPassword);
  }
}

@ApiTags('account')
@Controller({ path: 'me', version: '1' })
export class AccountController {
  constructor(@InjectContainer() private readonly c: Container, private readonly auth: AuthService) {}

  @Get()
  async me(@Auth() a: AuthContext, @Req() req: Request) {
    const [ent] = a.enterpriseId ? await this.c.db.select({ id: enterprises.id, name: enterprises.name, slug: enterprises.slug }).from(enterprises).where(eq(enterprises.id, a.enterpriseId)) : [];
    const [profile] = await this.c.db.select({ reviewedAt: candidateProfiles.reviewedAt, fullName: candidateProfiles.fullName }).from(candidateProfiles).where(eq(candidateProfiles.userId, a.userId));
    const [resume] = await this.c.db.select({ id: resumes.id }).from(resumes).where(and(eq(resumes.userId, a.userId), isNull(resumes.deletedAt))).limit(1);
    const [prefs] = await this.c.db.select({ id: candidatePreferences.id }).from(candidatePreferences).where(eq(candidatePreferences.userId, a.userId));
    const plan = await this.c.usage.resolvePlan(actorOf(a));
    return {
      user: { id: a.userId, email: a.email, fullName: a.fullName, platformRole: a.platformRole, accountType: a.accountType, emailVerified: a.emailVerified },
      enterprise: ent ? { ...ent, role: a.enterpriseRole } : null,
      permissions: [...a.permissions].sort(),
      plan: { key: plan.plan.key, name: plan.plan.name, features: plan.plan.features },
      onboarding: { resumeUploaded: !!resume, profileReviewed: !!profile?.reviewedAt, preferencesSet: !!prefs },
      csrfToken: (req as any).cookies?.aa_csrf ?? null,
    };
  }

  @Put()
  async update(@Auth() a: AuthContext, @Body(new ZodPipe(updateAccountSchema)) body: { fullName: string }) {
    await this.c.db.update(users).set({ fullName: body.fullName }).where(eq(users.id, a.userId));
    return { ok: true };
  }

  @Get('sessions')
  async sessions(@Auth() a: AuthContext) {
    const rows = await this.c.db
      .select({ id: sessions.id, ip: sessions.ip, userAgent: sessions.userAgent, createdAt: sessions.createdAt, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(and(eq(sessions.userId, a.userId), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.lastSeenAt));
    return rows.filter((r) => r.expiresAt > new Date()).map((r) => ({ ...r, current: r.id === a.sessionId }));
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revokeSession(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.c.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, parseUuid(id)), eq(sessions.userId, a.userId)));
  }

  // ---- personal API tokens (browser extension)
  @Get('api-tokens')
  async tokens(@Auth() a: AuthContext) {
    return this.c.db
      .select({ id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.tokenPrefix, scopes: apiTokens.scopes, lastUsedAt: apiTokens.lastUsedAt, expiresAt: apiTokens.expiresAt, createdAt: apiTokens.createdAt })
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, a.userId), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.createdAt));
  }

  @Post('api-tokens')
  async createToken(@Auth() a: AuthContext, @Body(new ZodPipe(z.object({ name: z.string().trim().min(1).max(60).default('Browser extension') }))) body: { name: string }) {
    if (a.apiTokenId) throw new DomainError('FORBIDDEN', 'API tokens cannot create API tokens');
    const token = `aa_pat_${randomToken(32)}`;
    const [row] = await this.c.db
      .insert(apiTokens)
      .values({ userId: a.userId, name: body.name, tokenHash: hashToken(token), tokenPrefix: token.slice(0, 12), scopes: ['extension'], expiresAt: new Date(Date.now() + 180 * 86_400_000) })
      .returning({ id: apiTokens.id, expiresAt: apiTokens.expiresAt });
    await this.c.audit.log({ actorUserId: a.userId, action: 'api_token.create', targetType: 'api_token', targetId: row!.id });
    // The plaintext token is shown exactly once.
    return { id: row!.id, token, expiresAt: row!.expiresAt, scopes: ['extension'] };
  }

  @Delete('api-tokens/:id')
  @HttpCode(204)
  async revokeToken(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.c.db.update(apiTokens).set({ revokedAt: new Date() }).where(and(eq(apiTokens.id, parseUuid(id)), eq(apiTokens.userId, a.userId)));
    await this.c.audit.log({ actorUserId: a.userId, action: 'api_token.revoke', targetType: 'api_token', targetId: id });
  }

  // ---- privacy: export & deletion
  @Get('export')
  async export(@Auth() a: AuthContext) {
    const profile = await this.c.profiles.getFull(a.userId);
    const prefs = await this.c.profiles.getPreferences(a.userId);
    const apps = await this.c.db.select().from(applications).where(eq(applications.userId, a.userId));
    const files = await this.c.db.select({ id: resumes.id, fileName: resumes.fileName, createdAt: resumes.createdAt }).from(resumes).where(eq(resumes.userId, a.userId));
    await this.c.audit.log({ actorUserId: a.userId, action: 'account.export' });
    return { exportedAt: new Date().toISOString(), account: { email: a.email, fullName: a.fullName }, profile, preferences: prefs, applications: apps, resumes: files };
  }

  /**
   * Account deletion: removes resume files from storage, deletes personal data
   * (cascades), and keeps only an anonymized audit trail.
   */
  @Delete()
  @HttpCode(204)
  async deleteAccount(@Auth() a: AuthContext, @Body(new ZodPipe(z.object({ confirm: z.literal('DELETE') }))) _body: unknown, @Res({ passthrough: true }) res: Response) {
    const [adminMembership] = await this.c.db.select().from(enterpriseMembers).where(and(eq(enterpriseMembers.userId, a.userId), eq(enterpriseMembers.role, 'ENTERPRISE_ADMIN')));
    if (adminMembership) {
      const admins = await this.c.db.select().from(enterpriseMembers).where(and(eq(enterpriseMembers.enterpriseId, adminMembership.enterpriseId), eq(enterpriseMembers.role, 'ENTERPRISE_ADMIN')));
      if (admins.length <= 1) throw new DomainError('PRECONDITION', 'Transfer enterprise admin rights before deleting your account');
    }
    const files = await this.c.db.select({ key: resumes.storageKey }).from(resumes).where(eq(resumes.userId, a.userId));
    for (const f of files) await this.c.storage.delete(f.key).catch(() => undefined);
    await this.c.audit.log({ actorUserId: null, enterpriseId: a.enterpriseId, action: 'account.deleted', targetType: 'user', targetId: a.userId });
    // Applications reference jobs with RESTRICT; delete them explicitly, then the user (cascade).
    await this.c.db.transaction(async (tx) => {
      await tx.delete(applications).where(eq(applications.userId, a.userId));
      await tx.delete(users).where(eq(users.id, a.userId));
    });
    this.auth.clearCookies(res);
  }
}
