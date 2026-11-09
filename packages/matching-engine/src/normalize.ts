import crypto from 'node:crypto';
import {
  canonicalizeSkill,
  detectSkillsInText,
  jaccard,
  normalizeCompany,
  normalizeTitle,
  normalizeWhitespace,
  tokenize,
  type EmploymentType,
  type NormalizedJob,
  type SalaryPeriod,
  type WorkMode,
} from '@autoapply/shared';

/** Strip HTML to readable text (job boards often return HTML descriptions). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

export function detectWorkMode(...texts: (string | null | undefined)[]): WorkMode | null {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  if (/\bhybrid\b/.test(t)) return 'HYBRID';
  if (/\b(fully remote|remote[- ]first|100% remote|work from home|wfh|remote)\b/.test(t) && !/\bnot remote\b|\bno remote\b/.test(t)) return 'REMOTE';
  if (/\b(on[- ]?site|in[- ]office|office[- ]based)\b/.test(t)) return 'ONSITE';
  return null;
}

export function detectEmploymentType(...texts: (string | null | undefined)[]): EmploymentType | null {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  if (/\bintern(ship)?\b/.test(t)) return 'INTERNSHIP';
  if (/\b(contract|contractor|c2c|fixed[- ]term)\b/.test(t)) return 'CONTRACT';
  if (/\bfreelance\b/.test(t)) return 'FREELANCE';
  if (/\b(part[- ]time)\b/.test(t)) return 'PART_TIME';
  if (/\btemporary\b/.test(t)) return 'TEMPORARY';
  if (/\b(full[- ]time|permanent|fulltime)\b/.test(t)) return 'FULL_TIME';
  return null;
}

/** "3+ years", "3-5 years", "minimum 4 yrs" → range in years. */
export function extractExperienceRange(text: string): { min: number | null; max: number | null } {
  const t = text.toLowerCase();
  let m = /(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years|yrs|yoe)/.exec(t);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = /(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years|yrs)/.exec(t) ?? /(\d{1,2})\s*\+\s*(?:years|yrs)/.exec(t) ?? /(\d{1,2})\s*(?:years|yrs)(?:'|’)?\s*(?:of\s+)?(?:professional\s+|relevant\s+|hands-on\s+)?experience/.exec(t);
  if (m) return { min: Number(m[1]), max: null };
  if (/\b(fresher|entry[- ]level|new grad|graduate)\b/.test(t)) return { min: 0, max: 1 };
  return { min: null, max: null };
}

export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
}

/** Parses "$120,000 - $150,000 a year", "₹12-18 LPA", "€60k–€75k", "$45/hour". */
export function parseSalary(text: string | null | undefined): ParsedSalary {
  const none = { min: null, max: null, currency: null, period: null };
  if (!text) return none;
  const t = text.replace(/,/g, '');
  const cur = /₹|\binr\b|lpa|lakh/i.test(t) ? 'INR' : /€|\beur\b/i.test(t) ? 'EUR' : /£|\bgbp\b/i.test(t) ? 'GBP' : /\$|\busd\b/i.test(t) ? 'USD' : null;
  if (/lpa|lakh/i.test(t)) {
    const m = /(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lakh)/i.exec(t) ?? /(\d+(?:\.\d+)?)\s*(?:lpa|lakh)/i.exec(t);
    if (!m) return none;
    return { min: Number(m[1]) * 100_000, max: m[2] ? Number(m[2]) * 100_000 : null, currency: 'INR', period: 'YEAR' };
  }
  const num = '(\\d+(?:\\.\\d+)?)\\s*(k)?';
  const m = new RegExp(`[$€£₹]?\\s*${num}\\s*(?:-|–|to)\\s*[$€£₹]?\\s*${num}`, 'i').exec(t) ?? new RegExp(`[$€£₹]\\s*${num}`, 'i').exec(t);
  if (!m) return none;
  const val = (n?: string, k?: string) => (n ? Number(n) * (k ? 1000 : 1) : null);
  const min = val(m[1], m[2]);
  const max = m.length > 3 ? val(m[3], m[4]) : null;
  const period: SalaryPeriod = /hour|\/hr|per hr|hourly/i.test(t) ? 'HOUR' : /month|\/mo\b|monthly/i.test(t) ? 'MONTH' : 'YEAR';
  if (min != null && min < 100 && period === 'YEAR' && !m[2]) return none; // probably not a salary
  return { min, max, currency: cur, period };
}

export function annualize(amount: number, period: SalaryPeriod | null): number {
  if (period === 'HOUR') return amount * 2080;
  if (period === 'MONTH') return amount * 12;
  return amount;
}

const OPTIONAL_HEADINGS = /(nice to have|nice-to-have|preferred|bonus|good to have|plus|desirable|optional)/i;
const REQUIRED_HEADINGS = /(requirements|required|must have|must-have|qualifications|what you('|’)ll need|you have|skills)/i;

/** Split detected skills into required vs optional based on the section they appear in. */
export function extractSkills(description: string, title = ''): { skills: string[]; required: string[]; optional: string[] } {
  const lines = description.split('\n');
  let mode: 'required' | 'optional' | 'neutral' = 'neutral';
  const req = new Set<string>();
  const opt = new Set<string>();
  const neutral = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 60 && OPTIONAL_HEADINGS.test(trimmed)) mode = 'optional';
    else if (trimmed.length < 60 && REQUIRED_HEADINGS.test(trimmed)) mode = 'required';
    const inline = OPTIONAL_HEADINGS.test(trimmed) && trimmed.length >= 60 ? 'optional' : mode;
    for (const s of detectSkillsInText(trimmed)) {
      (inline === 'required' ? req : inline === 'optional' ? opt : neutral).add(s.name);
    }
  }
  for (const s of detectSkillsInText(title)) req.add(s.name);
  // Skills mentioned outside explicit sections count as required unless they are only "nice to have".
  for (const s of neutral) if (!opt.has(s)) req.add(s);
  for (const s of req) opt.delete(s);
  return { skills: [...new Set([...req, ...opt])], required: [...req], optional: [...opt] };
}

/** Enrich a partially-normalized job with derived fields (skills, experience, mode, type). */
export function enrichJob(job: NormalizedJob): NormalizedJob {
  const desc = job.description;
  const out = { ...job };
  if (!out.skills.length) {
    const s = extractSkills(desc, job.title);
    out.skills = s.skills;
    out.requiredSkills = s.required;
    out.optionalSkills = s.optional;
  } else {
    out.skills = [...new Set(out.skills.map((s) => canonicalizeSkill(s).name))];
    if (!out.requiredSkills.length && !out.optionalSkills.length) out.requiredSkills = out.skills;
  }
  if (out.experienceMinYears == null && out.experienceMaxYears == null) {
    const r = extractExperienceRange(desc);
    out.experienceMinYears = r.min;
    out.experienceMaxYears = r.max;
  }
  out.workMode ??= detectWorkMode(job.location, job.title, desc.slice(0, 1500));
  out.employmentType ??= detectEmploymentType(job.title, desc.slice(0, 1500));
  if (out.salaryMin == null && out.salaryMax == null) {
    const salLine = desc.split('\n').find((l) => /salary|compensation|pay range|ctc|lpa|\$\d|€\d|£\d|₹\d/i.test(l));
    const s = parseSalary(salLine);
    if (s.min != null) Object.assign(out, { salaryMin: s.min, salaryMax: s.max, salaryCurrency: s.currency, salaryPeriod: s.period });
  }
  return out;
}

/**
 * Stable fingerprint for a logical job: the same posting syndicated on several
 * platforms collapses to one job with multiple job_sources.
 */
export function jobFingerprint(job: Pick<NormalizedJob, 'company' | 'title' | 'location' | 'city' | 'workMode'>): string {
  const loc = job.workMode === 'REMOTE' ? 'remote' : normalizeWhitespace((job.city ?? job.location ?? '').toLowerCase().split(',')[0] ?? '');
  const key = `${normalizeCompany(job.company)}|${normalizeTitle(job.title)}|${loc}`;
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 40);
}

function shingles(text: string, k = 5): string[] {
  const t = tokenize(text).slice(0, 400);
  const out: string[] = [];
  for (let i = 0; i + k <= t.length; i++) out.push(t.slice(i, i + k).join(' '));
  return out;
}

export interface DuplicateCandidate {
  id: string;
  company: string;
  title: string;
  description: string;
  location: string | null;
}

/**
 * Fuzzy duplicate detection for postings whose fingerprints differ slightly
 * (e.g. "Sr. Backend Engineer" vs "Senior Backend Engineer - Remote").
 */
export function findDuplicate(job: Pick<NormalizedJob, 'company' | 'title' | 'description' | 'location'>, existing: DuplicateCandidate[]): { id: string; similarity: number } | null {
  const company = normalizeCompany(job.company);
  const titleTokens = tokenize(normalizeTitle(job.title));
  const sh = shingles(job.description);
  let best: { id: string; similarity: number } | null = null;
  for (const e of existing) {
    if (normalizeCompany(e.company) !== company) continue;
    const ts = jaccard(titleTokens, tokenize(normalizeTitle(e.title)));
    if (ts < 0.6) continue;
    const ds = sh.length && e.description ? jaccard(sh, shingles(e.description)) : ts >= 0.99 ? 1 : 0;
    const sim = 0.5 * ts + 0.5 * ds;
    if ((ts >= 0.99 && (ds >= 0.5 || !sh.length)) || sim >= 0.8) {
      if (!best || sim > best.similarity) best = { id: e.id, similarity: Math.round(sim * 100) / 100 };
    }
  }
  return best;
}
