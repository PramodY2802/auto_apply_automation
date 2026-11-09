import { canonicalizeSkill, extractedResumeSchema, normalizeSkillKey, type ExtractedResume } from '@autoapply/shared';
import { computeExperienceMonths } from './heuristic-parser';

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9+#@.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return norm(s)
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length > 1 || /[a-z0-9]/.test(t));
}

export interface ValidationOutcome {
  resume: ExtractedResume;
  fieldConfidence: Record<string, number>;
  warnings: string[];
}

/**
 * StructuredDataValidator — enforces the extraction contract:
 *  1. Schema validation (zod).
 *  2. Grounding: every extracted value must be traceable to the source text.
 *     Ungrounded qualifications (employers, education, certifications, skills)
 *     are REMOVED; ungrounded identity fields are nulled. Nothing is invented.
 *  3. Derived values (total experience) are recomputed deterministically.
 */
export class StructuredDataValidator {
  validate(input: unknown, sourceText: string): ValidationOutcome {
    const parsed = extractedResumeSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(`Extraction failed schema validation: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    }
    const r: ExtractedResume = structuredClone(parsed.data);
    const warnings: string[] = [];
    const textNorm = norm(sourceText);
    const textTokens = new Set(tokens(sourceText));
    const textDigits = sourceText.replace(/\D/g, '');
    const conf: Record<string, number> = { ...r.confidence };

    const grounding = (value: string): number => {
      const tk = tokens(value);
      if (!tk.length) return 0;
      if (textNorm.includes(norm(value))) return 1;
      return tk.filter((t) => textTokens.has(t)).length / tk.length;
    };
    const setConf = (k: string, g: number, base = 0.85) => {
      conf[k] = Math.round(Math.min(conf[k] ?? base, base) * (g >= 0.999 ? 1 : g) * 100) / 100;
    };

    // Identity fields
    for (const key of ['fullName', 'location', 'currentTitle'] as const) {
      const v = r[key];
      if (!v) continue;
      const g = grounding(v);
      if (g < 0.5) {
        warnings.push(`${key} "${v}" was not found in the document and was removed`);
        r[key] = null;
        delete conf[key];
      } else setConf(key, g);
    }
    if (r.summary) {
      const g = grounding(r.summary);
      if (g < 0.6) {
        warnings.push('Summary was not present in the resume text and was removed (summaries are never generated)');
        r.summary = null;
        delete conf.summary;
      } else setConf('summary', g, 0.8);
    }
    if (r.email) {
      if (!textNorm.includes(r.email.toLowerCase())) {
        warnings.push('Email not found verbatim in document; removed');
        r.email = null;
      } else conf.email = Math.max(conf.email ?? 0, 0.95);
    }
    if (r.phone) {
      const digits = r.phone.replace(/\D/g, '');
      if (digits.length < 7 || !textDigits.includes(digits.slice(-7))) {
        warnings.push('Phone number not found in document; removed');
        r.phone = null;
      } else conf.phone = Math.max(conf.phone ?? 0, 0.9);
    }

    // Links must literally appear in the document.
    const linkOk = (u: string | null) => !!u && textNorm.includes(norm(u.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')));
    for (const k of ['linkedin', 'github', 'portfolio'] as const) {
      if (r.links[k] && !linkOk(r.links[k])) {
        warnings.push(`${k} link not found in document; removed`);
        r.links[k] = null;
      }
    }
    r.links.other = r.links.other.filter((u) => linkOk(u));

    // Experience: drop entries with no grounded employer AND title.
    r.experiences = r.experiences.filter((e, i) => {
      const gc = e.company ? grounding(e.company) : 0;
      const gt = e.title ? grounding(e.title) : 0;
      if (gc < 0.6 && gt < 0.6) {
        warnings.push(`Experience entry "${e.title ?? '?'} @ ${e.company ?? '?'}" not found in document; removed`);
        return false;
      }
      if (e.company && gc < 0.6) e.company = null;
      if (e.title && gt < 0.6) e.title = null;
      conf[`experiences.${i}`] = Math.round(Math.min(conf[`experiences.${i}`] ?? 0.8, 0.8) * Math.max(gc, gt) * 100) / 100;
      return true;
    });
    r.previousTitles = r.previousTitles.filter((t) => grounding(t) >= 0.6);

    r.education = r.education.filter((e) => {
      const g = Math.max(e.institution ? grounding(e.institution) : 0, e.degree ? grounding(e.degree) : 0);
      if (g < 0.6) {
        warnings.push(`Education entry "${e.degree ?? ''} ${e.institution ?? ''}" not found in document; removed`);
        return false;
      }
      return true;
    });

    r.certifications = r.certifications.filter((c) => {
      const ok = grounding(c.name) >= 0.75;
      if (!ok) warnings.push(`Certification "${c.name}" not found in document; removed`);
      return ok;
    });
    r.projects = r.projects.filter((p) => grounding(p.name) >= 0.6);
    r.achievements = r.achievements.filter((a) => grounding(a) >= 0.6);

    // Skills: keep only skills (or a known alias) that appear in the text.
    const skillGrounded = (s: string) => {
      if (grounding(s) >= 0.99) return true;
      const c = canonicalizeSkill(s);
      return textNorm.includes(normalizeSkillKey(c.name)) || textNorm.includes(norm(s));
    };
    const removed: string[] = [];
    for (const bucket of Object.keys(r.skills) as (keyof ExtractedResume['skills'])[]) {
      const seen = new Set<string>();
      r.skills[bucket] = r.skills[bucket].filter((s) => {
        const k = normalizeSkillKey(s);
        if (seen.has(k)) return false;
        seen.add(k);
        if (!skillGrounded(s)) {
          removed.push(s);
          return false;
        }
        return true;
      });
    }
    if (removed.length) warnings.push(`Skills not found in document were removed: ${removed.slice(0, 15).join(', ')}`);

    // Derived total experience — recompute from dates, never trust a guess.
    const computed = computeExperienceMonths(r.experiences);
    if (computed != null) {
      if (r.totalExperienceMonths != null && Math.abs(r.totalExperienceMonths - computed) > 12) {
        warnings.push(`Total experience adjusted from ${r.totalExperienceMonths} to ${computed} months based on listed dates`);
      }
      r.totalExperienceMonths = computed;
      conf.totalExperienceMonths = 0.7;
    } else if (r.totalExperienceMonths != null) {
      const years = Math.round(r.totalExperienceMonths / 12);
      if (!new RegExp(`\\b${years}\\+?\\s*(years|yrs)`, 'i').test(sourceText)) {
        warnings.push('Total experience could not be verified from the document and was removed');
        r.totalExperienceMonths = null;
      } else conf.totalExperienceMonths = 0.6;
    }

    // Drop confidences for paths that no longer exist.
    for (const k of Object.keys(conf)) {
      const [root, idx] = k.split('.');
      if (idx && /^\d+$/.test(idx) && Array.isArray((r as any)[root!]) && Number(idx) >= (r as any)[root!].length) delete conf[k];
    }
    r.confidence = conf;
    return { resume: r, fieldConfidence: conf, warnings };
  }
}
