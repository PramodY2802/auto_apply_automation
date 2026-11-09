import { describe, expect, it, vi } from 'vitest';
import { answerPreferencesSchema, type DetectedField } from '@autoapply/shared';
import { AnswerEngine, classifyIntent, findUnsupportedClaims, matchOption, type CandidateContext, type JobContext } from './index';

const cand: CandidateContext = {
  fullName: 'Arjun Mehta',
  email: 'arjun@example.com',
  phone: '+91 98765 43210',
  location: 'Bengaluru, India',
  currentTitle: 'Senior Software Engineer',
  summary: null,
  totalExperienceMonths: 88,
  links: { linkedin: 'https://linkedin.com/in/arjun', github: null },
  skills: [{ name: 'Python', years: 7 }, { name: 'PostgreSQL' }, { name: 'AWS' }],
  experiences: [{ company: 'Northwind Labs', title: 'Senior Software Engineer', startDate: '2021-01', endDate: null, isCurrent: true, description: 'Billing APIs in Python on AWS' }],
  education: [{ institution: 'VIT University', degree: 'B.Tech', field: 'Computer Science', endDate: '2017' }],
  projects: [],
  certifications: [],
  preferences: { salaryMin: 3000000, salaryMax: null, salaryCurrency: 'INR', salaryPeriod: 'YEAR', noticePeriodDays: 30, answer: answerPreferencesSchema.parse({ workAuthorizationCountries: ['India'] }) },
  savedAnswers: [],
  resumeFileAvailable: true,
};
const job: JobContext = { title: 'Backend Engineer', company: 'Acme', description: 'Python and PostgreSQL', requiredSkills: ['Python', 'PostgreSQL'], location: 'Pune, India', country: 'India' };
const f = (label: string, type: DetectedField['type'] = 'TEXT', options: DetectedField['options'] = [], key = label.toLowerCase().replace(/\W+/g, '_')): DetectedField => ({ key, label, type, required: true, options });

describe('intent classification', () => {
  it.each([
    ['First Name', 'FIRST_NAME'],
    ['Are you legally authorized to work in India?', 'WORK_AUTHORIZATION'],
    ['Will you now or in the future require visa sponsorship?', 'SPONSORSHIP'],
    ['How many years of experience do you have with Python?', 'SKILL_EXPERIENCE'],
    ['Total years of experience', 'TOTAL_EXPERIENCE'],
    ['Expected CTC', 'SALARY_EXPECTATION'],
    ['Why do you want to work at Acme?', 'MOTIVATION'],
    ['Gender', 'DEMOGRAPHIC'],
    ['I certify that the information provided is true and complete', 'LEGAL_DECLARATION'],
    ['Notice period (days)', 'NOTICE_PERIOD'],
  ])('%s → %s', (label, intent) => expect(classifyIntent({ label, key: 'x', type: 'TEXT' })).toBe(intent));
  it('uses field type for files', () => expect(classifyIntent({ label: 'Attach', key: 'file', type: 'FILE' })).toBe('RESUME_UPLOAD'));
});

describe('deterministic answers', () => {
  const engine = new AnswerEngine();
  it('fills identity fields from the profile', async () => {
    expect((await engine.answer(f('First Name'), cand, job)).answer).toBe('Arjun');
    expect((await engine.answer(f('Last Name'), cand, job)).answer).toBe('Mehta');
    const email = await engine.answer(f('Email', 'EMAIL'), cand, job);
    expect(email).toMatchObject({ answer: 'arjun@example.com', source: 'PROFILE', approvalRequired: false });
  });
  it('computes total experience and maps to range options', async () => {
    const r = await engine.answer(f('Years of experience', 'DROPDOWN', [{ value: 'a', label: '0-2 years' }, { value: 'b', label: '3-6 years' }, { value: 'c', label: '7+ years' }]), cand, job);
    expect(r.answer).toBe('c');
  });
  it('never guesses unknown skill experience', async () => {
    const pg = await engine.answer(f('How many years of experience do you have with PostgreSQL?', 'NUMBER'), cand, job);
    expect(pg.requiresUserInput).toBe(true);
    const go = await engine.answer(f('How many years of experience do you have with Go?', 'NUMBER'), cand, job);
    expect(go.requiresUserInput).toBe(true);
    expect((await engine.answer(f('How many years of experience do you have with Python?', 'NUMBER'), cand, job)).answer).toBe('7');
  });
  it('requires confirmation for legal/sensitive questions', async () => {
    const wa = await engine.answer(f('Are you legally authorized to work in India?', 'DROPDOWN', [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }]), cand, job);
    expect(wa).toMatchObject({ answer: '1', isSensitive: true, approvalRequired: true });
    const sp = await engine.answer(f('Will you require visa sponsorship?', 'YES_NO'), cand, job);
    expect(sp.requiresUserInput).toBe(true);
    const legal = await engine.answer(f('I certify that the information provided is true', 'CHECKBOX'), cand, job);
    expect(legal.requiresUserInput).toBe(true);
    const cur = await engine.answer(f('Current CTC'), cand, job);
    expect(cur.requiresUserInput).toBe(true);
  });
  it('defaults demographic questions to decline, pending approval', async () => {
    const r = await engine.answer(f('Gender', 'DROPDOWN', [{ value: 'm', label: 'Male' }, { value: 'f', label: 'Female' }, { value: 'd', label: 'Decline to self-identify' }]), cand, job);
    expect(r).toMatchObject({ answer: 'd', approvalRequired: true, isSensitive: true });
  });
  it('reuses saved answers', async () => {
    const r = await engine.answer(f('Why do you want to work at Acme?', 'TEXTAREA'), { ...cand, savedAnswers: [{ questionKey: 'why want to work at acme', question: 'Why...', intent: 'MOTIVATION', answer: 'Because…' }] }, job);
    expect(r.source).toBe('SAVED_ANSWER');
  });
  it('does not generate generic answers without an AI provider', async () => {
    const r = await engine.answer(f('Why do you want to work at Acme?', 'TEXTAREA'), cand, job);
    expect(r.requiresUserInput).toBe(true);
  });
});

describe('AI answers', () => {
  it('uses candidate + job context and validates claims', async () => {
    const gen = vi.fn(async ({ prompt }: { prompt: string }) => {
      expect(prompt).toContain('Northwind Labs');
      expect(prompt).toContain('Backend Engineer');
      return { data: { answer: 'I have built billing APIs in Python on AWS at Northwind Labs.', requiresUserInput: false, confidence: 0.9, reasoning: 'ok', usedFacts: [] }, usageLogId: 'log1', provider: 'mock', model: 'm' };
    });
    const r = await new AnswerEngine(gen).answer(f('Why are you a good fit?', 'TEXTAREA'), cand, job);
    expect(r).toMatchObject({ source: 'AI', approvalRequired: false, aiUsageLogId: 'log1' });
  });
  it('flags fabricated skills / years and forces approval', async () => {
    const gen = async () => ({ data: { answer: 'With 12 years of Kubernetes and Rust experience, I am ideal.', requiresUserInput: false, confidence: 0.95, reasoning: '', usedFacts: [] }, usageLogId: null, provider: 'mock', model: 'm' });
    const r = await new AnswerEngine(gen).answer(f('Tell us about yourself', 'TEXTAREA'), cand, job);
    expect(r.approvalRequired).toBe(true);
    expect(r.confidence).toBeLessThanOrEqual(0.4);
    expect(r.reasoning).toMatch(/Kubernetes/);
  });
  it('respects the model saying it lacks information', async () => {
    const gen = async () => ({ data: { answer: null, requiresUserInput: true, confidence: 0, reasoning: 'No info about management experience', usedFacts: [] }, usageLogId: null, provider: 'mock', model: 'm' });
    const r = await new AnswerEngine(gen).answer(f('Describe your people management experience', 'TEXTAREA'), cand, job);
    expect(r.requiresUserInput).toBe(true);
  });
  it('detects unsupported claims', () => {
    expect(findUnsupportedClaims('5 years of Python', cand)).toEqual([]);
    expect(findUnsupportedClaims('I know Terraform', cand)[0]).toMatch(/Terraform/);
  });
  it('matches options', () => {
    expect(matchOption(f('x', 'DROPDOWN', [{ value: '1', label: 'Yes, I am' }, { value: '0', label: 'No' }]), 'Yes')).toBe('1');
    expect(matchOption(f('x', 'DROPDOWN', [{ value: '1', label: 'A' }]), 'Z')).toBeNull();
  });
});

describe('URL normalization', () => {
  it('adds a scheme for URL-typed fields', async () => {
    const r = await new AnswerEngine().answer(f('LinkedIn profile', 'URL'), { ...cand, links: { linkedin: 'linkedin.com/in/arjun' } }, job);
    expect(r.answer).toBe('https://linkedin.com/in/arjun');
  });
});
