import type { CandidateContext } from '@autoapply/answer-engine';
import {
  and,
  asc,
  candidateEducation,
  candidateExperiences,
  candidatePreferences,
  candidateProfiles,
  candidateSkills,
  eq,
  isNull,
  resumes,
  savedAnswers,
  type Database,
  type DbExecutor,
} from '@autoapply/database';
import type { MatchCandidate, MatchPreferences } from '@autoapply/matching-engine';
import {
  answerPreferencesSchema,
  canonicalizeSkill,
  EXPERIENCE_BANDS,
  type CandidateProfileUpdate,
  type PreferencesInput,
} from '@autoapply/shared';
import { DomainError } from './platform';

export class ProfileService {
  constructor(private readonly db: Database) {}

  async getOrCreate(userId: string, enterpriseId: string | null, tx: DbExecutor = this.db) {
    const [p] = await tx.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId));
    if (p) return p;
    const [created] = await tx.insert(candidateProfiles).values({ userId, enterpriseId }).onConflictDoNothing().returning();
    if (created) return created;
    const [again] = await tx.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId));
    return again!;
  }

  async getFull(userId: string) {
    const [profile] = await this.db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId));
    if (!profile) return null;
    const [experiences, education, skills] = await Promise.all([
      this.db.select().from(candidateExperiences).where(eq(candidateExperiences.profileId, profile.id)).orderBy(asc(candidateExperiences.sortOrder)),
      this.db.select().from(candidateEducation).where(eq(candidateEducation.profileId, profile.id)).orderBy(asc(candidateEducation.sortOrder)),
      this.db.select().from(candidateSkills).where(eq(candidateSkills.profileId, profile.id)).orderBy(asc(candidateSkills.name)),
    ]);
    return { ...profile, experiences, education, skills };
  }

  /**
   * Applies a profile update. Collections that are provided replace the stored
   * ones (the review screen always submits the full edited list).
   */
  async update(userId: string, enterpriseId: string | null, u: CandidateProfileUpdate & { sourceResumeId?: string; fieldConfidence?: Record<string, number> }, skillSource = 'USER') {
    return this.db.transaction(async (tx) => {
      const profile = await this.getOrCreate(userId, enterpriseId, tx);
      const patch: Partial<typeof candidateProfiles.$inferInsert> = {};
      for (const k of ['fullName', 'email', 'phone', 'location', 'headline', 'summary', 'currentTitle', 'totalExperienceMonths'] as const) {
        if (u[k] !== undefined) (patch as any)[k] = u[k];
      }
      if (u.links) patch.links = { ...profile.links, ...u.links };
      if (u.certifications || u.projects || u.achievements) {
        patch.extras = {
          ...profile.extras,
          ...(u.certifications ? { certifications: u.certifications } : {}),
          ...(u.projects ? { projects: u.projects } : {}),
          ...(u.achievements ? { achievements: u.achievements } : {}),
        };
      }
      if (u.experiences) {
        patch.extras = { ...(patch.extras ?? profile.extras), previousTitles: [...new Set(u.experiences.filter((e) => !e.isCurrent && e.title).map((e) => e.title!))] };
      }
      if (u.sourceResumeId) patch.sourceResumeId = u.sourceResumeId;
      if (u.fieldConfidence) patch.fieldConfidence = u.fieldConfidence;
      if (u.markReviewed) patch.reviewedAt = new Date();
      if (Object.keys(patch).length) await tx.update(candidateProfiles).set(patch).where(eq(candidateProfiles.id, profile.id));

      if (u.experiences) {
        await tx.delete(candidateExperiences).where(eq(candidateExperiences.profileId, profile.id));
        if (u.experiences.length) {
          await tx.insert(candidateExperiences).values(
            u.experiences.map((e, i) => ({ profileId: profile.id, company: e.company, title: e.title, location: e.location ?? null, startDate: e.startDate ?? null, endDate: e.endDate ?? null, isCurrent: e.isCurrent, description: e.description ?? null, sourcePage: e.sourcePage ?? null, sortOrder: i })),
          );
        }
      }
      if (u.education) {
        await tx.delete(candidateEducation).where(eq(candidateEducation.profileId, profile.id));
        if (u.education.length) {
          await tx.insert(candidateEducation).values(
            u.education.map((e, i) => ({ profileId: profile.id, institution: e.institution, degree: e.degree ?? null, field: e.field ?? null, startDate: e.startDate ?? null, endDate: e.endDate ?? null, grade: e.grade ?? null, sourcePage: e.sourcePage ?? null, sortOrder: i })),
          );
        }
      }
      if (u.skills) {
        await tx.delete(candidateSkills).where(eq(candidateSkills.profileId, profile.id));
        const seen = new Set<string>();
        const rows = [];
        for (const s of u.skills) {
          const c = canonicalizeSkill(s.name);
          if (seen.has(c.key)) continue;
          seen.add(c.key);
          rows.push({ profileId: profile.id, name: c.name, normalizedName: c.key, category: s.category, years: s.years ?? null, source: skillSource, confidence: u.fieldConfidence?.skills ?? null });
        }
        if (rows.length) await tx.insert(candidateSkills).values(rows);
      }
      return profile.id;
    });
  }

  async getPreferences(userId: string) {
    const [p] = await this.db.select().from(candidatePreferences).where(eq(candidatePreferences.userId, userId));
    return p ?? null;
  }

  async savePreferences(userId: string, input: PreferencesInput) {
    let min = input.experienceMinYears;
    let max = input.experienceMaxYears;
    if (input.experienceBand !== 'CUSTOM') [min, max] = EXPERIENCE_BANDS[input.experienceBand] as unknown as [number, number];
    const freqHours = { MANUAL: null, DAILY: 24, TWICE_DAILY: 12, WEEKLY: 168 }[input.searchFrequency];
    const values = {
      userId,
      titles: input.titles,
      experienceBand: input.experienceBand,
      experienceMinYears: min,
      experienceMaxYears: max,
      locations: input.locations,
      workModes: input.workModes,
      employmentTypes: input.employmentTypes,
      salaryMin: input.salaryMin,
      salaryMax: input.salaryMax,
      salaryCurrency: input.salaryCurrency,
      salaryPeriod: input.salaryPeriod,
      industries: input.industries,
      preferredCompanies: input.preferredCompanies,
      excludedCompanies: input.excludedCompanies,
      noticePeriodDays: input.noticePeriodDays,
      keywords: input.keywords,
      maxPostingAgeDays: input.maxPostingAgeDays,
      searchFrequency: input.searchFrequency,
      platforms: input.platforms,
      applicationMode: input.applicationMode,
      autoApplyMinScore: input.autoApplyMinScore,
      dailyApplicationLimit: input.dailyApplicationLimit,
      autoApplyConsentAt: input.autoApplyConsent ? new Date() : null,
      answerPreferences: input.answerPreferences,
      nextSearchAt: freqHours ? new Date(Date.now() + 5 * 60_000) : null,
    };
    const existing = await this.getPreferences(userId);
    if (existing?.autoApplyConsentAt && input.autoApplyConsent) values.autoApplyConsentAt = existing.autoApplyConsentAt;
    const [row] = await this.db.insert(candidatePreferences).values(values).onConflictDoUpdate({ target: candidatePreferences.userId, set: { ...values, updatedAt: new Date() } }).returning();
    return row!;
  }

  async matchInputs(userId: string): Promise<{ candidate: MatchCandidate; prefs: MatchPreferences } | null> {
    const [full, prefs] = await Promise.all([this.getFull(userId), this.getPreferences(userId)]);
    if (!prefs) return null;
    return {
      candidate: {
        skills: (full?.skills ?? []).map((s) => ({ name: s.name, years: s.years })),
        totalExperienceMonths: full?.totalExperienceMonths ?? null,
        titles: [full?.currentTitle, ...(full?.extras.previousTitles ?? [])].filter((t): t is string => !!t),
      },
      prefs: {
        titles: prefs.titles,
        experienceMinYears: prefs.experienceMinYears,
        experienceMaxYears: prefs.experienceMaxYears,
        locations: prefs.locations,
        workModes: prefs.workModes as MatchPreferences['workModes'],
        employmentTypes: prefs.employmentTypes as MatchPreferences['employmentTypes'],
        salaryMin: prefs.salaryMin,
        salaryMax: prefs.salaryMax,
        salaryCurrency: prefs.salaryCurrency,
        salaryPeriod: prefs.salaryPeriod,
        preferredCompanies: prefs.preferredCompanies,
        excludedCompanies: prefs.excludedCompanies,
        keywords: prefs.keywords,
        maxPostingAgeDays: prefs.maxPostingAgeDays,
      },
    };
  }

  /** Candidate fact sheet for answer generation (only stored, user-reviewable data). */
  async candidateContext(userId: string, resumeAvailable: boolean): Promise<CandidateContext> {
    const full = await this.getFull(userId);
    if (!full) throw new DomainError('PRECONDITION', 'Complete your candidate profile before applying');
    const prefs = await this.getPreferences(userId);
    const saved = await this.db.select().from(savedAnswers).where(eq(savedAnswers.userId, userId));
    return {
      fullName: full.fullName,
      email: full.email,
      phone: full.phone,
      location: full.location,
      currentTitle: full.currentTitle,
      summary: full.summary,
      totalExperienceMonths: full.totalExperienceMonths,
      links: full.links,
      skills: full.skills.map((s) => ({ name: s.name, years: s.years })),
      experiences: full.experiences.map((e) => ({ company: e.company, title: e.title, startDate: e.startDate, endDate: e.endDate, isCurrent: e.isCurrent, description: e.description })),
      education: full.education.map((e) => ({ institution: e.institution, degree: e.degree, field: e.field, endDate: e.endDate })),
      projects: full.extras.projects.map((p) => ({ name: p.name, description: p.description ?? null })),
      certifications: full.extras.certifications.map((c) => ({ name: c.name })),
      preferences: {
        salaryMin: prefs?.salaryMin ?? null,
        salaryMax: prefs?.salaryMax ?? null,
        salaryCurrency: prefs?.salaryCurrency ?? 'USD',
        salaryPeriod: prefs?.salaryPeriod ?? 'YEAR',
        noticePeriodDays: prefs?.noticePeriodDays ?? null,
        answer: answerPreferencesSchema.parse(prefs?.answerPreferences ?? {}),
      },
      savedAnswers: saved.map((s) => ({ questionKey: s.questionKey, question: s.question, intent: s.intent, answer: s.answer })),
      resumeFileAvailable: resumeAvailable,
    };
  }

  async primaryResume(userId: string) {
    const rows = await this.db.select().from(resumes).where(and(eq(resumes.userId, userId), isNull(resumes.deletedAt))).orderBy(asc(resumes.createdAt));
    return rows.find((r) => r.isPrimary) ?? rows[rows.length - 1] ?? null;
  }
}
