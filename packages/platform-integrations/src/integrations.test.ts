import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GreenhouseAdapter,
  LeverAdapter,
  LinkedInAdapter,
  PlatformRegistry,
  SandboxAdapter,
  UnsupportedOperationError,
  buildSearchQueries,
  normalizeJobPosting,
  platformFromUrl,
  type PlatformContext,
} from './index';

const fx = (n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', n), 'utf8'));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
function ctx(routes: Record<string, unknown>, settings: Record<string, unknown> = {}): PlatformContext {
  const fetchImpl = vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { userId: 'u1', settings, fetch: fetchImpl as any, logger };
}

describe('capability matrix honesty', () => {
  it('reports LinkedIn/Indeed/Naukri search as unsupported and throws on use', async () => {
    const reg = new PlatformRegistry();
    for (const k of ['linkedin', 'indeed', 'naukri'] as const) {
      const a = reg.get(k);
      expect(a.capabilities.searchJobs.status).toBe('UNSUPPORTED');
      expect(a.capabilities.submitApplication.status).toBe('USER_ASSISTED');
      await expect(a.searchJobs(ctx({}), { keywords: 'x' })).rejects.toBeInstanceOf(UnsupportedOperationError);
    }
    expect(reg.get('sandbox').capabilities.submitApplication.status).toBe('IMPLEMENTED');
    expect(reg.describe().find((d) => d.key === 'linkedin')!.supportsAutomatedSearch).toBe(false);
  });
  it('assisted platforms ask the user to sign in themselves', async () => {
    const r = await new LinkedInAdapter().authenticate(ctx({}));
    expect(r.status).toBe('PENDING_USER_ACTION');
    expect(r.userAction?.type).toBe('INSTALL_EXTENSION');
  });
});

describe('Greenhouse adapter (recorded responses)', () => {
  const gh = new GreenhouseAdapter();
  it('requires board configuration', async () => {
    expect((await gh.authenticate(ctx({}), {})).status).toBe('PENDING_USER_ACTION');
    expect((await gh.authenticate(ctx({}), { boards: ['examplecorp'] })).status).toBe('CONNECTED');
  });
  it('searches and normalizes, filtering locally', async () => {
    const c = ctx({ '/boards/examplecorp/jobs?content=true': fx('greenhouse-jobs.json') }, { boards: ['examplecorp'] });
    const r = await gh.searchJobs(c, { keywords: 'backend engineer' });
    expect(r.examined).toBe(2);
    expect(r.jobs).toHaveLength(1);
    const j = r.jobs[0]!;
    expect(j.externalId).toBe('examplecorp:4012345');
    expect(j.workMode).toBe('REMOTE');
    expect(j.experienceMinYears).toBe(5);
    expect(j.requiredSkills).toEqual(expect.arrayContaining(['Python', 'PostgreSQL']));
    expect(j.optionalSkills).toEqual(['Kubernetes']);
  });
  it('maps public application questions', async () => {
    const c = ctx({ '/jobs/4012345?questions=true': fx('greenhouse-questions.json') });
    const f = await gh.getApplicationForm(c, { externalId: 'examplecorp:4012345', url: 'https://boards.greenhouse.io/examplecorp/jobs/4012345' });
    expect(f.submission).toBe('USER_ASSISTED');
    expect(f.fields.map((x) => x.type)).toEqual(['TEXT', 'FILE', 'DROPDOWN']);
    expect(f.fields[2]!.options).toHaveLength(2);
  });
  it('records per-board failures as warnings', async () => {
    const r = await gh.searchJobs(ctx({}, { boards: ['missing'] }), { keywords: 'x' });
    expect(r.warnings[0]).toMatch(/missing/);
  });
});

describe('Lever adapter (recorded responses)', () => {
  it('normalizes postings', async () => {
    const r = await new LeverAdapter().searchJobs(ctx({ '/postings/examplelabs': fx('lever-postings.json') }, { sites: ['examplelabs'] }), { keywords: 'backend', location: 'Bengaluru' });
    const j = r.jobs[0]!;
    expect(j.company).toBe('Examplelabs');
    expect(j.workMode).toBe('HYBRID');
    expect(j.employmentType).toBe('FULL_TIME');
    expect(j.salaryMin).toBe(2500000);
    expect(j.requiredSkills).toEqual(expect.arrayContaining(['Node.js', 'TypeScript', 'AWS']));
  });
});

describe('Sandbox adapter', () => {
  it('searches the sandbox API', async () => {
    const c = ctx({ '/api/jobs?': { jobs: [{ id: 'j1', title: 'Python Developer', company: 'Sandbox Co', description: '<p>Python, Django. 2+ years</p>', location: 'Remote', workMode: 'REMOTE', employmentType: 'FULL_TIME', postedAt: new Date().toISOString() }] } }, { baseUrl: 'http://sandbox.test' });
    const r = await new SandboxAdapter().searchJobs(c, { keywords: 'python' });
    expect(r.jobs[0]!.applyUrl).toBe('http://sandbox.test/jobs/j1/apply');
    expect(r.jobs[0]!.experienceMinYears).toBe(2);
  });
  it('needs the browser worker for form operations', async () => {
    await expect(new SandboxAdapter().getApplicationForm(ctx({}), { externalId: 'j1', url: 'http://x/jobs/j1' })).rejects.toThrow(/Browser automation/);
  });
});

describe('JSON-LD capture normalization', () => {
  it('normalizes a schema.org JobPosting', () => {
    const j = normalizeJobPosting({
      url: 'https://www.indeed.com/viewjob?jk=abc123',
      jsonLd: {
        '@type': 'JobPosting', title: 'Java Developer', hiringOrganization: { name: 'Fabrikam' }, datePosted: '2026-11-01',
        employmentType: 'FULL_TIME', description: '<p>Java, Spring Boot, 3-6 years</p>',
        jobLocation: { address: { addressLocality: 'Pune', addressCountry: 'IN' } },
        baseSalary: { currency: 'INR', value: { minValue: 1200000, maxValue: 1800000, unitText: 'YEAR' } },
      },
    });
    expect(j.platform).toBe('indeed');
    expect(j.externalId).toBe('abc123');
    expect(j.city).toBe('Pune');
    expect(j.salaryMax).toBe(1800000);
    expect(j.requiredSkills).toEqual(expect.arrayContaining(['Java', 'Spring Boot']));
  });
  it('detects platform from URL', () => {
    expect(platformFromUrl('https://www.linkedin.com/jobs/view/123')).toBe('linkedin');
    expect(platformFromUrl('https://www.naukri.com/job-listings-x')).toBe('naukri');
    expect(platformFromUrl('notaurl')).toBeNull();
  });
});

describe('query generation', () => {
  it('builds title × location queries', () => {
    const q = buildSearchQueries({ titles: ['Python Developer', 'Backend Developer'], locations: [{ city: 'Pune' }, { city: 'Bengaluru' }], workModes: ['ONSITE', 'REMOTE'], maxPostingAgeDays: 14, keywords: [] });
    expect(q).toHaveLength(4);
    expect(buildSearchQueries({ titles: ['A'], locations: [{ city: 'Pune' }], workModes: ['REMOTE'], maxPostingAgeDays: null, keywords: [] })[0]!.location).toBeNull();
  });
});
