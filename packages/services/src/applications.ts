import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AnswerEngine, classifyIntent } from '@autoapply/answer-engine';
import {
  and,
  applicationAnswers,
  applicationEvents,
  applications,
  applicationStatusHistory,
  candidatePreferences,
  desc,
  eq,
  inArray,
  isNull,
  jobMatches,
  jobs,
  jobSources,
  lt,
  or,
  resumes,
  savedAnswers,
  sql,
  type ConfirmationEvidence,
  type Database,
  type DbExecutor,
} from '@autoapply/database';
import { PlatformRegistry, UnsupportedOperationError, type BrowserFormDriver, type FormFillValue } from '@autoapply/platform-integrations';
import { canTransition, normalizeCompany, normalizeQuestionKey, type ApplicationMode, type ApplicationStatus, type DetectedField, type PlatformKey } from '@autoapply/shared';
import type { AIService } from './ai';
import { createLogger, type Logger, type SecretBox, type StorageService } from './infra';
import { platformContext } from './jobs';
import { DomainError, type Actor, type AuditService, type NotificationService, type UsageService } from './platform';
import type { ProfileService } from './profile';

type App = typeof applications.$inferSelect;

export interface ApplicationDeps {
  db: Database;
  box: SecretBox;
  storage: StorageService;
  registry: PlatformRegistry;
  ai: AIService;
  profiles: ProfileService;
  usage: UsageService;
  notifications: NotificationService;
  audit: AuditService;
  browser?: BrowserFormDriver;
  fetchImpl?: typeof fetch;
  logger?: Logger;
  /** Enqueue hooks (provided by the API/worker queue client). */
  enqueuePrepare?: (applicationId: string, userId: string) => Promise<void>;
  enqueueSubmit?: (applicationId: string, userId: string) => Promise<void>;
}

const LOCK_TTL_MS = 10 * 60_000;
const TERMINAL_FOR_RECREATE: ApplicationStatus[] = ['WITHDRAWN', 'FAILED', 'NOT_APPLIED', 'DISCOVERED'];

/**
 * Application orchestration (auto-apply engine).
 * Invariants:
 *  - one application per (user, logical job) — DB unique constraint;
 *  - submission is guarded by an atomic lock and never auto-retried;
 *  - APPLIED is only set from a verified confirmation or explicit user confirmation;
 *  - every state change writes immutable history + event rows.
 */
export class ApplicationService {
  private readonly logger: Logger;
  constructor(private readonly d: ApplicationDeps) {
    this.logger = d.logger ?? createLogger('applications');
  }

  // ---------------------------------------------------------------- events
  async event(applicationId: string, type: string, message: string, data: Record<string, unknown> = {}, actorUserId: string | null = null, tx: DbExecutor = this.d.db) {
    await tx.insert(applicationEvents).values({ applicationId, type, message, data, actorUserId });
  }

  async transition(app: Pick<App, 'id' | 'status'>, to: ApplicationStatus, opts: { reason?: string; actorUserId?: string | null; actorType?: 'USER' | 'SYSTEM'; patch?: Partial<typeof applications.$inferInsert>; force?: boolean } = {}, tx: DbExecutor = this.d.db) {
    if (!opts.force && !canTransition(app.status, to)) throw new DomainError('INVALID', `Cannot change status from ${app.status} to ${to}`);
    const [updated] = await tx
      .update(applications)
      .set({ status: to, ...(opts.patch ?? {}) })
      .where(and(eq(applications.id, app.id), eq(applications.status, app.status)))
      .returning();
    if (!updated) throw new DomainError('CONFLICT', 'Application was modified concurrently; reload and retry');
    if (app.status !== to) {
      await tx.insert(applicationStatusHistory).values({ applicationId: app.id, fromStatus: app.status, toStatus: to, reason: opts.reason ?? null, actorUserId: opts.actorUserId ?? null, actorType: opts.actorType ?? 'SYSTEM' });
      await this.event(app.id, 'STATUS_CHANGED', `${app.status} → ${to}${opts.reason ? `: ${opts.reason}` : ''}`, { from: app.status, to }, opts.actorUserId ?? null, tx);
    }
    return updated;
  }

  async getOwned(actor: Actor, id: string): Promise<App> {
    const [a] = await this.d.db.select().from(applications).where(and(eq(applications.id, id), eq(applications.userId, actor.userId)));
    if (!a) throw new DomainError('NOT_FOUND', 'Application not found');
    return a;
  }

  // ---------------------------------------------------------------- create
  async create(actor: Actor, input: { jobId: string; mode: ApplicationMode; resumeId?: string }, actorType: 'USER' | 'SYSTEM' = 'USER'): Promise<App> {
    const [job] = await this.d.db.select().from(jobs).where(eq(jobs.id, input.jobId));
    if (!job) throw new DomainError('NOT_FOUND', 'Job not found');
    const [match] = await this.d.db.select().from(jobMatches).where(and(eq(jobMatches.userId, actor.userId), eq(jobMatches.jobId, job.id)));
    if (!match) throw new DomainError('NOT_FOUND', 'Job is not in your job feed');
    const [prefs] = await this.d.db.select().from(candidatePreferences).where(eq(candidatePreferences.userId, actor.userId));
    if (prefs?.excludedCompanies.some((c) => normalizeCompany(c) === job.normalizedCompany)) throw new DomainError('INVALID', `${job.company} is on your excluded companies list`);
    if (input.mode === 'AUTOMATIC') {
      if (!prefs?.autoApplyConsentAt) throw new DomainError('PRECONDITION', 'Automatic mode requires your explicit consent in preferences');
      await this.d.usage.assertFeature(actor, 'autoApply');
    }
    await this.d.usage.assertWithin(actor, 'APPLICATION');

    let resumeId = input.resumeId ?? null;
    if (resumeId) {
      const [r] = await this.d.db.select().from(resumes).where(and(eq(resumes.id, resumeId), eq(resumes.userId, actor.userId), isNull(resumes.deletedAt)));
      if (!r) throw new DomainError('NOT_FOUND', 'Resume not found');
    } else resumeId = (await this.d.profiles.primaryResume(actor.userId))?.id ?? null;
    if (!resumeId) throw new DomainError('PRECONDITION', 'Upload a resume before applying');

    // Prefer a source whose platform supports automated submission.
    const sources = await this.d.db.select().from(jobSources).where(eq(jobSources.jobId, job.id));
    const ranked = [...sources].sort((a, b) => Number(this.d.registry.get(b.platform as PlatformKey).capabilities.submitApplication.status === 'IMPLEMENTED') - Number(this.d.registry.get(a.platform as PlatformKey).capabilities.submitApplication.status === 'IMPLEMENTED'));
    const source = ranked[0];
    if (!source) throw new DomainError('PRECONDITION', 'Job has no source to apply through');

    return this.d.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(applications).where(and(eq(applications.userId, actor.userId), eq(applications.jobId, job.id)));
      let app: App;
      if (existing) {
        if (!TERMINAL_FOR_RECREATE.includes(existing.status)) throw new DomainError('CONFLICT', `You already have an application for this job (${existing.status})`, { applicationId: existing.id });
        app = await this.transition(existing, 'READY_TO_APPLY', { reason: 'Re-opened', actorUserId: actor.userId, actorType, patch: { mode: input.mode, resumeId, jobSourceId: source.id, platform: source.platform, error: null, lockedAt: null }, force: true }, tx);
      } else {
        [app] = (await tx
          .insert(applications)
          .values({ userId: actor.userId, enterpriseId: actor.enterpriseId, jobId: job.id, jobSourceId: source.id, platform: source.platform, source: 'INTERNAL', mode: input.mode, status: 'READY_TO_APPLY', resumeId })
          .returning()) as [App];
        await tx.insert(applicationStatusHistory).values({ applicationId: app.id, fromStatus: null, toStatus: 'READY_TO_APPLY', actorUserId: actor.userId, actorType, reason: 'Created' });
        await this.event(app.id, 'CREATED', `Application created (${input.mode.toLowerCase()} mode) via ${source.platform}`, { platform: source.platform }, actorType === 'USER' ? actor.userId : null, tx);
      }
      await tx.update(jobMatches).set({ isNew: false }).where(eq(jobMatches.id, match.id));
      return app;
    }).then(async (app) => {
      await this.d.enqueuePrepare?.(app.id, actor.userId);
      return app;
    });
  }

  // ---------------------------------------------------------------- prepare (worker)
  async prepare(applicationId: string): Promise<void> {
    const [app] = await this.d.db.select().from(applications).where(eq(applications.id, applicationId));
    if (!app || !['READY_TO_APPLY', 'IN_PROGRESS', 'FAILED'].includes(app.status)) return;
    const actor: Actor = { userId: app.userId, enterpriseId: app.enterpriseId };
    const [job] = await this.d.db.select().from(jobs).where(eq(jobs.id, app.jobId));
    const [source] = app.jobSourceId ? await this.d.db.select().from(jobSources).where(eq(jobSources.id, app.jobSourceId)) : [];
    if (!job || !source) throw new DomainError('NOT_FOUND', 'Job or job source missing');
    const adapter = this.d.registry.get(source.platform as PlatformKey);
    let cur: App = app.status === 'IN_PROGRESS' ? app : await this.transition(app, 'IN_PROGRESS', { reason: 'Preparing application' });
    await this.event(app.id, 'PREPARING', `Detecting the application form on ${adapter.displayName}`);

    let fields: DetectedField[] = [];
    let submission: 'AUTOMATED' | 'USER_ASSISTED' = 'USER_ASSISTED';
    try {
      const { ctx } = await platformContext({ db: this.d.db, box: this.d.box, browser: this.d.browser, fetchImpl: this.d.fetchImpl }, app.userId, source.platform as PlatformKey, this.logger);
      const form = await adapter.getApplicationForm(ctx, { externalId: source.externalId, url: source.url, applyUrl: source.applyUrl });
      fields = form.fields;
      submission = form.submission === 'AUTOMATED' && adapter.capabilities.submitApplication.status === 'IMPLEMENTED' ? 'AUTOMATED' : 'USER_ASSISTED';
      await this.event(app.id, 'FORM_DETECTED', `Detected ${fields.length} form fields`, { fields: fields.map((f) => ({ key: f.key, label: f.label.slice(0, 120), type: f.type, required: f.required })), submission });
    } catch (e) {
      if (e instanceof UnsupportedOperationError) {
        await this.event(app.id, 'USER_ASSISTED', `${adapter.displayName} applications are user-assisted: open the posting, use the extension to fill, and submit yourself.`, { capability: e.capability });
        await this.transition(cur, 'READY_TO_APPLY', { reason: 'User-assisted platform', patch: { formSnapshot: { submission: 'USER_ASSISTED', url: source.applyUrl ?? source.url } } });
        return;
      }
      const msg = (e as Error).message;
      await this.event(app.id, 'FAILED', `Form detection failed: ${msg}`);
      await this.transition(cur, 'FAILED', { reason: 'Form detection failed', patch: { error: { code: 'FORM_DETECTION', message: msg, at: new Date().toISOString() } } });
      throw e;
    }

    // Generate answers.
    const cand = await this.d.profiles.candidateContext(app.userId, !!app.resumeId);
    let generator;
    if (await this.d.ai.isConfigured(actor, 'APPLICATION_ANSWER')) {
      try {
        await this.d.ai.assertTokenAllowance(actor);
        generator = this.d.ai.answerGenerator(actor);
      } catch (e: any) {
        await this.event(app.id, 'AI_UNAVAILABLE', `AI answers unavailable: ${e.message}`);
      }
    } else {
      await this.event(app.id, 'AI_UNAVAILABLE', 'No AI provider configured — free-text questions will need your input');
    }
    const engine = new AnswerEngine(generator);
    const existing = await this.d.db.select().from(applicationAnswers).where(eq(applicationAnswers.applicationId, app.id));
    const jobCtx = { title: job.title, company: job.company, description: job.description, requiredSkills: job.requiredSkills, location: job.location, country: job.country };
    let pending = 0;
    let needInput = 0;
    for (const field of fields) {
      const prior = existing.find((a) => a.fieldKey === field.key);
      if (prior && (prior.source === 'USER' || prior.approvalStatus === 'APPROVED')) continue; // never overwrite user decisions
      const r = await engine.answer(field, cand, jobCtx);
      const approvalStatus = r.approvalRequired ? 'PENDING' : 'AUTO_APPROVED';
      if (approvalStatus === 'PENDING') pending++;
      if (r.requiresUserInput && field.required) needInput++;
      const values = {
        applicationId: app.id,
        fieldKey: field.key,
        question: field.label,
        questionType: field.type,
        intent: r.intent,
        options: field.options,
        required: field.required,
        answer: r.answer,
        source: r.source,
        requiresUserInput: r.requiresUserInput,
        isSensitive: r.isSensitive,
        approvalStatus: approvalStatus as 'PENDING' | 'AUTO_APPROVED',
        confidence: r.confidence,
        reasoning: r.reasoning,
        aiUsageLogId: r.aiUsageLogId,
      };
      await this.d.db
        .insert(applicationAnswers)
        .values({ ...values, history: [{ answer: r.answer, source: r.source, at: new Date().toISOString(), by: 'system' }] })
        .onConflictDoUpdate({ target: [applicationAnswers.applicationId, applicationAnswers.fieldKey], set: { ...values, version: sql`${applicationAnswers.version} + 1` } });
    }
    await this.event(app.id, 'ANSWERS_GENERATED', `Prepared ${fields.length} answers (${pending} need review, ${needInput} need your input)`, { pending, needInput });

    [cur] = await this.d.db.select().from(applications).where(eq(applications.id, app.id)) as [App];
    const patch = { formSnapshot: { submission, url: source.applyUrl ?? source.url, fieldCount: fields.length } };
    if (submission === 'USER_ASSISTED') {
      await this.transition(cur, 'READY_TO_APPLY', { reason: 'Answers prepared; submit via the extension', patch });
      return;
    }
    if (app.mode === 'MANUAL' || pending > 0 || needInput > 0) {
      await this.transition(cur, 'PENDING_APPROVAL', { reason: app.mode === 'MANUAL' ? 'Manual mode: waiting for your approval' : 'Some answers need your review', patch });
      await this.d.notifications.notify(app.userId, { type: 'APPROVAL_REQUIRED', title: `Review your application to ${job.company}`, body: `${job.title}: ${needInput} answers need your input, ${pending} need review.`, data: { applicationId: app.id }, email: app.mode === 'AUTOMATIC' });
      await this.event(app.id, 'APPROVAL_REQUESTED', 'Waiting for your approval');
      return;
    }
    await this.d.db.update(applications).set(patch).where(eq(applications.id, app.id));
    await this.event(app.id, 'AUTO_APPROVED', 'All answers verified from your profile; submitting automatically');
    await this.d.enqueueSubmit?.(app.id, app.userId);
  }

  // ---------------------------------------------------------------- user review
  async updateAnswer(actor: Actor, applicationId: string, answerId: string, input: { answer: string; approve: boolean; saveForReuse: boolean }) {
    const app = await this.getOwned(actor, applicationId);
    if (['APPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'].includes(app.status)) throw new DomainError('INVALID', 'Application already finalized');
    const [ans] = await this.d.db.select().from(applicationAnswers).where(and(eq(applicationAnswers.id, answerId), eq(applicationAnswers.applicationId, app.id)));
    if (!ans) throw new DomainError('NOT_FOUND', 'Answer not found');
    if (ans.options.length && !['TEXT', 'TEXTAREA'].includes(ans.questionType) && !ans.options.some((o) => o.value === input.answer)) {
      throw new DomainError('INVALID', 'Answer must be one of the provided options');
    }
    const [updated] = await this.d.db
      .update(applicationAnswers)
      .set({
        answer: input.answer,
        source: 'USER',
        requiresUserInput: false,
        approvalStatus: input.approve ? 'APPROVED' : 'PENDING',
        confidence: 1,
        version: ans.version + 1,
        history: [...ans.history, { answer: input.answer, source: 'USER', at: new Date().toISOString(), by: actor.userId }],
      })
      .where(eq(applicationAnswers.id, ans.id))
      .returning();
    if (input.saveForReuse) {
      const key = normalizeQuestionKey(ans.question);
      await this.d.db
        .insert(savedAnswers)
        .values({ userId: actor.userId, questionKey: key, question: ans.question, intent: ans.intent, answer: input.answer })
        .onConflictDoUpdate({ target: [savedAnswers.userId, savedAnswers.questionKey], set: { answer: input.answer, updatedAt: new Date() } });
    }
    await this.event(app.id, 'ANSWER_EDITED', `Answer updated: ${ans.question.slice(0, 80)}`, { answerId, saved: input.saveForReuse }, actor.userId);
    return updated!;
  }

  /** Explicit approval of the whole prepared application → submission. */
  async approve(actor: Actor, applicationId: string, opts: { confirmSensitive: boolean }) {
    const app = await this.getOwned(actor, applicationId);
    if (app.status !== 'PENDING_APPROVAL') throw new DomainError('INVALID', `Application is ${app.status}, not awaiting approval`);
    const answers = await this.d.db.select().from(applicationAnswers).where(eq(applicationAnswers.applicationId, app.id));
    const missing = answers.filter((a) => a.required && (a.answer == null || a.answer === '' || a.requiresUserInput));
    if (missing.length) throw new DomainError('PRECONDITION', `${missing.length} required question(s) still need your answer`, { fields: missing.map((m) => m.question) });
    const sensitive = answers.filter((a) => a.isSensitive && a.answer != null);
    if (sensitive.length && !opts.confirmSensitive) throw new DomainError('PRECONDITION', 'Please explicitly confirm the sensitive/legal declarations', { fields: sensitive.map((s) => s.question) });
    await this.d.db.transaction(async (tx) => {
      await tx.update(applicationAnswers).set({ approvalStatus: 'APPROVED' }).where(and(eq(applicationAnswers.applicationId, app.id), inArray(applicationAnswers.approvalStatus, ['PENDING', 'AUTO_APPROVED'])));
      await this.transition(app, 'IN_PROGRESS', { reason: 'Approved by user', actorUserId: actor.userId, actorType: 'USER' }, tx);
      await this.event(app.id, 'APPROVED', `You approved ${answers.length} answers${sensitive.length ? ` including ${sensitive.length} sensitive declaration(s)` : ''}`, {}, actor.userId, tx);
    });
    await this.d.audit.log({ actorUserId: actor.userId, enterpriseId: actor.enterpriseId, action: 'application.approve', targetType: 'application', targetId: app.id, metadata: { sensitiveConfirmed: sensitive.length } });
    await this.d.enqueueSubmit?.(app.id, actor.userId);
  }

  // ---------------------------------------------------------------- submit (worker)
  async submit(applicationId: string): Promise<'APPLIED' | 'NEEDS_VERIFICATION' | 'FAILED' | 'SKIPPED'> {
    // Atomic lock — prevents concurrent/duplicate submissions.
    const [app] = await this.d.db
      .update(applications)
      .set({ lockedAt: new Date(), attemptCount: sql`${applications.attemptCount} + 1` })
      .where(and(eq(applications.id, applicationId), eq(applications.status, 'IN_PROGRESS'), isNull(applications.submittedAt), or(isNull(applications.lockedAt), lt(applications.lockedAt, new Date(Date.now() - LOCK_TTL_MS)))))
      .returning();
    if (!app) return 'SKIPPED';
    const actor: Actor = { userId: app.userId, enterpriseId: app.enterpriseId };
    const release = () => this.d.db.update(applications).set({ lockedAt: null }).where(eq(applications.id, app.id));
    let tmpDir: string | null = null;
    try {
      const answers = await this.d.db.select().from(applicationAnswers).where(eq(applicationAnswers.applicationId, app.id));
      const unapproved = answers.filter((a) => a.approvalStatus !== 'APPROVED' && a.approvalStatus !== 'AUTO_APPROVED');
      const missing = answers.filter((a) => a.required && (a.answer == null || a.requiresUserInput));
      if (unapproved.length || missing.length) {
        await this.transition(app, 'PENDING_APPROVAL', { reason: 'Unapproved or missing answers at submission time' });
        await release();
        return 'SKIPPED';
      }
      await this.d.usage.assertWithin(actor, 'APPLICATION');
      const [prefs] = await this.d.db.select().from(candidatePreferences).where(eq(candidatePreferences.userId, app.userId));
      if (app.mode === 'AUTOMATIC' && prefs && (await this.d.usage.recentDailyCount(app.userId, 'APPLICATION')) >= prefs.dailyApplicationLimit) {
        throw new DomainError('LIMIT_EXCEEDED', `Daily automatic application limit (${prefs.dailyApplicationLimit}) reached`);
      }
      const [source] = await this.d.db.select().from(jobSources).where(eq(jobSources.id, app.jobSourceId!));
      const adapter = this.d.registry.get(source!.platform as PlatformKey);
      if (adapter.capabilities.submitApplication.status !== 'IMPLEMENTED') throw new UnsupportedOperationError(adapter.key, 'submitApplication', adapter.capabilities.submitApplication);

      // Resume file for upload fields.
      let resumePath: string | undefined;
      if (answers.some((a) => a.questionType === 'FILE')) {
        const [resume] = await this.d.db.select().from(resumes).where(eq(resumes.id, app.resumeId!));
        if (!resume) throw new DomainError('PRECONDITION', 'Selected resume no longer exists');
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'autoapply-submit-'));
        resumePath = path.join(tmpDir, resume.fileName);
        await fs.writeFile(resumePath, await this.d.storage.get(resume.storageKey), { mode: 0o600 });
      }
      const values: FormFillValue[] = answers.map((a) =>
        a.questionType === 'FILE'
          ? { key: a.fieldKey, value: null, filePath: classifyIntent({ label: a.question, key: a.fieldKey, type: 'FILE' }) === 'RESUME_UPLOAD' ? resumePath : undefined }
          : { key: a.fieldKey, value: a.questionType === 'CHECKBOX' ? a.answer === 'true' || /^yes$/i.test(a.answer ?? '') : (a.answer ?? '') },
      );
      await this.event(app.id, 'SUBMITTING', `Submitting via ${adapter.displayName}`);
      const { ctx } = await platformContext({ db: this.d.db, box: this.d.box, browser: this.d.browser, fetchImpl: this.d.fetchImpl }, app.userId, adapter.key, this.logger);
      const result = await adapter.submitApplication(ctx, { externalId: source!.externalId, url: source!.url, applyUrl: source!.applyUrl }, values);

      let screenshotKey: string | undefined;
      if (result.screenshotPath) {
        screenshotKey = `evidence/${app.userId}/${app.id}-${Date.now()}.png`;
        try {
          await this.d.storage.put(screenshotKey, await fs.readFile(result.screenshotPath), 'image/png');
        } catch {
          screenshotKey = undefined;
        } finally {
          await fs.rm(result.screenshotPath, { force: true });
        }
      }
      const [job] = await this.d.db.select().from(jobs).where(eq(jobs.id, app.jobId));
      if (result.submitted && result.verified) {
        const evidence: ConfirmationEvidence = { verified: true, method: 'PAGE_CONFIRMATION', confirmationText: result.confirmationText?.slice(0, 500), confirmationUrl: result.confirmationUrl, screenshotKey, externalReference: result.externalApplicationId, capturedAt: new Date().toISOString() };
        await this.transition(app, 'APPLIED', { reason: 'Submission verified', patch: { submittedAt: new Date(), confirmation: evidence, externalApplicationId: result.externalApplicationId ?? null, lockedAt: null, error: null, lastSyncedAt: new Date() } });
        await this.event(app.id, 'VERIFIED', `Confirmation received${result.externalApplicationId ? ` (ref ${result.externalApplicationId})` : ''}`, { screenshotKey });
        await this.d.usage.record(actor, 'APPLICATION', 1, { sourceId: app.id });
        await this.d.notifications.notify(app.userId, { type: 'APPLICATION_SUBMITTED', title: `Applied to ${job?.company}`, body: `${job?.title} — confirmation verified.`, data: { applicationId: app.id } });
        return 'APPLIED';
      }
      if (result.submitted) {
        await this.transition(app, 'NEEDS_VERIFICATION', { reason: 'Submitted but no confirmation was observed', patch: { submittedAt: new Date(), confirmation: { verified: false, method: 'PAGE_CONFIRMATION', screenshotKey, confirmationUrl: result.confirmationUrl, capturedAt: new Date().toISOString() }, lockedAt: null } });
        await this.event(app.id, 'VERIFICATION_FAILED', 'The form was submitted but no confirmation was detected. Please verify on the platform.', { screenshotKey });
        await this.d.usage.record(actor, 'APPLICATION', 1, { sourceId: app.id });
        await this.d.notifications.notify(app.userId, { type: 'NEEDS_VERIFICATION', title: `Please verify your application to ${job?.company}`, body: 'We could not confirm the submission.', data: { applicationId: app.id } });
        return 'NEEDS_VERIFICATION';
      }
      throw new DomainError('PRECONDITION', result.error ?? 'Submission failed');
    } catch (e: any) {
      const message = e?.message ?? 'Submission failed';
      const [fresh] = await this.d.db.select().from(applications).where(eq(applications.id, app.id));
      if (fresh && fresh.status === 'IN_PROGRESS') {
        await this.transition(fresh, 'FAILED', { reason: message.slice(0, 200), patch: { error: { code: e?.code ?? 'SUBMIT_FAILED', message, at: new Date().toISOString() }, lockedAt: null } });
        await this.event(app.id, 'FAILED', message);
        await this.d.notifications.notify(app.userId, { type: 'APPLICATION_FAILED', title: 'Application needs attention', body: message, data: { applicationId: app.id } });
      } else await release();
      return 'FAILED';
    } finally {
      if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------- tracking
  async setStatus(actor: Actor, applicationId: string, to: ApplicationStatus, reason?: string) {
    const app = await this.getOwned(actor, applicationId);
    if (to === 'APPLIED') throw new DomainError('INVALID', 'Use "confirm external submission" to mark an application as applied');
    if (['IN_PROGRESS', 'PENDING_APPROVAL'].includes(to)) throw new DomainError('INVALID', 'That status is managed by the system');
    return this.transition(app, to, { reason: reason ?? 'Updated by user', actorUserId: actor.userId, actorType: 'USER' });
  }

  /** User confirms they submitted (user-assisted platforms / applied elsewhere). */
  async confirmSubmitted(actor: Actor, applicationId: string, input: { evidence?: string; externalReference?: string; via: 'USER_CONFIRMED' | 'EXTENSION_EVENT' }) {
    const app = await this.getOwned(actor, applicationId);
    if (app.status === 'APPLIED') return app;
    const evidence: ConfirmationEvidence = { verified: input.via === 'EXTENSION_EVENT' && !!input.externalReference, method: input.via, confirmationText: input.evidence?.slice(0, 1000), externalReference: input.externalReference, capturedAt: new Date().toISOString() };
    const updated = await this.transition(app, 'APPLIED', { reason: input.via === 'USER_CONFIRMED' ? 'Confirmed by user' : 'Reported by extension and confirmed by user', actorUserId: actor.userId, actorType: 'USER', force: true, patch: { submittedAt: new Date(), confirmation: evidence, externalApplicationId: input.externalReference ?? app.externalApplicationId, lockedAt: null } });
    await this.d.usage.record(actor, 'APPLICATION', 1, { sourceId: app.id });
    return updated;
  }

  async withdraw(actor: Actor, applicationId: string) {
    const app = await this.getOwned(actor, applicationId);
    return this.transition(app, 'WITHDRAWN', { reason: 'Withdrawn by user', actorUserId: actor.userId, actorType: 'USER' });
  }

  /** Records an application made outside the platform (EXTERNAL source). */
  async recordExternal(actor: Actor, jobId: string, platform: string, input: { userConfirmed: boolean; appliedAt?: Date; evidence?: string }) {
    return this.d.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(applications).where(and(eq(applications.userId, actor.userId), eq(applications.jobId, jobId)));
      if (existing && !TERMINAL_FOR_RECREATE.includes(existing.status) && existing.status !== 'READY_TO_APPLY') throw new DomainError('CONFLICT', `Application already tracked (${existing.status})`, { applicationId: existing.id });
      const status: ApplicationStatus = input.userConfirmed ? 'APPLIED' : 'NEEDS_VERIFICATION';
      const confirmation: ConfirmationEvidence | null = input.userConfirmed ? { verified: false, method: 'USER_CONFIRMED', confirmationText: input.evidence, capturedAt: new Date().toISOString() } : null;
      let app: App;
      if (existing) {
        app = await this.transition(existing, status, { force: true, reason: 'Recorded external application', actorUserId: actor.userId, actorType: 'USER', patch: { source: 'EXTERNAL', submittedAt: input.appliedAt ?? new Date(), confirmation } }, tx);
      } else {
        [app] = (await tx.insert(applications).values({ userId: actor.userId, enterpriseId: actor.enterpriseId, jobId, platform, source: 'EXTERNAL', mode: 'MANUAL', status, submittedAt: input.appliedAt ?? new Date(), confirmation }).returning()) as [App];
        await tx.insert(applicationStatusHistory).values({ applicationId: app.id, fromStatus: null, toStatus: status, actorUserId: actor.userId, actorType: 'USER', reason: 'Recorded external application' });
      }
      await this.event(app.id, 'EXTERNAL_RECORDED', input.userConfirmed ? 'You confirmed applying directly on the platform' : 'Detected an external application; awaiting your confirmation', {}, actor.userId, tx);
      return app;
    });
  }

  /** Status sync through authorized integrations; otherwise flags stale applications. */
  async sync(applicationId: string): Promise<void> {
    const [app] = await this.d.db.select().from(applications).where(eq(applications.id, applicationId));
    if (!app) return;
    if (app.status === 'IN_PROGRESS' && !app.lockedAt && Date.now() - app.updatedAt.getTime() > 6 * 3600_000) {
      await this.transition(app, 'NEEDS_VERIFICATION', { reason: 'Stuck in progress; verification required' });
      return;
    }
    if (!['APPLIED', 'INTERVIEW', 'NEEDS_VERIFICATION', 'UNKNOWN'].includes(app.status) || !app.jobSourceId) return;
    const [source] = await this.d.db.select().from(jobSources).where(eq(jobSources.id, app.jobSourceId));
    const adapter = this.d.registry.get(source!.platform as PlatformKey);
    if (adapter.capabilities.checkApplicationStatus.status !== 'IMPLEMENTED') {
      await this.d.db.update(applications).set({ lastSyncedAt: new Date() }).where(eq(applications.id, app.id));
      return;
    }
    const { ctx } = await platformContext({ db: this.d.db, box: this.d.box, fetchImpl: this.d.fetchImpl }, app.userId, adapter.key, this.logger);
    const r = await adapter.checkApplicationStatus(ctx, { externalId: source!.externalId, url: source!.url, externalApplicationId: app.externalApplicationId });
    await this.d.db.update(applications).set({ lastSyncedAt: new Date() }).where(eq(applications.id, app.id));
    await this.event(app.id, 'SYNCED', `Platform status: ${r.status}${r.detail ? ` (${r.detail})` : ''}`, { verified: r.verified });
    if (r.verified && r.status !== 'UNKNOWN' && r.status !== app.status && canTransition(app.status, r.status)) {
      // NEEDS_VERIFICATION → APPLIED is allowed only on a verified platform signal.
      await this.transition(app, r.status, { reason: 'Synchronized from platform' });
    }
  }

  /** Selects eligible matches for users in automatic mode and creates applications. */
  async runAutoApply(userId: string, enterpriseId: string | null): Promise<number> {
    const [prefs] = await this.d.db.select().from(candidatePreferences).where(eq(candidatePreferences.userId, userId));
    if (!prefs || prefs.applicationMode !== 'AUTOMATIC' || !prefs.autoApplyConsentAt) return 0;
    const already = await this.d.usage.recentDailyCount(userId, 'APPLICATION');
    let budget = prefs.dailyApplicationLimit - already;
    if (budget <= 0) return 0;
    const candidates = await this.d.db
      .select({ jobId: jobMatches.jobId, score: jobMatches.overallScore })
      .from(jobMatches)
      .leftJoin(applications, and(eq(applications.jobId, jobMatches.jobId), eq(applications.userId, userId)))
      .where(and(eq(jobMatches.userId, userId), eq(jobMatches.disqualified, false), eq(jobMatches.hidden, false), sql`${jobMatches.overallScore} >= ${prefs.autoApplyMinScore}`, isNull(applications.id)))
      .orderBy(desc(jobMatches.overallScore))
      .limit(50);
    let created = 0;
    for (const c of candidates) {
      if (budget <= 0) break;
      const srcs = await this.d.db.select().from(jobSources).where(eq(jobSources.jobId, c.jobId));
      if (!srcs.some((s) => this.d.registry.get(s.platform as PlatformKey).capabilities.submitApplication.status === 'IMPLEMENTED')) continue;
      try {
        await this.create({ userId, enterpriseId }, { jobId: c.jobId, mode: 'AUTOMATIC' }, 'SYSTEM');
        created++;
        budget--;
      } catch (e: any) {
        this.logger.warn('auto-apply skipped job', { jobId: c.jobId, reason: e.message });
        if (e instanceof DomainError && (e.code === 'LIMIT_EXCEEDED' || e.code === 'FEATURE_UNAVAILABLE' || e.code === 'PRECONDITION')) break;
      }
    }
    return created;
  }
}
