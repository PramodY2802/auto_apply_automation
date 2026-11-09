import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  and,
  applicationAnswers,
  applicationEvents,
  applications,
  applicationStatusHistory,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  jobs,
  jobSources,
  or,
  platformConnections,
  savedAnswers,
  sql,
} from '@autoapply/database';
import { normalizeJobPosting, platformFromUrl } from '@autoapply/platform-integrations';
import { DomainError, QUEUES } from '@autoapply/services';
import {
  APPLICATION_STATUSES,
  PLATFORM_KEYS,
  capturedJobSchema,
  createApplicationSchema,
  externalApplicationSchema,
  updateAnswerSchema,
  updateApplicationStatusSchema,
  type ApplicationStatus,
  type PlatformKey,
} from '@autoapply/shared';
import { AllowApiToken, ApiZodBody, Auth, InjectConfig, InjectContainer, RequirePermissions, ZodPipe, actorOf, parseUuid, type AppConfig, type AuthContext, type Container } from '../../common/core';

@ApiTags('applications')
@RequirePermissions('applications:manage')
@Controller({ path: 'applications', version: '1' })
export class ApplicationsController {
  constructor(@InjectContainer() private readonly c: Container, @InjectConfig() private readonly config: AppConfig) {}

  @Get()
  async list(@Auth() a: AuthContext, @Query('status') status?: string, @Query('page') pageRaw?: string, @Query('pageSize') sizeRaw?: string) {
    const page = Math.max(1, Number(pageRaw) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sizeRaw) || 25));
    const statuses = status?.split(',').filter((s) => (APPLICATION_STATUSES as readonly string[]).includes(s)) as ApplicationStatus[] | undefined;
    const where = and(eq(applications.userId, a.userId), statuses?.length ? inArray(applications.status, statuses) : undefined);
    const [items, [total]] = await Promise.all([
      this.c.db
        .select({
          id: applications.id,
          status: applications.status,
          mode: applications.mode,
          source: applications.source,
          platform: applications.platform,
          submittedAt: applications.submittedAt,
          updatedAt: applications.updatedAt,
          createdAt: applications.createdAt,
          lastSyncedAt: applications.lastSyncedAt,
          externalApplicationId: applications.externalApplicationId,
          error: applications.error,
          jobId: jobs.id,
          title: jobs.title,
          company: jobs.company,
          location: jobs.location,
          pendingAnswers: sql<number>`(select count(*)::int from application_answers aa where aa.application_id = ${applications.id} and (aa.approval_status = 'PENDING' or aa.requires_user_input))`,
        })
        .from(applications)
        .innerJoin(jobs, eq(jobs.id, applications.jobId))
        .where(where)
        .orderBy(desc(applications.updatedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.c.db.select({ n: count() }).from(applications).where(where),
    ]);
    return { items, page, pageSize, total: Number(total?.n ?? 0) };
  }

  @Get('stats')
  async stats(@Auth() a: AuthContext) {
    const byStatus = await this.c.db.select({ status: applications.status, n: count() }).from(applications).where(eq(applications.userId, a.userId)).groupBy(applications.status);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const daily = await this.c.db
      .select({ day: sql<string>`to_char(date_trunc('day', ${applications.submittedAt}), 'YYYY-MM-DD')`, n: count() })
      .from(applications)
      .where(and(eq(applications.userId, a.userId), gte(applications.submittedAt, since)))
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return { byStatus: Object.fromEntries(byStatus.map((r) => [r.status, Number(r.n)])), submittedLast30Days: daily.map((d) => ({ day: d.day, count: Number(d.n) })) };
  }

  @Post()
  @ApiZodBody(createApplicationSchema)
  async create(@Auth() a: AuthContext, @Body(new ZodPipe(createApplicationSchema)) body: z.infer<typeof createApplicationSchema>) {
    if (this.config.REQUIRE_EMAIL_VERIFICATION && !a.emailVerified) throw new DomainError('PRECONDITION', 'Verify your email address before applying');
    return this.c.applications.create(actorOf(a), body);
  }

  @Get(':id')
  async get(@Auth() a: AuthContext, @Param('id') id: string) {
    const app = await this.c.applications.getOwned(actorOf(a), parseUuid(id));
    const [job] = await this.c.db.select().from(jobs).where(eq(jobs.id, app.jobId));
    const [source] = app.jobSourceId ? await this.c.db.select().from(jobSources).where(eq(jobSources.id, app.jobSourceId)) : [];
    const [answers, events, history] = await Promise.all([
      this.c.db.select().from(applicationAnswers).where(eq(applicationAnswers.applicationId, app.id)).orderBy(asc(applicationAnswers.createdAt)),
      this.c.db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, app.id)).orderBy(asc(applicationEvents.createdAt)),
      this.c.db.select().from(applicationStatusHistory).where(eq(applicationStatusHistory.applicationId, app.id)).orderBy(asc(applicationStatusHistory.createdAt)),
    ]);
    const capability = source ? this.c.registry.get(source.platform as PlatformKey).capabilities.submitApplication : null;
    const { lockedAt: _l, ...safe } = app;
    return { application: safe, job, source: source ? { platform: source.platform, url: source.url, applyUrl: source.applyUrl } : null, submitCapability: capability, answers, events, history };
  }

  @Get(':id/evidence')
  async evidence(@Auth() a: AuthContext, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const app = await this.c.applications.getOwned(actorOf(a), parseUuid(id));
    const key = app.confirmation?.screenshotKey;
    if (!key) throw new DomainError('NOT_FOUND', 'No screenshot evidence');
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' });
    return new StreamableFile(await this.c.storage.get(key));
  }

  @Put(':id/answers/:answerId')
  @ApiZodBody(updateAnswerSchema)
  async updateAnswer(@Auth() a: AuthContext, @Param('id') id: string, @Param('answerId') answerId: string, @Body(new ZodPipe(updateAnswerSchema)) body: z.infer<typeof updateAnswerSchema>) {
    return this.c.applications.updateAnswer(actorOf(a), parseUuid(id), parseUuid(answerId, 'answerId'), body);
  }

  @Post(':id/approve')
  @HttpCode(202)
  async approve(@Auth() a: AuthContext, @Param('id') id: string, @Body(new ZodPipe(z.object({ confirmSensitive: z.boolean().default(false) }))) body: { confirmSensitive: boolean }) {
    if (this.config.REQUIRE_EMAIL_VERIFICATION && !a.emailVerified) throw new DomainError('PRECONDITION', 'Verify your email address before applying');
    await this.c.applications.approve(actorOf(a), parseUuid(id), body);
    return { queued: true };
  }

  @Post(':id/prepare')
  @HttpCode(202)
  async prepare(@Auth() a: AuthContext, @Param('id') id: string) {
    const app = await this.c.applications.getOwned(actorOf(a), parseUuid(id));
    if (!['READY_TO_APPLY', 'FAILED', 'PENDING_APPROVAL'].includes(app.status)) throw new DomainError('INVALID', `Cannot re-prepare an application in ${app.status}`);
    if (app.status === 'PENDING_APPROVAL') await this.c.applications.transition(app, 'READY_TO_APPLY', { reason: 'Re-prepare requested', actorUserId: a.userId, actorType: 'USER' });
    await this.c.queues!.add(QUEUES.APPLICATION_PREP, { applicationId: app.id, userId: a.userId }, { idempotencyKey: `prep:${app.id}:${Date.now()}` });
    return { queued: true };
  }

  @Post(':id/status')
  @HttpCode(200)
  @ApiZodBody(updateApplicationStatusSchema)
  async status(@Auth() a: AuthContext, @Param('id') id: string, @Body(new ZodPipe(updateApplicationStatusSchema)) body: z.infer<typeof updateApplicationStatusSchema>) {
    return this.c.applications.setStatus(actorOf(a), parseUuid(id), body.status, body.reason);
  }

  @Post(':id/confirm-submitted')
  @HttpCode(200)
  async confirm(@Auth() a: AuthContext, @Param('id') id: string, @Body(new ZodPipe(z.object({ evidence: z.string().max(2000).optional(), externalReference: z.string().max(200).optional(), confirm: z.literal(true) }))) body: { evidence?: string; externalReference?: string }) {
    return this.c.applications.confirmSubmitted(actorOf(a), parseUuid(id), { ...body, via: 'USER_CONFIRMED' });
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  async withdraw(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.c.applications.withdraw(actorOf(a), parseUuid(id));
  }

  @Post(':id/sync')
  @HttpCode(202)
  async sync(@Auth() a: AuthContext, @Param('id') id: string) {
    const app = await this.c.applications.getOwned(actorOf(a), parseUuid(id));
    await this.c.queues!.add(QUEUES.APPLICATION_SYNC, { applicationId: app.id }, { idempotencyKey: `sync:${app.id}:${Math.floor(Date.now() / 60_000)}` });
    return { queued: true };
  }

  @Post('external')
  @ApiZodBody(externalApplicationSchema)
  async external(@Auth() a: AuthContext, @Body(new ZodPipe(externalApplicationSchema)) body: z.infer<typeof externalApplicationSchema>) {
    let jobId = body.jobId;
    let platform: string = 'sandbox';
    if (!jobId) {
      if (!body.capturedJob) throw new DomainError('INVALID', 'Provide jobId or capturedJob');
      const p = body.capturedJob.platformHint ?? platformFromUrl(body.capturedJob.url);
      if (!p) throw new DomainError('INVALID', 'Unsupported job site');
      const r = await this.c.ingest.ingest(normalizeJobPosting({ captured: body.capturedJob, url: body.capturedJob.url, platform: p }));
      await this.c.matcher.scoreForUser(a.userId, [r.jobId]);
      jobId = r.jobId;
      platform = p;
    } else {
      const [src] = await this.c.db.select({ platform: jobSources.platform }).from(jobSources).where(eq(jobSources.jobId, jobId)).limit(1);
      if (!src) throw new DomainError('NOT_FOUND', 'Job not found');
      platform = src.platform;
    }
    return this.c.applications.recordExternal(actorOf(a), jobId, platform, { userConfirmed: body.userConfirmed, appliedAt: body.appliedAt, evidence: body.evidence });
  }
}

@ApiTags('applications')
@RequirePermissions('applications:manage')
@Controller({ path: 'saved-answers', version: '1' })
export class SavedAnswersController {
  constructor(@InjectContainer() private readonly c: Container) {}

  @Get()
  async list(@Auth() a: AuthContext) {
    return this.c.db.select().from(savedAnswers).where(eq(savedAnswers.userId, a.userId)).orderBy(desc(savedAnswers.updatedAt));
  }

  @Put(':id')
  async update(@Auth() a: AuthContext, @Param('id') id: string, @Body(new ZodPipe(z.object({ answer: z.string().min(1).max(10_000) }))) body: { answer: string }) {
    const [r] = await this.c.db.update(savedAnswers).set({ answer: body.answer }).where(and(eq(savedAnswers.id, parseUuid(id)), eq(savedAnswers.userId, a.userId))).returning();
    if (!r) throw new DomainError('NOT_FOUND', 'Saved answer not found');
    return r;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.c.db.delete(savedAnswers).where(and(eq(savedAnswers.id, parseUuid(id)), eq(savedAnswers.userId, a.userId)));
  }
}

function urlKey(u: string): string {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/^www\./, '')}${x.pathname.replace(/\/apply\/?$/, '').replace(/\/$/, '')}`;
  } catch {
    return u;
  }
}

/** Browser extension API (personal API token with the "extension" scope, or a session). */
@ApiTags('extension')
@Controller({ path: 'extension', version: '1' })
export class ExtensionController {
  constructor(@InjectContainer() private readonly c: Container) {}

  @Get('status')
  @AllowApiToken('extension')
  async status(@Auth() a: AuthContext) {
    const conns = await this.c.db.select({ platform: platformConnections.platform, status: platformConnections.status }).from(platformConnections).where(eq(platformConnections.userId, a.userId));
    return { user: { email: a.email, fullName: a.fullName }, connections: conns, apiVersion: 'v1' };
  }

  @Post('platform-session')
  @AllowApiToken('extension')
  @HttpCode(204)
  async platformSession(@Auth() a: AuthContext, @Body(new ZodPipe(z.object({ platform: z.enum(PLATFORM_KEYS) }))) body: { platform: PlatformKey }) {
    const settings = { extensionLastSeenAt: new Date().toISOString() };
    await this.c.db
      .insert(platformConnections)
      .values({ userId: a.userId, platform: body.platform, status: 'CONNECTED', authType: 'EXTENSION', settings, lastValidatedAt: new Date() })
      .onConflictDoUpdate({ target: [platformConnections.userId, platformConnections.platform], set: { status: 'CONNECTED', authType: 'EXTENSION', settings: sql`${platformConnections.settings} || ${JSON.stringify(settings)}::jsonb`, lastValidatedAt: new Date() } });
  }

  /** Approved answers for the application form at this URL (user-assisted filling). */
  @Get('prepared')
  @AllowApiToken('extension')
  @RequirePermissions('applications:manage')
  async prepared(@Auth() a: AuthContext, @Query('url') url: string) {
    if (!url) throw new DomainError('INVALID', 'url is required');
    const key = urlKey(url);
    const rows = await this.c.db
      .select({ appId: applications.id, status: applications.status, url: jobSources.url, applyUrl: jobSources.applyUrl, title: jobs.title, company: jobs.company })
      .from(applications)
      .innerJoin(jobSources, eq(jobSources.id, applications.jobSourceId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .where(and(eq(applications.userId, a.userId), inArray(applications.status, ['READY_TO_APPLY', 'PENDING_APPROVAL', 'IN_PROGRESS'])));
    const app = rows.find((r) => urlKey(r.url) === key || (r.applyUrl && urlKey(r.applyUrl) === key));
    if (!app) return { application: null };
    const answers = await this.c.db.select().from(applicationAnswers).where(eq(applicationAnswers.applicationId, app.appId));
    return {
      application: { id: app.appId, status: app.status, title: app.title, company: app.company },
      fields: answers.map((x) => ({
        key: x.fieldKey,
        label: x.question,
        type: x.questionType,
        // Only answers the user approved (or verified profile facts) are sent for filling.
        value: x.approvalStatus === 'APPROVED' || x.approvalStatus === 'AUTO_APPROVED' ? x.answer : null,
        needsReview: x.approvalStatus === 'PENDING' || x.requiresUserInput,
        sensitive: x.isSensitive,
      })),
    };
  }

  @Post('events')
  @AllowApiToken('extension')
  @RequirePermissions('applications:manage')
  @HttpCode(200)
  async events(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(z.object({ type: z.literal('APPLICATION_SUBMITTED'), url: z.string().url(), userConfirmed: z.boolean(), confirmationText: z.string().max(1000).optional(), externalReference: z.string().max(200).optional(), capturedJob: capturedJobSchema.optional() })))
    body: { url: string; userConfirmed: boolean; confirmationText?: string; externalReference?: string; capturedJob?: z.infer<typeof capturedJobSchema> },
  ) {
    const key = urlKey(body.url);
    const rows = await this.c.db
      .select({ id: applications.id, url: jobSources.url, applyUrl: jobSources.applyUrl })
      .from(applications)
      .innerJoin(jobSources, eq(jobSources.id, applications.jobSourceId))
      .where(and(eq(applications.userId, a.userId), or(sql`true`)));
    const match = rows.find((r) => urlKey(r.url) === key || (r.applyUrl && urlKey(r.applyUrl) === key));
    if (match) {
      await this.c.applications.event(match.id, 'EXTENSION_EVENT', `Extension observed a submission${body.confirmationText ? `: "${body.confirmationText.slice(0, 120)}"` : ''}`, { url: body.url }, a.userId);
      if (body.userConfirmed) return this.c.applications.confirmSubmitted(actorOf(a), match.id, { evidence: body.confirmationText, externalReference: body.externalReference, via: 'EXTENSION_EVENT' });
      const app = await this.c.applications.getOwned(actorOf(a), match.id);
      if (app.status !== 'APPLIED') return this.c.applications.transition(app, 'NEEDS_VERIFICATION', { force: true, reason: 'Extension reported a submission; awaiting your confirmation', actorUserId: a.userId, actorType: 'USER' });
      return app;
    }
    if (!body.capturedJob) throw new DomainError('NOT_FOUND', 'No tracked application for this page; include capturedJob to record it');
    const p = body.capturedJob.platformHint ?? platformFromUrl(body.capturedJob.url) ?? 'sandbox';
    const r = await this.c.ingest.ingest(normalizeJobPosting({ captured: body.capturedJob, url: body.capturedJob.url, platform: p }));
    await this.c.matcher.scoreForUser(a.userId, [r.jobId]);
    return this.c.applications.recordExternal(actorOf(a), r.jobId, p, { userConfirmed: body.userConfirmed, evidence: body.confirmationText });
  }
}
