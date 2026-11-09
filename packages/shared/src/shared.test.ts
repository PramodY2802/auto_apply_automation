import { describe, expect, it } from 'vitest';
import { canTransition, canonicalizeSkill, detectSkillsInText, normalizeCompany, normalizeTitle, preferencesSchema, redactForLog, extractedResumeSchema } from './index';

describe('application status transitions', () => {
  it('blocks jumping from DISCOVERED straight to OFFER', () => {
    expect(canTransition('DISCOVERED', 'OFFER')).toBe(false);
  });
  it('allows IN_PROGRESS -> APPLIED and APPLIED -> INTERVIEW', () => {
    expect(canTransition('IN_PROGRESS', 'APPLIED')).toBe(true);
    expect(canTransition('APPLIED', 'INTERVIEW')).toBe(true);
  });
});

describe('skills', () => {
  it('canonicalizes aliases', () => {
    expect(canonicalizeSkill('reactjs').name).toBe('React');
    expect(canonicalizeSkill('Postgres').category).toBe('DATABASE');
    expect(canonicalizeSkill('Underwater Basket Weaving').known).toBe(false);
  });
  it('detects skills in prose without ambiguous false positives', () => {
    const found = detectSkillsInText('Built REST APIs with Node.js, TypeScript and PostgreSQL on AWS. Go to market.').map((s) => s.name);
    expect(found).toEqual(expect.arrayContaining(['Node.js', 'TypeScript', 'PostgreSQL', 'AWS', 'REST APIs']));
    expect(found).not.toContain('Go');
  });
  it('handles symbol skills', () => {
    const found = detectSkillsInText('Experience in C++ and C# with .NET core').map((s) => s.name);
    expect(found).toEqual(expect.arrayContaining(['C++', 'C#', '.NET']));
  });
});

describe('text normalization', () => {
  it('normalizes company names', () => {
    expect(normalizeCompany('Acme Technologies Pvt. Ltd.')).toBe('acme');
    expect(normalizeCompany('ACME, Inc')).toBe('acme');
  });
  it('normalizes titles', () => {
    expect(normalizeTitle('Sr. Backend Dev (Remote)')).toBe('senior back end developer');
  });
  it('redacts secrets and contact data', () => {
    const out = redactForLog('key sk-abcdefghijklmnop mail a.b@c.com phone +91 98765 43210');
    expect(out).not.toContain('abcdefghijkl');
    expect(out).not.toContain('a.b@c.com');
    expect(out).not.toContain('98765');
  });
});

describe('schemas', () => {
  it('requires consent for automatic mode', () => {
    const r = preferencesSchema.safeParse({ titles: ['Engineer'], applicationMode: 'AUTOMATIC' });
    expect(r.success).toBe(false);
  });
  it('rejects inverted salary range', () => {
    expect(preferencesSchema.safeParse({ titles: ['x'], salaryMin: 10, salaryMax: 5 }).success).toBe(false);
  });
  it('fills extraction defaults', () => {
    const r = extractedResumeSchema.parse({ fullName: 'A', email: null, phone: null, location: null, summary: null, currentTitle: null, totalExperienceMonths: null });
    expect(r.skills.technical).toEqual([]);
    expect(r.links.github).toBeNull();
  });
});
