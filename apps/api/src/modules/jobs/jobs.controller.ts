import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  and,
  applications,
  asc,
  candidatePreferences,
  count,
  desc,
  eq,
  ilike,
  inArray,
  jobDiscoveryRuns,
  jobMatches,
  jobs,
  jobSources,
  or,
  platformConnections,
  sql,
  type SQL,
} from '@autoapply/database';
import { normalizeJobPosting, platformFromUrl } from '@autoapply/platform-integrations';
import { DomainError, QUEUES } from '@autoapply/services';
import { APPLICATION_MODES, JOB_VIEWS, PLATFORM_KEYS, capturedJobSchema, jobListQuerySchema, type JobListQuery, type JobView, type PlatformKey } from '@autoapply/shared';
import { AllowApiToken, ApiZodBody, Auth, InjectContainer, RequirePermissions, ZodPipe, actorOf, parseUuid, type AuthContext, type Container } from '../../common/core';
import { MATCH_DISCLAIMER } from '@autoapply/matching-engine';

const VIEW_STATUS: Partial<Record<JobView, string[]>> = {
  READY_TO_APPLY: ['READY_TO_APPLY'],
  IN_PROGRESS: ['IN_PROGRESS', 'PENDING_APPROVAL'],
  APPLIED: ['APPLIED'],
  FAILED: ['FAILED'],
  REJECTED: ['REJECTED'],
  INTERVIEW: ['INTERVIEW'],
  OFFER: ['OFFER'],
  WITHDRAWN: ['WITHDRAWN'],
  NEEDS_VERIFICATION: ['NEEDS_VERIFICATION', 'UNKNOWN'],
};

function viewFilter(view: JobView): SQL | undefined {
  switch (view) {
    case 'ALL':
      return eq(jobMatches.hidden, false);
    case 'NEW':
      return and(eq(jobMatches.isNew, true), eq(jobMatches.hidden, false));
    case 'RECOMMENDED':
      return and(eq(jobMatches.hidden, false), eq(jobMatches.disqualified, false), sql`${jobMatches.overallScore} >= 70`, sql`${applications.id} is null`);
    case 'NOT_APPLIED':
      return and(eq(jobMatches.hidden, false), or(sql`${applications.id} is null`, inArray(applications.status, ['NOT_APPLIED', 'DISCOVERED'])));
    default:
      return inArray(applications.status, VIEW_STATUS[view] as any);
  }
}

@ApiTags('jobs')
@Controller({ path: 'jobs', version: '1' })
export class JobsController {
  constructor(@InjectContainer() private readonly c: Container) {}

  @Get()
  @RequirePermissions('jobs:read')
  async list(@Auth() a: AuthContext, @Query(new ZodPipe(jobListQuerySchema)) q: JobListQuery) {
    const view = (JOB_VIEWS as readonly string[]).includes(q.view) ? (q.view as JobView) : 'ALL';
    const conds: (SQL | undefined)[] = [eq(jobMatches.userId, a.userId), viewFilter(view)];
    if (q.q) conds.push(or(ilike(jobs.title, `%${q.q}%`), ilike(jobs.company, `%${q.q}%`), ilike(jobs.location, `%${q.q}%`)));
    if (q.minScore != null) conds.push(sql`${jobMatches.overallScore} >= ${q.minScore}`);
    if (q.workMode) conds.push(eq(jobs.workMode, q.workMode));
    if (q.platform) conds.push(sql`exists (select 1 from job_sources s where s.job_id = ${jobs.id} and s.platform = ${q.platform})`);
    const where = and(...conds);
    const dir = q.order === 'asc' ? asc : desc;
    const orderBy = q.sort === 'posted' ? dir(jobs.postedAt) : q.sort === 'discovered' ? dir(jobMatches.createdAt) : q.sort === 'company' ? dir(jobs.company) : dir(jobMatches.overallScore);
    const base = this.c.db
      .select({
        jobId: jobs.id,
        title: jobs.title,
        company: jobs.company,
        location: jobs.location,
        workMode: jobs.workMode,
        employmentType: jobs.employmentType,
        salaryMin: jobs.salaryMin,
        salaryMax: jobs.salaryMax,
        salaryCurrency: jobs.salaryCurrency,
        salaryPeriod: jobs.salaryPeriod,
        postedAt: jobs.postedAt,
        url: jobs.url,
        discoveredAt: jobMatches.createdAt,
        score: jobMatches.overallScore,
        skillScore: jobMatches.skillScore,
        missingSkills: jobMatches.missingSkills,
        matchedSkills: jobMatches.matchedSkills,
        disqualified: jobMatches.disqualified,
        summary: sql<string>`${jobMatches.explanation}->>'summary'`,
        isNew: jobMatches.isNew,
        saved: jobMatches.saved,
        hidden: jobMatches.hidden,
        applicationId: applications.id,
        applicationStatus: applications.status,
        platforms: sql<string[]>`(select array_agg(distinct s.platform) from job_sources s where s.job_id = ${jobs.id})`,
      })
      .from(jobMatches)
      .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
      .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, a.userId)));
    const [items, [total]] = await Promise.all([
      base.where(where).orderBy(orderBy, desc(jobMatches.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.c.db
        .select({ n: count() })
        .from(jobMatches)
        .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
        .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, a.userId)))
        .where(where),
    ]);
    return { items, page: q.page, pageSize: q.pageSize, total: Number(total?.n ?? 0), view, disclaimer: MATCH_DISCLAIMER };
  }

  @Get('views/counts')
  @RequirePermissions('jobs:read')
  async counts(@Auth() a: AuthContext) {
    const out: Record<string, number> = {};
    for (const v of JOB_VIEWS) {
      const [r] = await this.c.db
        .select({ n: count() })
        .from(jobMatches)
        .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
        .leftJoin(applications, and(eq(applications.jobId, jobs.id), eq(applications.userId, a.userId)))
        .where(and(eq(jobMatches.userId, a.userId), viewFilter(v)));
      out[v] = Number(r?.n ?? 0);
    }
    return out;
  }

  @Get(':id')
  @RequirePermissions('jobs:read')
  async get(@Auth() a: AuthContext, @Param('id') id: string) {
    const jobId = parseUuid(id);
    const [match] = await this.c.db.select().from(jobMatches).where(and(eq(jobMatches.userId, a.userId), eq(jobMatches.jobId, jobId)));
    if (!match) throw new DomainError('NOT_FOUND', 'Job not found in your feed');
    const [job] = await this.c.db.select().from(jobs).where(eq(jobs.id, jobId));
    const sources = await this.c.db.select({ id: jobSources.id, platform: jobSources.platform, url: jobSources.url, applyUrl: jobSources.applyUrl, firstSeenAt: jobSources.firstSeenAt, lastSeenAt: jobSources.lastSeenAt }).from(jobSources).where(eq(jobSources.jobId, jobId));
    const [app] = await this.c.db.select({ id: applications.id, status: applications.status, mode: applications.mode, submittedAt: applications.submittedAt }).from(applications).where(and(eq(applications.userId, a.userId), eq(applications.jobId, jobId)));
    if (match.isNew) await this.c.db.update(jobMatches).set({ isNew: false }).where(eq(jobMatches.id, match.id));
    const caps = sources.map((s) => ({ platform: s.platform, ...this.c.registry.get(s.platform as PlatformKey).capabilities.submitApplication }));
    return { job, sources, match, application: app ?? null, applyCapabilities: caps, disclaimer: MATCH_DISCLAIMER };
  }

  @Post(':id/flags/:action')
  @HttpCode(204)
  @RequirePermissions('jobs:read')
  async flag(@Auth() a: AuthContext, @Param('id') id: string, @Param('action') action: string) {
    const set = ({ hide: { hidden: true }, unhide: { hidden: false }, save: { saved: true }, unsave: { saved: false }, seen: { isNew: false } } as Record<string, object>)[action];
    if (!set) throw new DomainError('INVALID', 'Unknown action');
    const r = await this.c.db.update(jobMatches).set(set).where(and(eq(jobMatches.userId, a.userId), eq(jobMatches.jobId, parseUuid(id)))).returning({ id: jobMatches.id });
    if (!r.length) throw new DomainError('NOT_FOUND', 'Job not found in your feed');
  }

  @Post('bulk')
  @HttpCode(200)
  @RequirePermissions('jobs:read')
  async bulk(@Auth() a: AuthContext, @Body(new ZodPipe(z.object({ action: z.enum(['hide', 'save', 'seen', 'apply']), jobIds: z.array(z.string().uuid()).min(1).max(100), mode: z.enum(APPLICATION_MODES).default('MANUAL') }))) body: { action: string; jobIds: string[]; mode: 'MANUAL' | 'AUTOMATIC' }) {
    if (body.action !== 'apply') {
      const set = { hide: { hidden: true }, save: { saved: true }, seen: { isNew: false } }[body.action as 'hide']!;
      const r = await this.c.db.update(jobMatches).set(set).where(and(eq(jobMatches.userId, a.userId), inArray(jobMatches.jobId, body.jobIds))).returning({ id: jobMatches.id });
      return { updated: r.length };
    }
    if (!a.permissions.has('applications:manage')) throw new DomainError('FORBIDDEN', 'Not allowed');
    const results: { jobId: string; applicationId?: string; error?: string }[] = [];
    for (const jobId of body.jobIds) {
      try {
        const app = await this.c.applications.create(actorOf(a), { jobId, mode: body.mode });
        results.push({ jobId, applicationId: app.id });
      } catch (e: any) {
        results.push({ jobId, error: e.message });
      }
    }
    return { results };
  }

  /** Browser extension: capture a job from the page the user is viewing. */
  @Post('capture')
  @AllowApiToken('extension')
  @RequirePermissions('jobs:read')
  @ApiZodBody(capturedJobSchema)
  async capture(@Auth() a: AuthContext, @Body(new ZodPipe(capturedJobSchema.extend({ jsonLd: z.unknown().optional() }))) body: z.infer<typeof capturedJobSchema> & { jsonLd?: unknown }) {
    const platform = body.platformHint ?? platformFromUrl(body.url);
    if (!platform) throw new DomainError('INVALID', 'Unsupported job site');
    const normalized = normalizeJobPosting({ captured: body, jsonLd: body.jsonLd, url: body.url, platform });
    const r = await this.c.ingest.ingest(normalized);
    await this.c.matcher.scoreForUser(a.userId, [r.jobId]);
    const [m] = await this.c.db.select({ score: jobMatches.overallScore, summary: sql<string>`${jobMatches.explanation}->>'summary'` }).from(jobMatches).where(and(eq(jobMatches.userId, a.userId), eq(jobMatches.jobId, r.jobId)));
    return { jobId: r.jobId, outcome: r.outcome, match: m ?? null, note: m ? undefined : 'Set your job preferences to get match scores' };
  }
}

@ApiTags('discovery')
@RequirePermissions('jobs:discover')
@Controller({ path: 'discovery', version: '1' })
export class DiscoveryController {
  constructor(@InjectContainer() private readonly c: Container) {}

  @Post('runs')
  @HttpCode(202)
  async start(@Auth() a: AuthContext, @Body(new ZodPipe(z.object({ platforms: z.array(z.enum(PLATFORM_KEYS)).optional() }))) body: { platforms?: PlatformKey[] }) {
    const [prefs] = await this.c.db.select().from(candidatePreferences).where(eq(candidatePreferences.userId, a.userId));
    if (!prefs) throw new DomainError('PRECONDITION', 'Set your job preferences first');
    await this.c.usage.assertWithin(actorOf(a), 'SEARCH');
    const [running] = await this.c.db.select({ id: jobDiscoveryRuns.id }).from(jobDiscoveryRuns).where(and(eq(jobDiscoveryRuns.userId, a.userId), inArray(jobDiscoveryRuns.status, ['QUEUED', 'RUNNING'])));
    if (running) throw new DomainError('CONFLICT', 'A search is already running', { runId: running.id });
    const platforms = body.platforms?.length ? body.platforms : (prefs.platforms as PlatformKey[]);
    if (!platforms.length) throw new DomainError('INVALID', 'Select at least one platform');
    const [run] = await this.c.db.insert(jobDiscoveryRuns).values({ userId: a.userId, enterpriseId: a.enterpriseId, trigger: 'MANUAL', status: 'QUEUED', platforms }).returning();
    await this.c.queues!.add(QUEUES.DISCOVERY, { runId: run!.id, userId: a.userId }, { idempotencyKey: `discovery:${run!.id}` });
    return run;
  }

  @Get('runs')
  async list(@Auth() a: AuthContext, @Query('limit') limit?: string) {
    return this.c.db.select().from(jobDiscoveryRuns).where(eq(jobDiscoveryRuns.userId, a.userId)).orderBy(desc(jobDiscoveryRuns.createdAt)).limit(Math.min(Number(limit) || 20, 100));
  }

  @Get('runs/:id')
  async get(@Auth() a: AuthContext, @Param('id') id: string) {
    const [run] = await this.c.db.select().from(jobDiscoveryRuns).where(and(eq(jobDiscoveryRuns.id, parseUuid(id)), eq(jobDiscoveryRuns.userId, a.userId)));
    if (!run) throw new DomainError('NOT_FOUND', 'Run not found');
    return run;
  }

  @Post('runs/:id/cancel')
  @HttpCode(204)
  async cancel(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.c.db.update(jobDiscoveryRuns).set({ status: 'CANCELED', finishedAt: new Date() }).where(and(eq(jobDiscoveryRuns.id, parseUuid(id)), eq(jobDiscoveryRuns.userId, a.userId), eq(jobDiscoveryRuns.status, 'QUEUED')));
  }
}

@ApiTags('platforms')
@RequirePermissions('platforms:connect')
@Controller({ path: 'platforms', version: '1' })
export class PlatformsController {
  constructor(@InjectContainer() private readonly c: Container) {}

  @Get()
  async list(@Auth() a: AuthContext) {
    const conns = await this.c.db
      .select({ platform: platformConnections.platform, status: platformConnections.status, settings: platformConnections.settings, lastValidatedAt: platformConnections.lastValidatedAt, lastError: platformConnections.lastError })
      .from(platformConnections)
      .where(eq(platformConnections.userId, a.userId));
    return this.c.registry.describe().map((d) => ({ ...d, connection: conns.find((c) => c.platform === d.key) ?? null }));
  }

  @Post(':key/connect')
  @HttpCode(200)
  async connect(@Auth() a: AuthContext, @Param('key') key: string, @Body(new ZodPipe(z.object({ settings: z.record(z.string(), z.unknown()).default({}) }))) body: { settings: Record<string, unknown> }) {
    if (!(PLATFORM_KEYS as readonly string[]).includes(key)) throw new DomainError('NOT_FOUND', 'Unknown platform');
    const adapter = this.c.registry.get(key as PlatformKey);
    const settings = Object.fromEntries(Object.entries(body.settings).filter(([k]) => ['boards', 'sites', 'baseUrl'].includes(k)));
    if (settings.baseUrl && process.env.NODE_ENV === 'production') delete settings.baseUrl; // sandbox URL is operator-configured in production
    const result = await adapter.authenticate({ userId: a.userId, settings, fetch, logger: { info() {}, warn() {}, error() {} } }, settings);
    const values = { userId: a.userId, platform: key, status: result.status, authType: adapter.capabilities.authenticate.status === 'USER_ASSISTED' ? 'EXTENSION' : 'NONE', settings: { ...(result.settings ?? settings) }, lastValidatedAt: new Date(), lastError: result.status === 'ERROR' ? result.message : null };
    await this.c.db.insert(platformConnections).values(values).onConflictDoUpdate({ target: [platformConnections.userId, platformConnections.platform], set: values });
    await this.c.audit.log({ actorUserId: a.userId, action: 'platform.connect', targetType: 'platform', targetId: key, metadata: { status: result.status } });
    return result;
  }

  @Delete(':key')
  @HttpCode(204)
  async disconnect(@Auth() a: AuthContext, @Param('key') key: string) {
    await this.c.db
      .update(platformConnections)
      .set({ status: 'DISCONNECTED', encryptedCredentials: null, settings: {}, lastValidatedAt: new Date() })
      .where(and(eq(platformConnections.userId, a.userId), eq(platformConnections.platform, key)));
    await this.c.db.execute(sql`delete from browser_sessions where user_id = ${a.userId} and platform = ${key}`);
    await this.c.audit.log({ actorUserId: a.userId, action: 'platform.disconnect', targetType: 'platform', targetId: key });
  }
}
