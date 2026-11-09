import { canonicalizeSkill, detectSkillsInText, emptyExtractedResume, type ExtractedResume } from '@autoapply/shared';

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', sept: '09', oct: '10', nov: '11', dec: '12',
};

const MONTH_RE = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATE_TOKEN = `(?:${MONTH_RE}\\.?\\s+\\d{4}|\\d{1,2}[/.-]\\d{4}|\\d{4})`;
const END_TOKEN = `(?:${DATE_TOKEN}|present|current|now|till date|today)`;
export const DATE_RANGE_RE = new RegExp(`(${DATE_TOKEN})\\s*(?:-|–|—|to|until)\\s*(${END_TOKEN})`, 'i');

export function parseResumeDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase().replace(/\./g, '');
  if (/^(present|current|now|till date|today)$/.test(s)) return 'present';
  let m = new RegExp(`^(${MONTH_RE})\\s+(\\d{4})$`).exec(s);
  if (m) return `${m[2]}-${MONTHS[m[1]!.slice(0, m[1]!.startsWith('sept') ? 4 : 3)] ?? MONTHS[m[1]!.slice(0, 3)]}`;
  m = /^(\d{1,2})[/-](\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  m = /^(\d{4})$/.exec(s);
  if (m) return m[1]!;
  return null;
}

function toMonthIndex(d: string, now: Date, isEnd: boolean): number | null {
  if (d === 'present') return now.getUTCFullYear() * 12 + now.getUTCMonth();
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(d);
  if (!m) return null;
  const month = m[2] ? Number(m[2]) - 1 : isEnd ? 11 : 0;
  return Number(m[1]) * 12 + month;
}

/** Total months of experience, merging overlapping roles. Deterministic, never guessed. */
export function computeExperienceMonths(exps: { startDate: string | null; endDate: string | null; isCurrent?: boolean }[], now = new Date()): number | null {
  const intervals: [number, number][] = [];
  for (const e of exps) {
    if (!e.startDate) continue;
    const s = toMonthIndex(e.startDate, now, false);
    const end = toMonthIndex(e.endDate ?? (e.isCurrent ? 'present' : ''), now, true);
    if (s == null || end == null || end < s) continue;
    intervals.push([s, end + 1]);
  }
  if (!intervals.length) return null;
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = intervals[0]!;
  for (const [s, e] of intervals.slice(1)) {
    if (s <= ce) ce = Math.max(ce, e);
    else {
      total += ce - cs;
      cs = s;
      ce = e;
    }
  }
  total += ce - cs;
  return total;
}

const SECTION_ALIASES: Record<string, string[]> = {
  summary: ['summary', 'professional summary', 'profile', 'about me', 'objective', 'career objective'],
  experience: ['experience', 'work experience', 'professional experience', 'employment history', 'work history', 'employment'],
  education: ['education', 'academic background', 'academics', 'qualifications', 'education and training'],
  skills: ['skills', 'technical skills', 'core skills', 'key skills', 'skills and tools', 'competencies', 'technologies'],
  certifications: ['certifications', 'certificates', 'licenses and certifications', 'certification'],
  projects: ['projects', 'personal projects', 'key projects', 'academic projects'],
  achievements: ['achievements', 'awards', 'honors', 'accomplishments', 'awards and achievements'],
};

function sectionOf(line: string): string | null {
  const l = line.trim().toLowerCase().replace(/[:|]+$/, '').replace(/\s+/g, ' ');
  if (l.length > 40) return null;
  for (const [k, aliases] of Object.entries(SECTION_ALIASES)) if (aliases.includes(l)) return k;
  return null;
}

const TITLE_WORDS = /\b(engineer|developer|manager|architect|analyst|consultant|lead|intern|designer|scientist|administrator|specialist|director|officer|associate|programmer|tester|devops|sre|head|vp|executive)\b/i;
const DEGREE_RE = /\b(b\.?\s?tech|m\.?\s?tech|b\.?\s?e\b|m\.?\s?e\b|b\.?\s?sc|m\.?\s?sc|bachelor(?:'s)?|master(?:'s)?|ph\.?\s?d|mba|bca|mca|b\.?\s?com|m\.?\s?s\b|b\.?\s?s\b|diploma|associate degree|high school|hsc|ssc)\b[^,]*/i;

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,5}\)?[\s.-]?)\d{3,5}[\s.-]?\d{3,5}/;

/**
 * Deterministic resume parser. Used (a) as the fallback when no AI provider is
 * configured or AI fails, and (b) as a cross-check signal for AI output.
 * It only reports values literally present in the text.
 */
export class HeuristicResumeParser {
  parse(text: string, pageOf?: (snippet: string) => number | null): ExtractedResume {
    const r = emptyExtractedResume();
    const conf: Record<string, number> = {};
    const lines = text.split('\n').map((l) => l.trim());

    const email = EMAIL_RE.exec(text)?.[0] ?? null;
    if (email) {
      r.email = email.toLowerCase();
      conf.email = 0.95;
    }
    const phoneCandidate = text
      .split('\n')
      .map((l) => PHONE_RE.exec(l.replace(EMAIL_RE, ' '))?.[0])
      .find((p) => p && p.replace(/\D/g, '').length >= 10 && p.replace(/\D/g, '').length <= 15 && !/^\d{4}\s*[-–]\s*\d{4}$/.test(p.trim()));
    if (phoneCandidate) {
      r.phone = phoneCandidate.trim();
      conf.phone = 0.9;
    }

    const urls = [...text.matchAll(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s|,;)]*)?/gi)].map((m) => m[0]).filter((u) => !EMAIL_RE.test(u) && /\.[a-z]{2,}/i.test(u) && !/^\d/.test(u));
    for (const u of urls) {
      const lu = u.toLowerCase();
      if (lu.includes('linkedin.com/')) r.links.linkedin ??= u;
      else if (lu.includes('github.com/')) r.links.github ??= u;
      else if (/(portfolio|\.dev\b|\.io\b|behance|dribbble|medium\.com)/.test(lu) && !r.links.portfolio) r.links.portfolio = u;
      else if (/\//.test(lu) || /^www\./.test(lu)) r.links.other.push(u);
    }
    if (r.links.linkedin) conf['links.linkedin'] = 0.9;
    if (r.links.github) conf['links.github'] = 0.9;

    // Name: first short, alphabetic line before any section header.
    for (const l of lines.slice(0, 8)) {
      if (!l || sectionOf(l)) continue;
      if (EMAIL_RE.test(l) || /\d/.test(l) || l.includes('|')) continue;
      const words = l.split(/\s+/);
      if (words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-z][A-Za-z.'-]*$/.test(w)) && !TITLE_WORDS.test(l)) {
        r.fullName = l;
        conf.fullName = 0.7;
        break;
      }
    }

    // Location: a "City, Country"-like segment on the contact lines.
    for (const l of lines.slice(0, 10)) {
      for (const seg of l.split(/[|•·]/).map((s) => s.trim())) {
        if (/^[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+$/.test(seg) && !EMAIL_RE.test(seg) && !TITLE_WORDS.test(seg) && seg.length < 60) {
          r.location = seg;
          conf.location = 0.6;
          break;
        }
      }
      if (r.location) break;
    }

    // Split into sections.
    const sections: Record<string, string[]> = {};
    let current = 'header';
    for (const l of lines) {
      const s = sectionOf(l);
      if (s) {
        current = s;
        sections[s] ??= [];
        continue;
      }
      (sections[current] ??= []).push(l);
    }

    if (sections.summary?.length) {
      r.summary = sections.summary.filter(Boolean).join(' ').slice(0, 5000) || null;
      if (r.summary) conf.summary = 0.7;
    }

    // Experience
    const expLines = sections.experience ?? [];
    for (let i = 0; i < expLines.length; i++) {
      const line = expLines[i]!;
      const m = DATE_RANGE_RE.exec(line);
      if (!m) continue;
      let head = line.slice(0, m.index).replace(/[\s,|–—-]+$/, '').trim();
      if (!head && i > 0) head = expLines[i - 1]!.trim();
      const { title, company } = splitTitleCompany(head);
      const descr: string[] = [];
      for (let j = i + 1; j < expLines.length && !DATE_RANGE_RE.test(expLines[j]!); j++) {
        if (expLines[j]) descr.push(expLines[j]!.replace(/^[•·*-]\s*/, ''));
      }
      const endDate = parseResumeDate(m[2]);
      const idx = r.experiences.length;
      r.experiences.push({
        company,
        title,
        location: null,
        startDate: parseResumeDate(m[1]),
        endDate,
        isCurrent: endDate === 'present',
        description: descr.join('\n') || null,
        sourcePage: pageOf?.(head) ?? null,
      });
      conf[`experiences.${idx}`] = title && company ? 0.65 : 0.4;
    }
    const current0 = r.experiences.find((e) => e.isCurrent) ?? r.experiences[0];
    const headerTitle = (sections.header ?? []).slice(0, 4).find((l) => TITLE_WORDS.test(l) && !EMAIL_RE.test(l) && l.split(/\s+/).length <= 6);
    r.currentTitle = current0?.title ?? headerTitle ?? null;
    if (r.currentTitle) conf.currentTitle = current0?.title ? 0.65 : 0.5;
    r.previousTitles = [...new Set(r.experiences.filter((e) => e !== current0 && e.title).map((e) => e.title!))];
    r.totalExperienceMonths = computeExperienceMonths(r.experiences);
    if (r.totalExperienceMonths != null) conf.totalExperienceMonths = 0.6;

    // Skills: explicit section + taxonomy matches across the whole document.
    const explicit = (sections.skills ?? [])
      .join(',')
      .split(/[,|•·;]|\s{2,}/)
      .map((s) => s.replace(/^[A-Za-z ]{2,30}:\s*/, '').trim())
      .filter((s) => s.length > 0 && s.length <= 40);
    const all = new Map<string, string>();
    for (const s of explicit) {
      const c = canonicalizeSkill(s);
      all.set(c.name, c.known ? c.category : 'TECHNICAL');
    }
    for (const s of detectSkillsInText(text)) all.set(s.name, s.category);
    for (const [name, category] of all) {
      const bucket =
        category === 'PROGRAMMING_LANGUAGE' ? 'programmingLanguages' : category === 'FRAMEWORK' ? 'frameworks' : category === 'DATABASE' ? 'databases' : category === 'CLOUD' ? 'cloud' : category === 'TOOL' ? 'tools' : category === 'SOFT' ? 'soft' : 'technical';
      r.skills[bucket].push(name);
    }
    if (all.size) conf.skills = 0.75;

    // Education
    for (const l of sections.education ?? []) {
      if (!l) continue;
      const deg = DEGREE_RE.exec(l);
      const years = [...l.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => m[0]);
      if (!deg && !years.length) continue;
      const withoutDates = l.replace(DATE_RANGE_RE, '').replace(/\b(19|20)\d{2}\b/g, '').replace(/[\s,–—-]+$/, '').trim();
      const parts = withoutDates.split(/,|\s+[|–—]\s+/).map((s) => s.trim()).filter(Boolean);
      const degreePart = parts.find((p) => DEGREE_RE.test(p)) ?? null;
      const inst = parts.find((p) => p !== degreePart && /(university|college|institute|school|academy|iit|nit|vit|bits)/i.test(p)) ?? parts.find((p) => p !== degreePart) ?? null;
      const fieldM = degreePart ? /\b(?:in|of)\s+(.+)$/i.exec(degreePart) : null;
      const idx = r.education.length;
      r.education.push({
        institution: inst,
        degree: degreePart ? degreePart.replace(/\s+(?:in|of)\s+.+$/i, '').trim() : null,
        field: fieldM?.[1]?.trim() ?? null,
        startDate: years.length > 1 ? years[0]! : null,
        endDate: years.length ? years[years.length - 1]! : null,
        grade: /(?:cgpa|gpa|percentage)[:\s]*([\d.]+%?)/i.exec(l)?.[1] ?? null,
        sourcePage: pageOf?.(l) ?? null,
      });
      conf[`education.${idx}`] = 0.6;
    }

    for (const l of sections.certifications ?? []) {
      if (!l || l.length < 4) continue;
      const year = /\((\d{4})\)|\b(20\d{2}|19\d{2})\b/.exec(l);
      r.certifications.push({ name: l.replace(/\(\d{4}\)/, '').replace(/^[•·*-]\s*/, '').trim(), issuer: null, date: year ? (year[1] ?? year[2])! : null });
    }
    for (const l of sections.projects ?? []) {
      if (!l || l.length < 4) continue;
      const [name, ...rest] = l.replace(/^[•·*-]\s*/, '').split(/\s+[-–—:]\s+/);
      r.projects.push({ name: name!.trim().slice(0, 300), description: rest.join(' - ') || null, technologies: detectSkillsInText(l).map((s) => s.name), url: null });
    }
    for (const l of sections.achievements ?? []) if (l) r.achievements.push(l.replace(/^[•·*-]\s*/, ''));

    r.confidence = conf;
    return r;
  }
}

export function splitTitleCompany(head: string): { title: string | null; company: string | null } {
  if (!head) return { title: null, company: null };
  const at = /^(.+?)\s+(?:at|@)\s+(.+)$/i.exec(head);
  if (at) return { title: at[1]!.trim(), company: at[2]!.trim() };
  const parts = head.split(/\s*(?:,|\||–|—|\s-\s)\s*/).filter(Boolean);
  if (parts.length >= 2) {
    const ti = parts.findIndex((p) => TITLE_WORDS.test(p));
    if (ti >= 0) {
      const company = parts.find((_, i) => i !== ti) ?? null;
      return { title: parts[ti]!.trim(), company: company?.trim() ?? null };
    }
    return { title: parts[0]!.trim(), company: parts[1]!.trim() };
  }
  return TITLE_WORDS.test(head) ? { title: head, company: null } : { title: null, company: head };
}
