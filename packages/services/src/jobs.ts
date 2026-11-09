import {
  and,
  candidatePreferences,
  eq,
  inArray,
  jobDiscoveryRuns,
  jobMatches,
  jobs,
  jobSources,
  platformConnections,
  resumeExtractions,
  resumes,
  sql,
  type Database,
  type DiscoveryLog,
} from '@autoapply/database';
import { ResumeExtractionPipeline } from '@autoapply/document-extraction';
import { MatchingEngine, findDuplicate, jobFingerprint } from '@autoapply/matching-engine';
import { PlatformRegistry, buildSearchQueries, type BrowserFormDriver, type PlatformContext } from '@autoapply/platform-integrations';
import { normalizeCompany, normalizeTitle, type NormalizedJob, type PlatformKey } from '@autoapply/shared';
import type { AIService } from './ai';
import { createLogger, type Logger, type SecretBox, type StorageService } from './infra';
import { DomainError, type NotificationService, type SettingsService, type UsageService, type Actor } from './platform';
import type { ProfileService } from './profile';

// ---------------------------------------------------------------------------
// Resume / document processing
// ---------------------------------------------------------------------------
export class DocumentProcessingService {
  constructor(
    private readonly db: Database,
    private readonly storage: StorageService,
    private readonly ai: AIService,
    private readonly profiles: ProfileService,
    private readonly notifications: NotificationService,
    private readonly pipeline = new ResumeExtractionPipeline(),
    private readonly logger: Logger = createLogger('documents'),
  ) {}

  async process(extractionId: string): Promise<void> {
    const [ex] = await this.db.select().from(resumeExtractions).where(eq(resumeExtractions.id, extractionId));
    if (!ex) throw new DomainError('NOT_FOUND', 'Extraction not found');
    if (ex.status === 'SUCCEEDED') return; // idempotent
    const [resume] = await this.db.select().from(resumes).where(eq(resumes.id, ex.resumeId));
    if (!resume || resume.deletedAt) {
      await this.db.update(resumeExtractions).set({ status: 'FAILED', errors: [{ step: 'load', message: 'Resume was deleted' }], completedAt: new Date() }).where(eq(resumeExtractions.id, ex.id));
      return;
    }
    const actor: Actor = { userId: resume.userId, enterpriseId: resume.enterpriseId };
    await this.db.update(resumeExtractions).set({ status: 'RUNNING', startedAt: new Date() }).where(eq(resumeExtractions.id, ex.id));
    await this.db.update(resumes).set({ status: 'PROCESSING' }).where(eq(resumes.id, resume.id));
    try {
      const buf = await this.storage.get(resume.storageKey);
      let generator;
      if (await this.ai.isConfigured(actor, 'RESUME_EXTRACTION')) {
        try {
          await this.ai.assertTokenAllowance(actor);
          generator = this.ai.resumeGenerator(actor);
        } catch (e: any) {
          this.logger.warn('AI allowance exhausted; using deterministic parser', { extractionId, reason: e.message });
        }
      }
      const r = await this.pipeline.run(buf, { generator });
      await this.db
        .update(resumeExtractions)
        .set({
          status: 'SUCCEEDED',
          documentType: r.document.kind,
          method: r.method,
          ocrEngine: r.ocrEngine,
          rawText: r.text,
          pages: r.pages.map((p) => ({ page: p.page, method: p.method, text: p.text, confidence: p.confidence, preprocessing: p.preprocessing })),
          structured: r.structured,
          fieldConfidence: r.fieldConfidence,
          warnings: r.warnings,
          aiProvider: r.aiProvider,
          aiModel: r.aiModel,
          parser: r.parser,
          errors: r.errors,
          steps: r.steps,
          completedAt: new Date(),
        })
        .where(eq(resumeExtractions.id, ex.id));
      await this.db.update(resumes).set({ status: 'EXTRACTED' }).where(eq(resumes.id, resume.id));
      // Prefill an un-reviewed profile so onboarding has data; the user still reviews and confirms.
      const existing = await this.profiles.getFull(resume.userId);
      if (!existing?.reviewedAt) {
        await this.profiles.update(resume.userId, resume.enterpriseId, { ...this.pipeline.mapper.toProfileUpdate(r.structured), sourceResumeId: resume.id, fieldConfidence: r.fieldConfidence }, 'RESUME');
      }
      await this.notifications.notify(resume.userId, {
        type: 'RESUME_EXTRACTED',
        title: 'Resume processed',
        body: `We extracted your profile from ${resume.fileName} (${r.method.toLowerCase().replace('_', ' ')}${r.parser === 'ai' ? `, ${r.aiProvider}` : ', deterministic parser'}). Please review the details.`,
        data: { resumeId: resume.id, extractionId: ex.id, warnings: r.warnings.length },
      });
    } catch (e: any) {
      this.logger.error('resume extraction failed', { extractionId, error: e.message });
      await this.db
        .update(resumeExtractions)
        .set({ status: 'FAILED', errors: [...ex.errors, { step: 'pipeline', message: e?.message ?? 'Extraction failed' }], completedAt: new Date() })
        .where(eq(resumeExtractions.id, ex.id));
      await this.db.update(resumes).set({ status: 'FAILED' }).where(eq(resumes.id, resume.id));
      await this.notifications.notify(resume.userId, { type: 'RESUME_FAILED', title: 'Resume processing failed', body: e?.message ?? 'Unknown error', data: { resumeId: resume.id } });
      if (e?.code && ['UNSUPPORTED_TYPE', 'NO_TEXT', 'CORRUPT', 'TOO_LARGE'].includes(e.code)) return; // permanent: don't retry
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Job ingestion (normalize → dedupe → store)
// ---------------------------------------------------------------------------
export interface IngestOutcome {
  jobId: string;
  sourceId: string;
  outcome: 'created' | 'new-source' | 'seen';
}

export class JobIngestService {
  constructor(private readonly db: Database) {}

  async ingest(job: NormalizedJob): Promise<IngestOutcome> {
    return this.db.transaction(async (tx) => {
      const [existingSource] = await tx.select().from(jobSources).where(and(eq(jobSources.platform, job.platform), eq(jobSources.externalId, job.externalId)));
      if (existingSource) {
        await tx.update(jobSources).set({ lastSeenAt: new Date(), url: job.url, applyUrl: job.applyUrl }).where(eq(jobSources.id, existingSource.id));
        return { jobId: existingSource.jobId, sourceId: existingSource.id, outcome: 'seen' as const };
      }
      const fingerprint = jobFingerprint(job);
      let [logical] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.fingerprint, fingerprint));
      if (!logical) {
        const company = normalizeCompany(job.company);
        const candidates = await tx
          .select({ id: jobs.id, company: jobs.company, title: jobs.title, description: jobs.description, location: jobs.location })
          .from(jobs)
          .where(eq(jobs.normalizedCompany, company))
          .limit(100);
        const dup = findDuplicate(job, candidates);
        if (dup) logical = { id: dup.id };
      }
      let outcome: IngestOutcome['outcome'] = 'new-source';
      if (!logical) {
        const [created] = await tx
          .insert(jobs)
          .values({
            fingerprint,
            title: job.title,
            normalizedTitle: normalizeTitle(job.title),
            company: job.company,
            normalizedCompany: normalizeCompany(job.company),
            description: job.description,
            skills: job.skills,
            requiredSkills: job.requiredSkills,
            optionalSkills: job.optionalSkills,
            experienceMinYears: job.experienceMinYears,
            experienceMaxYears: job.experienceMaxYears,
            location: job.location,
            city: job.city,
            country: job.country,
            workMode: job.workMode,
            employmentType: job.employmentType,
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            salaryCurrency: job.salaryCurrency,
            salaryPeriod: job.salaryPeriod,
            url: job.url,
            applyUrl: job.applyUrl,
            postedAt: job.postedAt,
          })
          .onConflictDoNothing({ target: jobs.fingerprint })
          .returning({ id: jobs.id });
        if (created) {
          logical = created;
          outcome = 'created';
        } else {
          [logical] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.fingerprint, fingerprint));
        }
      }
      const [src] = await tx
        .insert(jobSources)
        .values({ jobId: logical!.id, platform: job.platform, externalId: job.externalId, url: job.url, applyUrl: job.applyUrl, raw: (job.raw as object) ?? null })
        .onConflictDoUpdate({ target: [jobSources.platform, jobSources.externalId], set: { lastSeenAt: new Date() } })
        .returning({ id: jobSources.id });
      return { jobId: logical!.id, sourceId: src!.id, outcome };
    });
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------
export class MatchService {
  constructor(private readonly db: Database, private readonly profiles: ProfileService, private readonly settings: SettingsService) {}

  /** Scores the given jobs (or all jobs already in the user's feed) for a user. */
  async scoreForUser(userId: string, jobIds?: string[], runId?: string): Promise<{ scored: number; created: number; recommended: number }> {
    const inputs = await this.profiles.matchInputs(userId);
    if (!inputs) return { scored: 0, created: 0, recommended: 0 };
    let ids = jobIds;
    if (!ids) ids = (await this.db.select({ id: jobMatches.jobId }).from(jobMatches).where(eq(jobMatches.userId, userId))).map((r) => r.id);
    if (!ids.length) return { scored: 0, created: 0, recommended: 0 };
    const engine = new MatchingEngine(await this.settings.matchingWeights());
    let created = 0;
    let recommended = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const batch = await this.db.select().from(jobs).where(inArray(jobs.id, ids.slice(i, i + 200)));
      for (const j of batch) {
        const r = engine.score(inputs.candidate, inputs.prefs, j);
        const values = {
          userId,
          jobId: j.id,
          overallScore: r.overallScore,
          skillScore: r.skillScore,
          experienceScore: r.experienceScore,
          locationScore: r.locationScore,
          preferenceScore: r.preferenceScore,
          salaryScore: r.salaryScore,
          matchedSkills: r.matchedSkills,
          missingSkills: r.missingSkills,
          explanation: r.explanation,
          disqualified: r.disqualified,
          discoveryRunId: runId ?? null,
        };
        const [row] = await this.db
          .insert(jobMatches)
          .values(values)
          .onConflictDoUpdate({ target: [jobMatches.userId, jobMatches.jobId], set: { ...values, discoveryRunId: sql`coalesce(${jobMatches.discoveryRunId}, excluded.discovery_run_id)`, updatedAt: new Date() } })
          .returning({ createdAt: jobMatches.createdAt, updatedAt: jobMatches.updatedAt });
        if (row && Math.abs(row.createdAt.getTime() - row.updatedAt.getTime()) < 1000) created++;
        if (!r.disqualified && r.overallScore >= 70) recommended++;
      }
    }
    return { scored: ids.length, created, recommended };
  }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
export interface PlatformContextFactoryDeps {
  db: Database;
  box: SecretBox;
  browser?: BrowserFormDriver;
  fetchImpl?: typeof fetch;
}

/** Builds the PlatformContext (with decrypted credentials) for a user + platform. */
export async function platformContext(deps: PlatformContextFactoryDeps, userId: string, platform: PlatformKey, logger: Logger): Promise<{ ctx: PlatformContext; connection: typeof platformConnections.$inferSelect | null }> {
  const [connection] = await deps.db.select().from(platformConnections).where(and(eq(platformConnections.userId, userId), eq(platformConnections.platform, platform)));
  return {
    connection: connection ?? null,
    ctx: {
      userId,
      settings: connection?.settings ?? {},
      credentials: connection?.encryptedCredentials ? deps.box.decryptJson<Record<string, string>>(connection.encryptedCredentials) : null,
      fetch: deps.fetchImpl ?? fetch,
      browser: deps.browser,
      logger: logger.child({ platform }),
    },
  };
}

export class DiscoveryService {
  constructor(
    private readonly db: Database,
    private readonly box: SecretBox,
    private readonly registry: PlatformRegistry,
    private readonly ingest: JobIngestService,
    private readonly matcher: MatchService,
    private readonly usage: UsageService,
    private readonly notifications: NotificationService,
    private readonly opts: { fetchImpl?: typeof fetch; maxJobsPerPlatform?: number } = {},
    private readonly logger: Logger = createLogger('discovery'),
  ) {}

  async run(runId: string): Promise<void> {
    const [run] = await this.db.select().from(jobDiscoveryRuns).where(eq(jobDiscoveryRuns.id, runId));
    if (!run || ['SUCCEEDED', 'PARTIAL', 'CANCELED'].includes(run.status)) return;
    const logs: DiscoveryLog[] = [];
    const log = (level: DiscoveryLog['level'], message: string, platform?: string) => logs.push({ at: new Date().toISOString(), level, message, platform });
    const stats = { found: 0, created: 0, duplicates: 0, matched: 0, skipped: 0 };
    const actor: Actor = { userId: run.userId, enterpriseId: run.enterpriseId };
    await this.db.update(jobDiscoveryRuns).set({ status: 'RUNNING', startedAt: new Date() }).where(eq(jobDiscoveryRuns.id, runId));

    try {
      const [prefs] = await this.db.select().from(candidatePreferences).where(eq(candidatePreferences.userId, run.userId));
      if (!prefs) throw new DomainError('PRECONDITION', 'Set your job preferences before searching');
      const queries = buildSearchQueries({ titles: prefs.titles, locations: prefs.locations, workModes: prefs.workModes as any, maxPostingAgeDays: prefs.maxPostingAgeDays, keywords: prefs.keywords });
      await this.db.update(jobDiscoveryRuns).set({ queries }).where(eq(jobDiscoveryRuns.id, runId));
      const jobIds = new Set<string>();
      let errors = 0;

      for (const platform of run.platforms as PlatformKey[]) {
        const adapter = this.registry.get(platform);
        const cap = adapter.capabilities.searchJobs;
        if (cap.status !== 'IMPLEMENTED' && cap.status !== 'AWAITING_CREDENTIALS') {
          log('warn', `Skipped: automated search is ${cap.status.toLowerCase().replace('_', ' ')} — ${cap.note} Use the browser extension to capture jobs you view.`, platform);
          stats.skipped++;
          continue;
        }
        const { ctx, connection } = await platformContext({ db: this.db, box: this.box, fetchImpl: this.opts.fetchImpl }, run.userId, platform, this.logger);
        if (platform !== 'sandbox' && connection?.status !== 'CONNECTED') {
          log('warn', 'Skipped: platform not connected', platform);
          stats.skipped++;
          continue;
        }
        let platformCount = 0;
        for (const [i, q] of queries.entries()) {
          if (platformCount >= (this.opts.maxJobsPerPlatform ?? 100)) break;
          try {
            await this.usage.assertWithin(actor, 'SEARCH');
          } catch (e: any) {
            log('error', e.message, platform);
            errors++;
            break;
          }
          try {
            const res = await adapter.searchJobs(ctx, q);
            await this.usage.record(actor, 'SEARCH', 1, { sourceId: `${runId}:${platform}:${i}` });
            for (const w of res.warnings) log('warn', w, platform);
            log('info', `"${q.keywords}"${q.location ? ` in ${q.location}` : ''}: ${res.jobs.length} jobs (${res.examined} examined)`, platform);
            for (const job of res.jobs) {
              if (platformCount >= (this.opts.maxJobsPerPlatform ?? 100)) break;
              stats.found++;
              platformCount++;
              const r = await this.ingest.ingest(job);
              if (r.outcome === 'created') stats.created++;
              else stats.duplicates++;
              jobIds.add(r.jobId);
            }
          } catch (e: any) {
            errors++;
            log('error', `Search "${q.keywords}" failed: ${e.message}`, platform);
          }
        }
      }

      const m = await this.matcher.scoreForUser(run.userId, [...jobIds], runId);
      stats.matched = m.scored;
      const status = errors && !jobIds.size ? 'FAILED' : errors || stats.skipped ? 'PARTIAL' : 'SUCCEEDED';
      await this.db.update(jobDiscoveryRuns).set({ status, stats, logs, finishedAt: new Date(), error: status === 'FAILED' ? 'All searches failed' : null }).where(eq(jobDiscoveryRuns.id, runId));
      if (m.recommended > 0) {
        await this.notifications.notify(run.userId, { type: 'NEW_MATCHES', title: `${m.recommended} recommended job${m.recommended === 1 ? '' : 's'} found`, body: `Discovery found ${stats.found} jobs (${stats.created} new).`, data: { runId } });
      }
      const freqHours = { MANUAL: null, DAILY: 24, TWICE_DAILY: 12, WEEKLY: 168 }[prefs.searchFrequency];
      if (freqHours) await this.db.update(candidatePreferences).set({ nextSearchAt: new Date(Date.now() + freqHours * 3600_000) }).where(eq(candidatePreferences.id, prefs.id));
    } catch (e: any) {
      log('error', e.message);
      await this.db.update(jobDiscoveryRuns).set({ status: 'FAILED', stats, logs, error: e.message, finishedAt: new Date() }).where(eq(jobDiscoveryRuns.id, runId));
      if (!(e instanceof DomainError)) throw e;
    }
  }
}
