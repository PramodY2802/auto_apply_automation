import {
  SENSITIVE_INTENTS,
  canonicalizeSkill,
  detectSkillsInText,
  generatedAnswerSchema,
  normalizeQuestionKey,
  type AnswerPreferences,
  type AnswerSource,
  type DetectedField,
  type GeneratedAnswer,
  type QuestionIntent,
} from '@autoapply/shared';
import { classifyIntent, extractSkillFromQuestion } from './intent';

export interface CandidateContext {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  currentTitle: string | null;
  summary: string | null;
  totalExperienceMonths: number | null;
  links: { linkedin?: string | null; github?: string | null; portfolio?: string | null };
  skills: { name: string; years?: number | null }[];
  experiences: { company: string | null; title: string | null; startDate: string | null; endDate: string | null; isCurrent: boolean; description: string | null }[];
  education: { institution: string | null; degree: string | null; field: string | null; endDate: string | null }[];
  projects: { name: string; description: string | null }[];
  certifications: { name: string }[];
  preferences: {
    salaryMin: number | null;
    salaryMax: number | null;
    salaryCurrency: string;
    salaryPeriod: string;
    noticePeriodDays: number | null;
    answer: AnswerPreferences;
  };
  savedAnswers: { questionKey: string; question: string; intent: string; answer: string }[];
  resumeFileAvailable: boolean;
}

export interface JobContext {
  title: string;
  company: string;
  description: string;
  requiredSkills: string[];
  location: string | null;
  country: string | null;
}

export type AnswerGenerator = (args: { system: string; prompt: string }) => Promise<{ data: GeneratedAnswer; usageLogId: string | null; provider: string; model: string }>;

export interface AnswerResult {
  fieldKey: string;
  intent: QuestionIntent;
  answer: string | null;
  source: AnswerSource | null;
  requiresUserInput: boolean;
  isSensitive: boolean;
  approvalRequired: boolean;
  confidence: number;
  reasoning: string;
  aiUsageLogId: string | null;
}

export const ANSWER_SYSTEM_PROMPT = `You answer job application questions on behalf of a candidate, using ONLY the candidate facts provided.
Hard rules:
- Never invent or exaggerate experience, employers, job titles, qualifications, certifications, skills, dates, numbers, legal eligibility or work authorization.
- If the facts do not contain what the question asks, set "answer" to null and "requiresUserInput" to true.
- Write in first person as the candidate, concise and specific to the job. No placeholders like [Company].
- Do not mention skills or experience that are not in the candidate facts.
- "usedFacts": list the specific candidate facts you relied on.
- "confidence": 0..1 — how fully the facts support the answer.
Return JSON only.`;

const YES = /^(yes|y|true|1)$/i;

function years(months: number | null): number | null {
  return months == null ? null : Math.round((months / 12) * 10) / 10;
}

/** Map a free answer to one of the field's options (by value or label). */
export function matchOption(field: DetectedField, answer: string): string | null {
  if (!field.options.length) return answer;
  const a = answer.trim().toLowerCase();
  const exact = field.options.find((o) => o.value.toLowerCase() === a || o.label.toLowerCase() === a);
  if (exact) return exact.value;
  if (/^(yes|no)$/.test(a)) {
    const yn = field.options.find((o) => new RegExp(`^${a}\\b`, 'i').test(o.label));
    if (yn) return yn.value;
  }
  const num = Number(a);
  if (!Number.isNaN(num)) {
    // Range options like "0-2 years", "3-5", "5+"
    for (const o of field.options) {
      const m = /(\d+)\s*(?:-|–|to)\s*(\d+)/.exec(o.label) ?? /(\d+)\s*\+/.exec(o.label);
      if (m && num >= Number(m[1]) && (m[2] === undefined || num <= Number(m[2]))) return o.value;
    }
  }
  const contains = field.options.filter((o) => o.label.toLowerCase().includes(a) || a.includes(o.label.toLowerCase()));
  return contains.length === 1 ? contains[0]!.value : null;
}

/** Flags claims in generated text that the candidate facts do not support. */
export function findUnsupportedClaims(text: string, cand: CandidateContext): string[] {
  const issues: string[] = [];
  const have = new Set(cand.skills.map((s) => canonicalizeSkill(s.name).key));
  for (const s of detectSkillsInText(text)) {
    if (s.category !== 'SOFT' && !have.has(canonicalizeSkill(s.name).key)) issues.push(`mentions skill not in profile: ${s.name}`);
  }
  const total = years(cand.totalExperienceMonths);
  for (const m of text.matchAll(/(\d{1,2})\+?\s*(?:years|yrs)/gi)) {
    if (total == null || Number(m[1]) > Math.ceil(total)) issues.push(`claims ${m[1]} years of experience (profile: ${total ?? 'unknown'})`);
  }
  return issues;
}

/**
 * Application question answering engine.
 * Order of precedence: user-approved saved answers → deterministic profile/preference
 * facts → AI generation grounded in candidate + job context. Unknowns are never guessed.
 */
export class AnswerEngine {
  constructor(private readonly generator?: AnswerGenerator) {}

  async answer(field: DetectedField, cand: CandidateContext, job: JobContext): Promise<AnswerResult> {
    const intent = classifyIntent(field);
    const isSensitive = SENSITIVE_INTENTS.includes(intent);
    const base = { fieldKey: field.key, intent, isSensitive, aiUsageLogId: null as string | null };
    const done = (answer: string | null, source: AnswerSource | null, confidence: number, reasoning: string, extra: Partial<AnswerResult> = {}): AnswerResult => {
      let finalAnswer = answer;
      let requiresUserInput = answer == null;
      if (answer != null && field.options.length && field.type !== 'TEXT' && field.type !== 'TEXTAREA') {
        finalAnswer = matchOption(field, answer);
        if (finalAnswer == null) {
          requiresUserInput = true;
          reasoning += ` (no option matched "${answer}")`;
        }
      }
      if (finalAnswer && field.maxLength && finalAnswer.length > field.maxLength) finalAnswer = finalAnswer.slice(0, field.maxLength);
      if (finalAnswer && field.type === 'URL' && !/^https?:\/\//i.test(finalAnswer)) finalAnswer = `https://${finalAnswer.replace(/^\/+/, '')}`;
      const approvalRequired = isSensitive || requiresUserInput || confidence < 0.75 || (source === 'AI' && cand.preferences.answer.alwaysRequireApproval);
      return { ...base, answer: finalAnswer, source: finalAnswer == null ? null : source, requiresUserInput, approvalRequired, confidence, reasoning, ...extra };
    };
    const needInput = (why: string) => done(null, null, 0, why);

    // 1. Previously approved answers.
    const key = normalizeQuestionKey(field.label);
    const saved = cand.savedAnswers.find((s) => s.questionKey === key) ?? (intent !== 'CUSTOM' && intent !== 'MOTIVATION' ? cand.savedAnswers.find((s) => s.intent === intent) : undefined);
    if (saved && intent !== 'RESUME_UPLOAD') return done(saved.answer, 'SAVED_ANSWER', 0.95, 'Reused your previously approved answer');

    const p = cand.preferences;
    const [first, ...rest] = (cand.fullName ?? '').split(/\s+/).filter(Boolean);
    switch (intent) {
      case 'FULL_NAME':
        return cand.fullName ? done(cand.fullName, 'PROFILE', 1, 'From profile') : needInput('Name missing from profile');
      case 'FIRST_NAME':
        return first ? done(first, 'PROFILE', 1, 'From profile') : needInput('Name missing from profile');
      case 'LAST_NAME':
        return rest.length ? done(rest.join(' '), 'PROFILE', 1, 'From profile') : needInput('Last name missing from profile');
      case 'EMAIL':
        return cand.email ? done(cand.email, 'PROFILE', 1, 'From profile') : needInput('Email missing from profile');
      case 'PHONE':
        return cand.phone ? done(cand.phone, 'PROFILE', 1, 'From profile') : needInput('Phone missing from profile');
      case 'LOCATION':
        return cand.location ? done(cand.location, 'PROFILE', 0.9, 'From profile') : needInput('Location missing from profile');
      case 'LINKEDIN':
        return cand.links.linkedin ? done(cand.links.linkedin, 'PROFILE', 1, 'From profile') : field.required ? needInput('No LinkedIn URL in profile') : done('', 'PROFILE', 1, 'Optional; no LinkedIn URL in profile');
      case 'GITHUB':
        return cand.links.github ? done(cand.links.github, 'PROFILE', 1, 'From profile') : field.required ? needInput('No GitHub URL in profile') : done('', 'PROFILE', 1, 'Optional; no GitHub URL in profile');
      case 'PORTFOLIO':
        return cand.links.portfolio ? done(cand.links.portfolio, 'PROFILE', 1, 'From profile') : field.required ? needInput('No portfolio URL in profile') : done('', 'PROFILE', 1, 'Optional; none in profile');
      case 'RESUME_UPLOAD':
        return cand.resumeFileAvailable ? done('resume', 'PROFILE', 1, 'Attaches your selected resume') : needInput('No resume file selected');
      case 'CURRENT_TITLE':
        return cand.currentTitle ? done(cand.currentTitle, 'PROFILE', 0.95, 'From profile') : needInput('Current title missing');
      case 'CURRENT_COMPANY': {
        const cur = cand.experiences.find((e) => e.isCurrent)?.company;
        return cur ? done(cur, 'PROFILE', 0.95, 'Current employer from profile') : needInput('No current employer in profile');
      }
      case 'TOTAL_EXPERIENCE': {
        const y = years(cand.totalExperienceMonths);
        if (y == null) return needInput('Total experience unknown — add it to your profile');
        return done(field.type === 'NUMBER' ? String(Math.floor(y)) : String(Math.floor(y)), 'PROFILE', 0.9, `Computed from your work history (${y} years)`);
      }
      case 'SKILL_EXPERIENCE': {
        const skillName = extractSkillFromQuestion(field.label);
        if (!skillName) return needInput('Could not identify which skill is asked about');
        const c = canonicalizeSkill(skillName);
        const s = cand.skills.find((x) => canonicalizeSkill(x.name).key === c.key);
        if (!s) return needInput(`${c.name} is not in your profile — answer this yourself`);
        if (s.years != null) return done(String(Math.floor(s.years)), 'PROFILE', 0.9, `Years with ${c.name} from your profile`);
        return needInput(`Your profile lists ${c.name} but not years of experience with it`);
      }
      case 'NOTICE_PERIOD':
        return p.noticePeriodDays != null ? done(field.type === 'NUMBER' ? String(p.noticePeriodDays) : `${p.noticePeriodDays} days`, 'PREFERENCE', 0.95, 'From your preferences') : needInput('Notice period not set in preferences');
      case 'AVAILABILITY':
        if (p.answer.availableFrom) return done(p.answer.availableFrom, 'PREFERENCE', 0.9, 'From your preferences');
        return p.noticePeriodDays != null ? done(`Available after a ${p.noticePeriodDays}-day notice period`, 'PREFERENCE', 0.8, 'Derived from your notice period') : needInput('Availability not set');
      case 'SALARY_EXPECTATION':
        if (p.salaryMin == null) return needInput('Expected salary not set in preferences');
        return done(field.type === 'NUMBER' ? String(p.salaryMin) : `${p.salaryMin.toLocaleString('en-US')} ${p.salaryCurrency} per ${p.salaryPeriod.toLowerCase()}`, 'PREFERENCE', 0.9, 'From your salary preference');
      case 'CURRENT_SALARY':
        return needInput('Current compensation is sensitive and never auto-filled');
      case 'RELOCATION':
        return p.answer.willingToRelocate == null ? needInput('Relocation preference not set') : done(p.answer.willingToRelocate ? 'Yes' : 'No', 'PREFERENCE', 0.95, 'From your preferences');
      case 'SPONSORSHIP':
        return p.answer.requiresSponsorship == null ? needInput('Sponsorship requirement not set — legal declaration requires your input') : done(p.answer.requiresSponsorship ? 'Yes' : 'No', 'PREFERENCE', 0.9, 'From your declared sponsorship requirement (needs your confirmation)');
      case 'WORK_AUTHORIZATION': {
        const country = job.country ?? job.location ?? '';
        const auth = p.answer.workAuthorizationCountries;
        if (!auth.length || !country) return needInput('Work authorization is a legal declaration — please answer it yourself');
        const ok = auth.some((c) => country.toLowerCase().includes(c.toLowerCase()));
        return ok ? done('Yes', 'PREFERENCE', 0.85, `You declared authorization for ${auth.join(', ')} (needs your confirmation)`) : needInput(`Job is in ${country}; you have not declared authorization there`);
      }
      case 'DEMOGRAPHIC': {
        const decline = field.options.find((o) => /decline|prefer not|do not wish|don't wish|not to (say|disclose)/i.test(o.label));
        return decline ? done(decline.value, 'PREFERENCE', 0.5, 'Voluntary self-identification: defaulted to "decline" pending your choice') : needInput('Voluntary demographic question — answer yourself');
      }
      case 'LEGAL_DECLARATION':
        return needInput('Legal declarations and consents require your explicit confirmation');
      case 'EDUCATION': {
        const e = cand.education[0];
        if (!e?.degree && !e?.institution) return needInput('No education in profile');
        return done([e.degree, e.field ? `in ${e.field}` : null, e.institution ? `, ${e.institution}` : null].filter(Boolean).join(' ').replace(' ,', ','), 'PROFILE', 0.85, 'From profile education');
      }
      default:
        return this.generate(field, intent, cand, job, base, done, needInput);
    }
  }

  private async generate(
    field: DetectedField,
    intent: QuestionIntent,
    cand: CandidateContext,
    job: JobContext,
    base: { aiUsageLogId: string | null },
    done: (a: string | null, s: AnswerSource | null, c: number, r: string, extra?: Partial<AnswerResult>) => AnswerResult,
    needInput: (why: string) => AnswerResult,
  ): Promise<AnswerResult> {
    if (field.type === 'YES_NO' || field.type === 'CHECKBOX') return needInput('Yes/no question without a matching profile fact — answer yourself');
    if (!this.generator) return needInput('No AI provider configured; free-text questions need your answer');
    const facts = buildFacts(cand);
    const prompt = `<candidate_facts>\n${JSON.stringify(facts, null, 1)}\n</candidate_facts>\n<job>\nTitle: ${job.title}\nCompany: ${job.company}\nKey skills: ${job.requiredSkills.join(', ')}\nDescription: ${job.description.slice(0, 4000)}\n</job>\n<question type="${field.type}" required="${field.required}"${field.options.length ? ` options="${field.options.map((o) => o.label).join(' | ')}"` : ''}>\n${field.label}\n</question>\nTone: ${cand.preferences.answer.tone}. Max length: ${Math.min(field.maxLength ?? 10_000, cand.preferences.answer.maxLength)} characters.${field.options.length ? ' Answer with one of the option labels exactly.' : ''}`;
    let res;
    try {
      res = await this.generator({ system: ANSWER_SYSTEM_PROMPT, prompt });
    } catch (e: any) {
      return needInput(`AI answer generation failed (${e?.message ?? 'error'}); please answer manually`);
    }
    const parsed = generatedAnswerSchema.safeParse(res.data);
    if (!parsed.success) return needInput('AI returned an invalid answer; please answer manually');
    const g = parsed.data;
    if (g.requiresUserInput || !g.answer?.trim()) return { ...needInput(g.reasoning || 'The AI could not answer from your profile'), aiUsageLogId: res.usageLogId };
    const issues = findUnsupportedClaims(g.answer, cand);
    let confidence = g.confidence;
    let reasoning = g.reasoning || `Generated by ${res.provider}/${res.model} from your profile`;
    if (issues.length) {
      confidence = Math.min(confidence, 0.4);
      reasoning = `Needs review — ${issues.join('; ')}. ${reasoning}`;
    }
    return done(g.answer.trim(), 'AI', confidence, reasoning, { aiUsageLogId: res.usageLogId, intent });
  }
}

/** The fact sheet sent to the model — only verified profile data. */
export function buildFacts(c: CandidateContext) {
  return {
    name: c.fullName,
    currentTitle: c.currentTitle,
    location: c.location,
    totalExperienceYears: years(c.totalExperienceMonths),
    summary: c.summary,
    skills: c.skills.map((s) => (s.years != null ? `${s.name} (${s.years}y)` : s.name)),
    experience: c.experiences.map((e) => ({ title: e.title, company: e.company, from: e.startDate, to: e.isCurrent ? 'present' : e.endDate, highlights: e.description?.slice(0, 600) ?? null })),
    education: c.education,
    projects: c.projects.map((p) => ({ name: p.name, description: p.description?.slice(0, 300) ?? null })),
    certifications: c.certifications.map((x) => x.name),
  };
}

export const COVER_LETTER_SYSTEM = `${ANSWER_SYSTEM_PROMPT}\nYou are writing a short cover letter (150-250 words). Use only the candidate facts.`;

export async function generateCoverLetter(gen: AnswerGenerator, cand: CandidateContext, job: JobContext): Promise<{ text: string | null; issues: string[]; usageLogId: string | null }> {
  const prompt = `<candidate_facts>\n${JSON.stringify(buildFacts(cand), null, 1)}\n</candidate_facts>\n<job>\nTitle: ${job.title}\nCompany: ${job.company}\nDescription: ${job.description.slice(0, 4000)}\n</job>\nWrite the cover letter as the "answer" field.`;
  const res = await gen({ system: COVER_LETTER_SYSTEM, prompt });
  const parsed = generatedAnswerSchema.safeParse(res.data);
  if (!parsed.success || !parsed.data.answer) return { text: null, issues: ['AI could not produce a grounded cover letter'], usageLogId: res.usageLogId };
  return { text: parsed.data.answer, issues: findUnsupportedClaims(parsed.data.answer, cand), usageLogId: res.usageLogId };
}

export function isYes(v: string | null | undefined): boolean {
  return !!v && YES.test(v.trim());
}
