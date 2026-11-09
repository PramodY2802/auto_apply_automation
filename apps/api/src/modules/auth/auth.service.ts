import { HttpException, HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Response } from 'express';
import {
  and,
  apiTokens,
  authTokens,
  enterpriseInvitations,
  enterpriseMembers,
  enterprises,
  eq,
  gt,
  isNull,
  ne,
  rolePermissions,
  sessions,
  users,
} from '@autoapply/database';
import { DomainError, hashToken, randomToken, safeEqual } from '@autoapply/services';
import { ROLE_DEFS, type LoginInput, type Permission, type SignupInput } from '@autoapply/shared';
import { InjectConfig, InjectContainer, type AppConfig, type AuthContext, type Container } from '../../common/core';

export const SESSION_COOKIE = 'aa_session';
export const CSRF_COOKIE = 'aa_csrf';
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
// Precomputed hash used to equalize timing when the email does not exist.
let DUMMY_HASH: string | null = null;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';
}

@Injectable()
export class AuthService implements OnModuleInit {
  private rbac = new Map<string, Set<Permission>>();
  private rbacLoadedAt = 0;

  constructor(@InjectContainer() private readonly c: Container, @InjectConfig() private readonly config: AppConfig) {}

  async onModuleInit() {
    DUMMY_HASH ??= await hash('not-a-real-password-0', ARGON);
    await this.loadRbac();
  }

  /** Role → permission mapping from the database (falls back to the code default). */
  async loadRbac(force = false) {
    if (!force && Date.now() - this.rbacLoadedAt < 60_000 && this.rbac.size) return;
    const rows = await this.c.db.select().from(rolePermissions);
    const map = new Map<string, Set<Permission>>();
    for (const r of ROLE_DEFS) map.set(r.key, new Set(r.permissions));
    if (rows.length) {
      map.forEach((s) => s.clear());
      for (const r of rows) {
        if (!map.has(r.roleKey)) map.set(r.roleKey, new Set());
        map.get(r.roleKey)!.add(r.permissionKey as Permission);
      }
    }
    this.rbac = map;
    this.rbacLoadedAt = Date.now();
  }

  private permissionsFor(platformRole: string, enterpriseRole: string | null): Set<Permission> {
    const out = new Set<Permission>(this.rbac.get(platformRole) ?? []);
    if (enterpriseRole) for (const p of this.rbac.get(enterpriseRole) ?? []) out.add(p);
    return out;
  }

  async buildContext(userId: string, extra: { sessionId?: string | null; apiTokenId?: string | null; scopes?: string[] }): Promise<AuthContext | null> {
    await this.loadRbac();
    const [u] = await this.c.db.select().from(users).where(eq(users.id, userId));
    if (!u || u.status !== 'ACTIVE') return null;
    const [m] = await this.c.db
      .select({ enterpriseId: enterpriseMembers.enterpriseId, role: enterpriseMembers.role, status: enterpriseMembers.status, entStatus: enterprises.status })
      .from(enterpriseMembers)
      .innerJoin(enterprises, eq(enterprises.id, enterpriseMembers.enterpriseId))
      .where(eq(enterpriseMembers.userId, userId));
    const activeMember = m && m.status === 'ACTIVE' && m.entStatus === 'ACTIVE' ? m : null;
    if (m && !activeMember && u.platformRole === 'USER') return null; // suspended enterprise members cannot sign in
    return {
      userId: u.id,
      email: u.email,
      fullName: u.fullName,
      platformRole: u.platformRole,
      accountType: u.accountType,
      emailVerified: !!u.emailVerifiedAt,
      enterpriseId: activeMember?.enterpriseId ?? null,
      enterpriseRole: activeMember?.role ?? null,
      permissions: this.permissionsFor(u.platformRole, activeMember?.role ?? null),
      sessionId: extra.sessionId ?? null,
      apiTokenId: extra.apiTokenId ?? null,
      apiTokenScopes: extra.scopes ?? [],
    };
  }

  // ------------------------------------------------------------- sessions
  async resolveSession(token: string): Promise<{ ctx: AuthContext; csrfToken: string } | null> {
    const [s] = await this.c.db.select().from(sessions).where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
    if (!s) return null;
    if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) {
      await this.c.db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, s.id));
    }
    const ctx = await this.buildContext(s.userId, { sessionId: s.id });
    return ctx ? { ctx, csrfToken: s.csrfToken } : null;
  }

  async resolveApiToken(token: string): Promise<AuthContext | null> {
    if (!token.startsWith('aa_pat_')) return null;
    const [t] = await this.c.db.select().from(apiTokens).where(and(eq(apiTokens.tokenHash, hashToken(token)), isNull(apiTokens.revokedAt)));
    if (!t || (t.expiresAt && t.expiresAt < new Date())) return null;
    if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) await this.c.db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, t.id));
    return this.buildContext(t.userId, { apiTokenId: t.id, scopes: t.scopes });
  }

  checkCsrf(expected: string, provided: string | undefined): boolean {
    return !!provided && safeEqual(expected, provided);
  }

  private async createSession(userId: string, res: Response, meta: { ip: string | null; userAgent: string | null }) {
    const token = randomToken(32);
    const csrf = randomToken(24);
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_DAYS * 86_400_000);
    await this.c.db.insert(sessions).values({ userId, tokenHash: hashToken(token), csrfToken: csrf, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) ?? null, expiresAt });
    const base = { secure: this.config.COOKIE_SECURE, sameSite: 'lax' as const, path: '/', domain: this.config.COOKIE_DOMAIN, expires: expiresAt };
    res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
    res.cookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false });
    return { csrfToken: csrf, expiresAt };
  }

  clearCookies(res: Response) {
    const base = { path: '/', domain: this.config.COOKIE_DOMAIN };
    res.clearCookie(SESSION_COOKIE, base);
    res.clearCookie(CSRF_COOKIE, base);
  }

  // ------------------------------------------------------------- signup / login
  async signup(input: SignupInput, res: Response, meta: { ip: string | null; userAgent: string | null }) {
    const open = await this.c.settings.get<boolean>('features.registrationOpen', true);
    if (!open && !input.invitationToken) throw new DomainError('FORBIDDEN', 'Registration is currently invite-only');
    const [exists] = await this.c.db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
    if (exists) throw new DomainError('CONFLICT', 'An account with this email already exists');

    let invitation: typeof enterpriseInvitations.$inferSelect | undefined;
    if (input.invitationToken) {
      [invitation] = await this.c.db
        .select()
        .from(enterpriseInvitations)
        .where(and(eq(enterpriseInvitations.tokenHash, hashToken(input.invitationToken)), isNull(enterpriseInvitations.acceptedAt), isNull(enterpriseInvitations.revokedAt), gt(enterpriseInvitations.expiresAt, new Date())));
      if (!invitation) throw new DomainError('INVALID', 'Invitation is invalid or expired');
      if (invitation.email !== input.email) throw new DomainError('INVALID', 'Invitation was sent to a different email address');
    }
    if (input.accountType === 'ENTERPRISE' && !invitation && !input.enterpriseName) throw new DomainError('INVALID', 'Enterprise name is required');

    const passwordHash = await hash(input.password, ARGON);
    const isEnterprise = !!invitation || input.accountType === 'ENTERPRISE';
    const { user, enterpriseId } = await this.c.db.transaction(async (tx) => {
      const [user] = await tx.insert(users).values({ email: input.email, passwordHash, fullName: input.fullName, accountType: isEnterprise ? 'ENTERPRISE' : 'INDIVIDUAL' }).returning();
      let enterpriseId: string | null = null;
      if (invitation) {
        enterpriseId = invitation.enterpriseId;
        await tx.insert(enterpriseMembers).values({ enterpriseId, userId: user!.id, role: invitation.role, teamId: invitation.teamId });
        await tx.update(enterpriseInvitations).set({ acceptedAt: new Date() }).where(eq(enterpriseInvitations.id, invitation.id));
      } else if (input.accountType === 'ENTERPRISE') {
        const [ent] = await tx
          .insert(enterprises)
          .values({ name: input.enterpriseName!, slug: `${slugify(input.enterpriseName!)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`, createdBy: user!.id })
          .returning();
        enterpriseId = ent!.id;
        await tx.insert(enterpriseMembers).values({ enterpriseId, userId: user!.id, role: 'ENTERPRISE_ADMIN' });
      }
      return { user: user!, enterpriseId };
    });

    if (enterpriseId && !invitation) await this.c.billing.ensureSubscription({ enterpriseId }, 'enterprise', 'MONTHLY', { trialDays: 14 });
    if (!enterpriseId) await this.c.billing.ensureSubscription({ userId: user.id }, 'free');
    await this.sendVerification(user.id, user.email);
    await this.c.audit.log({ actorUserId: user.id, enterpriseId, action: 'auth.signup', targetType: 'user', targetId: user.id, ip: meta.ip, metadata: { accountType: user.accountType, viaInvitation: !!invitation } });
    const session = await this.createSession(user.id, res, meta);
    return { userId: user.id, ...session };
  }

  async login(input: LoginInput, res: Response, meta: { ip: string | null; userAgent: string | null }) {
    const fail = () => new HttpException({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' }, HttpStatus.UNAUTHORIZED);
    const [u] = await this.c.db.select().from(users).where(eq(users.email, input.email));
    if (!u) {
      await verify(DUMMY_HASH!, input.password).catch(() => false);
      throw fail();
    }
    if (u.lockedUntil && u.lockedUntil > new Date()) throw new HttpException({ code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Try again later or reset your password.' }, HttpStatus.TOO_MANY_REQUESTS);
    const ok = await verify(u.passwordHash, input.password).catch(() => false);
    if (!ok) {
      const failed = u.failedLoginCount + 1;
      await this.c.db
        .update(users)
        .set({ failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed, lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where(eq(users.id, u.id));
      await this.c.audit.log({ actorUserId: u.id, action: 'auth.login_failed', ip: meta.ip });
      throw fail();
    }
    if (u.status !== 'ACTIVE') throw new HttpException({ code: 'ACCOUNT_DISABLED', message: 'This account is not active' }, HttpStatus.FORBIDDEN);
    const ctx = await this.buildContext(u.id, {});
    if (!ctx) throw new HttpException({ code: 'ACCOUNT_DISABLED', message: 'This account is not active' }, HttpStatus.FORBIDDEN);
    await this.c.db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
    await this.c.audit.log({ actorUserId: u.id, enterpriseId: ctx.enterpriseId, action: 'auth.login', ip: meta.ip });
    const session = await this.createSession(u.id, res, meta);
    return { userId: u.id, ...session };
  }

  async logout(sessionId: string | null, res: Response) {
    if (sessionId) await this.c.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
    this.clearCookies(res);
  }

  // ------------------------------------------------------------- email verification & reset
  async sendVerification(userId: string, email: string) {
    const token = randomToken(32);
    await this.c.db.insert(authTokens).values({ userId, type: 'EMAIL_VERIFICATION', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 48 * 3600_000) });
    await this.c.mailer.send(email, 'Verify your AutoApply email', `Confirm your email address:\n${this.config.WEB_ORIGIN}/verify-email?token=${token}\n\nThis link expires in 48 hours.`);
  }

  async verifyEmail(token: string) {
    const [t] = await this.c.db.select().from(authTokens).where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.type, 'EMAIL_VERIFICATION'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())));
    if (!t) throw new DomainError('INVALID', 'Verification link is invalid or expired');
    await this.c.db.transaction(async (tx) => {
      await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, t.id));
      await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, t.userId));
    });
    await this.c.audit.log({ actorUserId: t.userId, action: 'auth.email_verified' });
  }

  async requestPasswordReset(email: string) {
    const [u] = await this.c.db.select().from(users).where(and(eq(users.email, email), eq(users.status, 'ACTIVE')));
    if (!u) return; // never reveal whether the email exists
    const token = randomToken(32);
    await this.c.db.insert(authTokens).values({ userId: u.id, type: 'PASSWORD_RESET', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600_000) });
    await this.c.mailer.send(u.email, 'Reset your AutoApply password', `Reset your password:\n${this.config.WEB_ORIGIN}/reset-password?token=${token}\n\nThis link expires in 1 hour. If you didn't request it, ignore this email.`);
    await this.c.audit.log({ actorUserId: u.id, action: 'auth.password_reset_requested' });
  }

  async resetPassword(token: string, password: string) {
    const [t] = await this.c.db.select().from(authTokens).where(and(eq(authTokens.tokenHash, hashToken(token)), eq(authTokens.type, 'PASSWORD_RESET'), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())));
    if (!t) throw new DomainError('INVALID', 'Reset link is invalid or expired');
    const passwordHash = await hash(password, ARGON);
    await this.c.db.transaction(async (tx) => {
      await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, t.id));
      await tx.update(users).set({ passwordHash, failedLoginCount: 0, lockedUntil: null }).where(eq(users.id, t.userId));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, t.userId), isNull(sessions.revokedAt)));
    });
    await this.c.audit.log({ actorUserId: t.userId, action: 'auth.password_reset' });
  }

  async changePassword(auth: AuthContext, current: string, next: string) {
    const [u] = await this.c.db.select().from(users).where(eq(users.id, auth.userId));
    if (!u || !(await verify(u.passwordHash, current).catch(() => false))) throw new DomainError('INVALID', 'Current password is incorrect');
    const passwordHash = await hash(next, ARGON);
    await this.c.db.update(users).set({ passwordHash }).where(eq(users.id, u.id));
    await this.c.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt), auth.sessionId ? ne(sessions.id, auth.sessionId) : undefined));
    await this.c.audit.log({ actorUserId: u.id, action: 'auth.password_changed' });
  }

  async hashPassword(p: string) {
    return hash(p, ARGON);
  }
}
