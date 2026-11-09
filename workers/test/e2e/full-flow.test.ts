/**
 * End-to-end: API + real workers (BullMQ/Redis) + Postgres + real OCR/PDF tools
 * + Playwright against the controlled Sandbox Job Board. No real job portal is
 * contacted. AI is a scripted mock provider (no external calls).
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { AIProviderRegistry, MockAIAdapter } from '@autoapply/ai-providers';
import { createApp } from '@autoapply/api/dist/bootstrap';
import { loadConfig } from '@autoapply/api/dist/config';
import { createDb, eq, resetDatabase, users } from '@autoapply/database';
import { createSandboxServer } from '@autoapply/sandbox-board';
import { LogMailer, QueueClient, createContainer, redisConnection, type Container } from '@autoapply/services';
import { hash } from '@node-rs/argon2';
import type { Worker } from 'bullmq';
import { PlaywrightFormDriver } from '../../src/browser/driver';
import { startWorkers } from '../../src/processors';
import { ApiClient, waitFor } from '../client';

const DB_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/autoapply_e2e';
const REDIS_URL = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/5';
const FIXTURES = path.resolve(__dirname, '../../../packages/document-extraction/src/__fixtures__');
process.env.ENCRYPTION_KEYS ??= `k1:${Buffer.alloc(32, 7).toString('base64')}`;
process.env.LOCAL_STORAGE_PATH = fs.mkdtempSync('/tmp/aa-e2e-storage-');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';

/** Scripted AI: resume extraction (with one hallucination to be removed) and grounded answers. */
function scriptedAi(): MockAIAdapter {
  return new MockAIAdapter((req) => {
    if (req.jsonSchema?.name === 'extracted_resume') {
      return JSON.stringify({
        fullName: 'Arjun Mehta',
        email: 'arjun.mehta@example.com',
        phone: '+91 98765 43210',
        location: 'Bengaluru, India',
        summary: 'Backend-focused engineer with 7 years of experience building Python and Node.js services.',
        currentTitle: 'Senior Software Engineer',
        previousTitles: ['Software Engineer'],
        totalExperienceMonths: 84,
        experiences: [
          { company: 'Northwind Labs', title: 'Senior Software Engineer', startDate: '2021-01', endDate: 'present', isCurrent: true, description: 'Led migration of billing APIs to TypeScript and PostgreSQL on AWS', sourcePage: 1 },
          { company: 'Contoso Systems', title: 'Software Engineer', startDate: '2017-07', endDate: '2020-12', isCurrent: false, description: 'Built REST APIs in Python with Django', sourcePage: 1 },
        ],
        skills: { programmingLanguages: ['Python', 'TypeScript'], frameworks: ['Node.js', 'React', 'Django'], databases: ['PostgreSQL', 'Redis'], cloud: ['AWS'], tools: ['Docker', 'Kubernetes'], soft: ['Communication', 'Mentoring'] },
        education: [{ institution: 'VIT University', degree: 'B.Tech', field: 'Computer Science', startDate: '2013', endDate: '2017' }],
        certifications: [{ name: 'AWS Certified Solutions Architect - Associate', date: '2022' }, { name: 'Google Professional Cloud Architect', date: '2023' }],
        projects: [{ name: 'JobPulse', description: 'open source job alert bot', technologies: ['Python'] }],
        achievements: [],
        links: { linkedin: 'linkedin.com/in/arjun-mehta-dev', github: 'github.com/arjunmehta-dev', portfolio: null, other: [] },
        confidence: { fullName: 0.98 },
      });
    }
    if (req.jsonSchema?.name === 'generated_answer') {
      const prompt = req.messages[0]!.content;
      const company = /Company: (.+)/.exec(prompt)?.[1] ?? 'your company';
      if (!prompt.includes('Northwind Labs')) return JSON.stringify({ answer: null, requiresUserInput: true, confidence: 0, reasoning: 'no facts', usedFacts: [] });
      return JSON.stringify({ answer: `I want to join ${company} because at Northwind Labs I led the migration of billing APIs to TypeScript and PostgreSQL on AWS, and this role builds on that experience.`, requiresUserInput: false, confidence: 0.88, reasoning: 'Grounded in current role', usedFacts: ['Northwind Labs billing APIs'] });
    }
    return 'OK';
  });
}

describe('AutoApply end-to-end (sandbox board)', () => {
  let sandbox: ReturnType<typeof createSandboxServer>;
  let sandboxUrl: string;
  let app: INestApplication;
  let apiUrl: string;
  let apiContainer: Container;
  let workerContainer: Container;
  let workers: Worker[];
  let driver: PlaywrightFormDriver;
  const mailer = new LogMailer();

  beforeAll(async () => {
    sandbox = createSandboxServer();
    await new Promise<void>((r) => sandbox.listen(0, '127.0.0.1', () => r()));
    sandboxUrl = `http://127.0.0.1:${(sandbox.address() as AddressInfo).port}`;
    process.env.SANDBOX_BOARD_URL = sandboxUrl;

    await resetDatabase(DB_URL);
    const redis = redisConnection(REDIS_URL);
    await redis.flushdb();
    const registry = AIProviderRegistry.withDefaults({ allowMock: true, mock: scriptedAi() });
    const h = createDb(DB_URL);
    await h.db.insert(users).values({ email: 'root@example.com', fullName: 'Root Admin', platformRole: 'SUPER_ADMIN', emailVerifiedAt: new Date(), passwordHash: await hash('Sup3rSecret!pass', { memoryCost: 19456, timeCost: 2, parallelism: 1 }) });
    await h.close();

    apiContainer = createContainer({ databaseUrl: DB_URL, queues: new QueueClient(redisConnection(REDIS_URL)), mailer, aiRegistry: registry });
    const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: DB_URL, REDIS_URL, RATE_LIMIT_PER_MINUTE: '10000' });
    app = await createApp({ config, container: apiContainer });
    await app.listen(0, '127.0.0.1');
    apiUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

    driver = new PlaywrightFormDriver({ maxConcurrency: 2 });
    workerContainer = createContainer({ databaseUrl: DB_URL, queues: new QueueClient(redisConnection(REDIS_URL)), mailer, browser: driver, aiRegistry: registry });
    workers = startWorkers(workerContainer, redisConnection(REDIS_URL), [
      'document-processing',
      'job-discovery',
      'job-matching',
      'application-preparation',
      'application-submission',
      'application-sync',
      'notifications',
    ]);
  });

  afterAll(async () => {
    await Promise.allSettled(workers?.map((w) => w.close()) ?? []);
    await driver?.close();
    await app?.close();
    await workerContainer?.queues?.close();
    await workerContainer?.handle.close();
    await new Promise((r) => sandbox?.close(r));
  });

  const user = () => new ApiClient(apiUrl);
  let u: ApiClient;
  let admin: ApiClient;
  let applicationId: string;
  let mainJobId: string;

  it('super admin configures the platform AI provider (secret never echoed)', async () => {
    admin = user();
    expect((await admin.post('/auth/login', { email: 'root@example.com', password: 'Sup3rSecret!pass' })).status).toBe(200);
    const r = await admin.post('/ai/configs', { scope: 'PLATFORM', providerKey: 'mock', defaultModel: 'mock-deterministic', apiKey: 'mock-secret-key-123' });
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.body)).not.toContain('mock-secret-key-123');
    expect(r.body.apiKeyLast4).toBe('-123');
  });

  it('candidate signs up, upgrades to Pro, uploads a resume and gets an AI extraction (grounded)', async () => {
    u = user();
    const s = await u.post('/auth/signup', { email: 'arjun@example.com', password: 'Correct-horse-9', fullName: 'Arjun Mehta' });
    expect(s.status).toBe(201);
    const verifyMail = mailer.outbox.find((m) => m.to === 'arjun@example.com' && /Verify/.test(m.subject))!;
    const token = /token=([\w-]+)/.exec(verifyMail.text)![1];
    expect((await u.post('/auth/verify-email', { token })).status).toBe(204);
    expect((await u.post('/billing/subscription', { planKey: 'pro', interval: 'MONTHLY' })).body.effective).toBe('NOW');

    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(path.join(FIXTURES, 'resume.pdf'))], { type: 'application/pdf' }), 'Arjun_Mehta_CV.pdf');
    const up = await u.req('POST', '/resumes', undefined, { form });
    expect(up.status).toBe(201);
    const resumeId = up.body.resume.id;
    const ex = await waitFor(() => u.get(`/resumes/${resumeId}/extraction`), (r) => r.status === 200 && ['SUCCEEDED', 'FAILED'].includes(r.body.extraction.status), { label: 'extraction' });
    expect(ex.body.extraction.status).toBe('SUCCEEDED');
    expect(ex.body.extraction.parser).toBe('ai');
    expect(ex.body.extraction.method).toBe('NATIVE_TEXT');
    const st = ex.body.extraction.structured;
    expect(st.fullName).toBe('Arjun Mehta');
    expect(st.certifications.map((c: any) => c.name)).toEqual(['AWS Certified Solutions Architect - Associate']);
    expect(ex.body.extraction.warnings.join(' ')).toMatch(/Google Professional Cloud Architect/);

    const p = await u.get('/profile');
    expect(p.body.fullName).toBe('Arjun Mehta');
    expect(p.body.reviewedAt).toBeNull();
    const skills = p.body.skills.map((x: any) => ({ name: x.name, category: x.category, years: x.name === 'Python' ? 7 : null }));
    const save = await u.put('/profile', { markReviewed: true, skills });
    expect(save.status).toBe(200);
    expect(save.body.reviewedAt).not.toBeNull();
  });

  it('OCRs a scanned resume upload', async () => {
    const form = new FormData();
    form.append('file', new Blob([fs.readFileSync(path.join(FIXTURES, 'resume-scanned.pdf'))], { type: 'application/pdf' }), 'scan.pdf');
    const up = await u.req('POST', '/resumes', undefined, { form });
    const ex = await waitFor(() => u.get(`/resumes/${up.body.resume.id}/extraction`), (r) => r.status === 200 && ['SUCCEEDED', 'FAILED'].includes(r.body.extraction.status), { label: 'ocr extraction' });
    expect(ex.body.extraction.method).toBe('OCR');
    expect(ex.body.extraction.ocrEngine).toBe('tesseract');
    expect(ex.body.extraction.pages[0].preprocessing.join(',')).toMatch(/deskew/);
  });

  it('saves preferences and runs discovery (sandbox searched, LinkedIn honestly skipped)', async () => {
    const prefs = await u.put('/preferences', {
      titles: ['Backend Developer', 'Python Developer'],
      locations: [{ city: 'Bengaluru', country: 'India' }],
      workModes: ['REMOTE', 'HYBRID'],
      salaryMin: 2_800_000,
      salaryCurrency: 'INR',
      noticePeriodDays: 30,
      platforms: ['sandbox', 'linkedin'],
      answerPreferences: { workAuthorizationCountries: ['India'], requiresSponsorship: false },
    });
    expect(prefs.status).toBe(200);
    const run = await u.post('/discovery/runs', {});
    expect(run.status).toBe(202);
    const done = await waitFor(() => u.get(`/discovery/runs/${run.body.id}`), (r) => ['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(r.body.status), { label: 'discovery' });
    expect(done.body.status).toBe('PARTIAL');
    expect(done.body.stats.found).toBeGreaterThan(2);
    expect(done.body.logs.some((l: any) => l.platform === 'linkedin' && /unsupported/i.test(l.message))).toBe(true);

    const rec = await u.get('/jobs?view=RECOMMENDED');
    expect(rec.body.total).toBeGreaterThan(0);
    expect(rec.body.disclaimer).toMatch(/not a prediction/);
    const all = await u.get('/jobs?view=ALL&pageSize=50');
    const main = all.body.items.find((j: any) => j.title === 'Senior Backend Engineer (Python)');
    expect(main).toBeTruthy();
    expect(main.score).toBeGreaterThan(70);
    mainJobId = main.jobId;
    const counts = await u.get('/jobs/views/counts');
    expect(counts.body.ALL).toBe(all.body.total);
  });

  it('prepares a manual application with grounded answers and sensitive declarations pending', async () => {
    const created = await u.post('/applications', { jobId: mainJobId, mode: 'MANUAL' });
    expect(created.status).toBe(201);
    applicationId = created.body.id;
    const ready = await waitFor(() => u.get(`/applications/${applicationId}`), (r) => ['PENDING_APPROVAL', 'FAILED'].includes(r.body.application.status), { label: 'preparation' });
    expect(ready.body.application.status).toBe('PENDING_APPROVAL');
    const byKey = Object.fromEntries(ready.body.answers.map((a: any) => [a.fieldKey, a]));
    expect(byKey.first_name.answer).toBe('Arjun');
    expect(byKey.email.answer).toBe('arjun.mehta@example.com');
    expect(byKey.skill_years.answer).toBe('7');
    expect(byKey.notice_period.answer).toBe('30');
    expect(byKey.work_authorization).toMatchObject({ answer: 'yes', isSensitive: true, approvalStatus: 'PENDING' });
    expect(byKey.sponsorship).toMatchObject({ answer: 'no', isSensitive: true });
    expect(byKey.why_us.source).toBe('AI');
    expect(byKey.why_us.answer).toContain('Northbridge Payments');
    expect(byKey.certify.requiresUserInput).toBe(true);
    expect(byKey.gender.answer).toBe('decline');
    expect(byKey.resume.answer).toBe('resume');

    // Duplicate application records are prevented.
    expect((await u.post('/applications', { jobId: mainJobId, mode: 'MANUAL' })).status).toBe(409);

    // Approval is blocked until required input and sensitive confirmation are given.
    const blocked = await u.post(`/applications/${applicationId}/approve`, { confirmSensitive: true });
    expect(blocked.status).toBe(422);
    expect((await u.put(`/applications/${applicationId}/answers/${byKey.certify.id}`, { answer: 'true', approve: true })).status).toBe(200);
    expect((await u.post(`/applications/${applicationId}/approve`, { confirmSensitive: false })).status).toBe(422);
  });

  it('submits via Playwright and verifies the confirmation before marking APPLIED', async () => {
    expect((await u.post(`/applications/${applicationId}/approve`, { confirmSensitive: true })).status).toBe(202);
    const applied = await waitFor(() => u.get(`/applications/${applicationId}`), (r) => ['APPLIED', 'FAILED', 'NEEDS_VERIFICATION'].includes(r.body.application.status), { label: 'submission', timeoutMs: 90_000 });
    expect(applied.body.application.status).toBe('APPLIED');
    const conf = applied.body.application.confirmation;
    expect(conf.verified).toBe(true);
    expect(conf.method).toBe('PAGE_CONFIRMATION');
    expect(applied.body.application.externalApplicationId).toMatch(/^SBX-/);
    // The board received exactly what was approved, including the resume file.
    const received = sandbox.state.applications.get(applied.body.application.externalApplicationId)!;
    expect(received.fields.first_name).toBe('Arjun');
    expect(received.fields.skill_years).toBe('7');
    expect(received.fields.work_authorization).toBe('yes');
    expect(received.fields.certify).toBe('yes');
    expect(received.resume!.bytes).toBeGreaterThan(1000);
    const evidence = await fetch(`${apiUrl}/api/v1/applications/${applicationId}/evidence`, { headers: { cookie: `aa_session=${(u as any).cookies.get('aa_session')}` } });
    expect(evidence.status).toBe(200);
    expect(evidence.headers.get('content-type')).toBe('image/png');
    // Immutable history.
    expect(applied.body.history.map((h: any) => h.toStatus)).toEqual(['READY_TO_APPLY', 'IN_PROGRESS', 'PENDING_APPROVAL', 'IN_PROGRESS', 'APPLIED']);
  });

  it('synchronizes external status through the authorized integration', async () => {
    const ref = (await u.get(`/applications/${applicationId}`)).body.application.externalApplicationId;
    await fetch(`${sandboxUrl}/api/applications/${ref}/status`, { method: 'POST', body: JSON.stringify({ status: 'INTERVIEW' }) });
    expect((await u.post(`/applications/${applicationId}/sync`)).status).toBe(202);
    const synced = await waitFor(() => u.get(`/applications/${applicationId}`), (r) => r.body.application.status === 'INTERVIEW', { label: 'sync' });
    expect(synced.body.events.some((e: any) => e.type === 'SYNCED')).toBe(true);
  });

  it('stops at a CAPTCHA instead of bypassing it', async () => {
    const all = await u.get('/jobs?view=ALL&pageSize=50&q=Protected');
    const job = all.body.items[0];
    expect(job.title).toMatch(/Protected/);
    const created = await u.post('/applications', { jobId: job.jobId, mode: 'MANUAL' });
    const id = created.body.id;
    const ready = await waitFor(() => u.get(`/applications/${id}`), (r) => ['PENDING_APPROVAL', 'FAILED'].includes(r.body.application.status), { label: 'captcha prep' });
    for (const a of ready.body.answers.filter((x: any) => x.required && x.requiresUserInput)) {
      await u.put(`/applications/${id}/answers/${a.id}`, { answer: a.questionType === 'CHECKBOX' ? 'true' : 'n/a', approve: true });
    }
    expect((await u.post(`/applications/${id}/approve`, { confirmSensitive: true })).status).toBe(202);
    const failed = await waitFor(() => u.get(`/applications/${id}`), (r) => ['APPLIED', 'FAILED', 'NEEDS_VERIFICATION'].includes(r.body.application.status), { label: 'captcha submit' });
    expect(failed.body.application.status).toBe('FAILED');
    expect(failed.body.application.error.message).toMatch(/CAPTCHA/);
    expect([...sandbox.state.applications.values()].some((x) => x.jobId === 'sbx-1009')).toBe(false);
  });

  it('notifies the user and records AI usage', async () => {
    const n = await u.get('/notifications');
    expect(n.body.items.map((x: any) => x.type)).toEqual(expect.arrayContaining(['RESUME_EXTRACTED', 'APPLICATION_SUBMITTED', 'APPLICATION_FAILED']));
    const usage = await u.get('/ai/usage');
    expect(usage.body.byTask.map((t: any) => t.task)).toEqual(expect.arrayContaining(['RESUME_EXTRACTION', 'APPLICATION_ANSWER']));
    const billing = await u.get('/billing/usage');
    expect(billing.body.usage.find((x: any) => x.metric === 'APPLICATION').used).toBe(1);
  });

  it('browser extension token is scope-limited and can capture jobs', async () => {
    const t = await u.post('/me/api-tokens', { name: 'Chrome' });
    expect(t.body.token).toMatch(/^aa_pat_/);
    const ext = new ApiClient(apiUrl, t.body.token);
    expect((await ext.get('/extension/status')).status).toBe(200);
    expect((await ext.get('/jobs')).status).toBe(403);
    expect((await ext.get('/me')).status).toBe(403);
    const cap = await ext.post('/jobs/capture', {
      url: 'https://www.linkedin.com/jobs/view/3999999999/',
      title: 'Backend Engineer, Python',
      company: 'Contoso Cloud',
      description: 'Requirements: 4+ years Python, PostgreSQL, AWS. Hybrid in Bengaluru.',
      location: 'Bengaluru, India',
    });
    expect(cap.status).toBe(201);
    expect(cap.body.match.score).toBeGreaterThan(50);
    const detail = await u.get(`/jobs/${cap.body.jobId}`);
    expect(detail.body.sources[0].platform).toBe('linkedin');
    expect(detail.body.applyCapabilities[0].status).toBe('USER_ASSISTED');
  });
});
