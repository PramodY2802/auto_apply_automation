import { describe, expect, it } from 'vitest';
import { normalizedJobSchema } from '@autoapply/shared';
import {
  DEFAULT_WEIGHTS,
  MatchingEngine,
  detectWorkMode,
  enrichJob,
  extractExperienceRange,
  extractSkills,
  findDuplicate,
  htmlToText,
  jobFingerprint,
  parseSalary,
  type MatchJob,
  type MatchPreferences,
} from './index';

const prefs: MatchPreferences = {
  titles: ['Backend Developer', 'Software Engineer'],
  experienceMinYears: 3,
  experienceMaxYears: 8,
  locations: [{ city: 'Bengaluru', country: 'India' }],
  workModes: ['REMOTE', 'HYBRID'],
  employmentTypes: ['FULL_TIME'],
  salaryMin: 2_000_000,
  salaryMax: null,
  salaryCurrency: 'INR',
  salaryPeriod: 'YEAR',
  preferredCompanies: [],
  excludedCompanies: ['Evil Corp'],
  keywords: ['postgres'],
  maxPostingAgeDays: 30,
};
const candidate = { skills: [{ name: 'Python' }, { name: 'PostgreSQL' }, { name: 'docker' }, { name: 'AWS' }], totalExperienceMonths: 84, titles: ['Senior Software Engineer'] };
const job = (over: Partial<MatchJob> = {}): MatchJob => ({
  title: 'Senior Backend Engineer',
  company: 'Northwind',
  description: 'We use Python and Postgres.',
  skills: ['Python', 'PostgreSQL', 'Kubernetes', 'Docker'],
  requiredSkills: ['Python', 'PostgreSQL', 'Kubernetes'],
  optionalSkills: ['Docker'],
  experienceMinYears: 5,
  experienceMaxYears: 8,
  location: 'Bengaluru, India',
  city: 'Bengaluru',
  country: 'India',
  workMode: 'HYBRID',
  employmentType: 'FULL_TIME',
  salaryMin: 2_500_000,
  salaryMax: 3_500_000,
  salaryCurrency: 'INR',
  salaryPeriod: 'YEAR',
  postedAt: new Date(),
  ...over,
});

describe('MatchingEngine', () => {
  const engine = new MatchingEngine(DEFAULT_WEIGHTS);
  it('scores a strong fit highly and explains it', () => {
    const r = engine.score(candidate, prefs, job());
    expect(r.overallScore).toBeGreaterThan(80);
    expect(r.missingSkills).toEqual(['Kubernetes']);
    expect(r.matchedSkills).toEqual(expect.arrayContaining(['Python', 'PostgreSQL', 'Docker']));
    expect(r.explanation.factors).toHaveLength(5);
    expect(r.disqualified).toBe(false);
  });
  it('is deterministic', () => {
    expect(engine.score(candidate, prefs, job())).toEqual(engine.score(candidate, prefs, job()));
  });
  it('disqualifies excluded companies, work modes and old postings', () => {
    expect(engine.score(candidate, prefs, job({ company: 'Evil Corp Inc.' })).disqualified).toBe(true);
    const onsite = engine.score(candidate, prefs, job({ workMode: 'ONSITE' }));
    expect(onsite.disqualified).toBe(true);
    expect(onsite.overallScore).toBeLessThanOrEqual(30);
    expect(engine.score(candidate, prefs, job({ postedAt: new Date(Date.now() - 60 * 86400000) })).explanation.disqualifiers[0]).toMatch(/days ago/);
  });
  it('penalizes missing experience and low salary', () => {
    const junior = engine.score({ ...candidate, totalExperienceMonths: 12 }, prefs, job());
    expect(junior.experienceScore).toBe(0);
    expect(engine.score(candidate, prefs, job({ salaryMin: 800_000, salaryMax: 1_000_000 })).salaryScore).toBeLessThan(50);
    expect(engine.score(candidate, prefs, job({ salaryCurrency: 'USD', salaryMin: 100000, salaryMax: 150000 })).salaryScore).toBe(50);
  });
  it('respects configurable weights', () => {
    const skillOnly = new MatchingEngine({ skill: 1, experience: 0, location: 0, preference: 0, salary: 0 });
    expect(skillOnly.score(candidate, prefs, job()).overallScore).toBeCloseTo(skillOnly.score(candidate, prefs, job()).skillScore);
  });
});

describe('normalization', () => {
  it('parses salaries', () => {
    expect(parseSalary('$120,000 - $150,000 a year')).toEqual({ min: 120000, max: 150000, currency: 'USD', period: 'YEAR' });
    expect(parseSalary('₹12-18 LPA')).toEqual({ min: 1200000, max: 1800000, currency: 'INR', period: 'YEAR' });
    expect(parseSalary('€60k–€75k')).toMatchObject({ min: 60000, max: 75000, currency: 'EUR' });
    expect(parseSalary('$45/hour')).toMatchObject({ min: 45, period: 'HOUR' });
    expect(parseSalary('competitive')).toMatchObject({ min: null });
  });
  it('extracts experience ranges', () => {
    expect(extractExperienceRange('3-5 years of experience')).toEqual({ min: 3, max: 5 });
    expect(extractExperienceRange('at least 4 years')).toEqual({ min: 4, max: null });
    expect(extractExperienceRange('5+ yrs')).toEqual({ min: 5, max: null });
    expect(extractExperienceRange('fresher welcome')).toEqual({ min: 0, max: 1 });
  });
  it('splits required/optional skills by section', () => {
    const r = extractSkills('Requirements:\n- Python and PostgreSQL\nNice to have:\n- Kubernetes, Terraform');
    expect(r.required).toEqual(expect.arrayContaining(['Python', 'PostgreSQL']));
    expect(r.optional).toEqual(expect.arrayContaining(['Kubernetes', 'Terraform']));
  });
  it('detects work mode and converts html', () => {
    expect(detectWorkMode('Remote - India')).toBe('REMOTE');
    expect(detectWorkMode('Hybrid (3 days in office)')).toBe('HYBRID');
    expect(htmlToText('<p>Hello&nbsp;<b>World</b></p><ul><li>One</li></ul>')).toBe('Hello World\n• One');
  });
  it('enriches jobs', () => {
    const j = enrichJob(normalizedJobSchema.parse({ platform: 'sandbox', externalId: '1', url: 'https://x.test/1', title: 'Backend Engineer', company: 'Acme', description: 'Remote role. 3-5 years. Requirements: Python, Django.\nSalary: $100k - $120k per year' }));
    expect(j.workMode).toBe('REMOTE');
    expect(j.experienceMinYears).toBe(3);
    expect(j.requiredSkills).toEqual(expect.arrayContaining(['Python', 'Django']));
    expect(j.salaryMax).toBe(120000);
  });
});

describe('deduplication', () => {
  it('fingerprints syndicated postings identically', () => {
    const a = jobFingerprint({ company: 'Acme Technologies Pvt Ltd', title: 'Sr. Backend Dev', location: 'Pune, India', city: null, workMode: null });
    const b = jobFingerprint({ company: 'ACME', title: 'Senior Back-end Developer', location: 'Pune', city: 'Pune', workMode: null });
    expect(a).toBe(b);
    expect(jobFingerprint({ company: 'ACME', title: 'Senior Back-end Developer', location: 'Delhi', city: null, workMode: null })).not.toBe(a);
  });
  it('finds fuzzy duplicates with same company and description', () => {
    const desc = 'We are hiring a backend engineer to build payment APIs in Python with PostgreSQL and Kafka at scale for millions of users across the world.';
    const dup = findDuplicate({ company: 'Acme Inc', title: 'Backend Engineer II', description: desc, location: null }, [
      { id: 'x', company: 'Other', title: 'Backend Engineer II', description: desc, location: null },
      { id: 'y', company: 'Acme', title: 'Backend Engineer II (Payments)', description: desc, location: null },
    ]);
    expect(dup?.id).toBe('y');
    expect(findDuplicate({ company: 'Acme', title: 'Data Scientist', description: 'ML', location: null }, [{ id: 'y', company: 'Acme', title: 'Backend Engineer', description: desc, location: null }])).toBeNull();
  });
});
