import { z } from 'zod';
import {
  AI_CONFIG_SCOPES,
  AI_PROVIDER_KEYS,
  AI_TASKS,
  APPLICATION_MODES,
  APPLICATION_STATUSES,
  BILLING_INTERVALS,
  EMPLOYMENT_TYPES,
  ENTERPRISE_ROLES,
  PLATFORM_KEYS,
  PLATFORM_ROLES,
  QUESTION_INTENTS,
  QUESTION_TYPES,
  SALARY_PERIODS,
  SEARCH_FREQUENCIES,
  SKILL_CATEGORIES,
  WORK_MODES,
} from './enums';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(120),
  accountType: z.enum(['INDIVIDUAL', 'ENTERPRISE']).default('INDIVIDUAL'),
  enterpriseName: z.string().trim().min(2).max(120).optional(),
  invitationToken: z.string().min(10).max(200).optional(),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const requestPasswordResetSchema = z.object({ email: z.string().trim().toLowerCase().email() });
export const resetPasswordSchema = z.object({ token: z.string().min(10).max(200), password: passwordSchema });
export const verifyEmailSchema = z.object({ token: z.string().min(10).max(200) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema });
export const updateAccountSchema = z.object({ fullName: z.string().trim().min(1).max(120) });

// ---------------------------------------------------------------------------
// Resume extraction (structured output contract for AI + validator)
// ---------------------------------------------------------------------------
const nullableStr = z.string().trim().min(1).max(2000).nullable();
/** YYYY or YYYY-MM, or the literal "present". */
export const resumeDateSchema = z
  .string()
  .regex(/^(\d{4}(-(0[1-9]|1[0-2]))?|present)$/i, 'Expected YYYY, YYYY-MM or "present"')
  .nullable();

export const extractedExperienceSchema = z.object({
  company: nullableStr,
  title: nullableStr,
  location: nullableStr.optional().default(null),
  startDate: resumeDateSchema.optional().default(null),
  endDate: resumeDateSchema.optional().default(null),
  isCurrent: z.boolean().default(false),
  description: z.string().max(8000).nullable().optional().default(null),
  sourcePage: z.number().int().min(1).nullable().optional().default(null),
});
export type ExtractedExperience = z.infer<typeof extractedExperienceSchema>;

export const extractedEducationSchema = z.object({
  institution: nullableStr,
  degree: nullableStr.optional().default(null),
  field: nullableStr.optional().default(null),
  startDate: resumeDateSchema.optional().default(null),
  endDate: resumeDateSchema.optional().default(null),
  grade: nullableStr.optional().default(null),
  sourcePage: z.number().int().min(1).nullable().optional().default(null),
});
export type ExtractedEducation = z.infer<typeof extractedEducationSchema>;

export const extractedResumeSchema = z.object({
  fullName: nullableStr,
  email: z.string().trim().email().nullable(),
  phone: z.string().trim().max(40).nullable(),
  location: nullableStr,
  summary: z.string().max(5000).nullable(),
  currentTitle: nullableStr,
  previousTitles: z.array(z.string().trim().min(1).max(200)).default([]),
  totalExperienceMonths: z.number().int().min(0).max(800).nullable(),
  experiences: z.array(extractedExperienceSchema).default([]),
  skills: z
    .object({
      technical: z.array(z.string().trim().min(1).max(80)).default([]),
      soft: z.array(z.string().trim().min(1).max(80)).default([]),
      programmingLanguages: z.array(z.string().trim().min(1).max(80)).default([]),
      frameworks: z.array(z.string().trim().min(1).max(80)).default([]),
      databases: z.array(z.string().trim().min(1).max(80)).default([]),
      cloud: z.array(z.string().trim().min(1).max(80)).default([]),
      tools: z.array(z.string().trim().min(1).max(80)).default([]),
    })
    .default({ technical: [], soft: [], programmingLanguages: [], frameworks: [], databases: [], cloud: [], tools: [] }),
  education: z.array(extractedEducationSchema).default([]),
  certifications: z
    .array(z.object({ name: z.string().trim().min(1).max(300), issuer: nullableStr.optional().default(null), date: resumeDateSchema.optional().default(null) }))
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(300),
        description: z.string().max(4000).nullable().optional().default(null),
        technologies: z.array(z.string().max(80)).default([]),
        url: z.string().max(500).nullable().optional().default(null),
      }),
    )
    .default([]),
  achievements: z.array(z.string().trim().min(1).max(1000)).default([]),
  links: z
    .object({
      linkedin: z.string().max(500).nullable().default(null),
      github: z.string().max(500).nullable().default(null),
      portfolio: z.string().max(500).nullable().default(null),
      other: z.array(z.string().max(500)).default([]),
    })
    .default({ linkedin: null, github: null, portfolio: null, other: [] }),
  /** field path → confidence 0..1 (e.g. "fullName", "experiences.0.company"). */
  confidence: z.record(z.string(), z.number().min(0).max(1)).default({}),
});
export type ExtractedResume = z.infer<typeof extractedResumeSchema>;

export function emptyExtractedResume(): ExtractedResume {
  return extractedResumeSchema.parse({
    fullName: null,
    email: null,
    phone: null,
    location: null,
    summary: null,
    currentTitle: null,
    totalExperienceMonths: null,
  });
}

// ---------------------------------------------------------------------------
// Candidate profile (user-reviewed)
// ---------------------------------------------------------------------------
export const candidateSkillInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(SKILL_CATEGORIES).default('TECHNICAL'),
  years: z.number().min(0).max(60).nullable().optional(),
});

export const candidateProfileUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(200).nullable().optional(),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  location: z.string().trim().max(300).nullable().optional(),
  headline: z.string().trim().max(300).nullable().optional(),
  summary: z.string().max(5000).nullable().optional(),
  currentTitle: z.string().trim().max(200).nullable().optional(),
  totalExperienceMonths: z.number().int().min(0).max(800).nullable().optional(),
  links: z
    .object({
      linkedin: z.string().max(500).nullable().optional(),
      github: z.string().max(500).nullable().optional(),
      portfolio: z.string().max(500).nullable().optional(),
      other: z.array(z.string().max(500)).optional(),
    })
    .optional(),
  experiences: z.array(extractedExperienceSchema).optional(),
  education: z.array(extractedEducationSchema).optional(),
  skills: z.array(candidateSkillInputSchema).max(300).optional(),
  certifications: extractedResumeSchema.shape.certifications.optional(),
  projects: extractedResumeSchema.shape.projects.optional(),
  achievements: z.array(z.string().max(1000)).optional(),
  markReviewed: z.boolean().optional(),
});
export type CandidateProfileUpdate = z.infer<typeof candidateProfileUpdateSchema>;

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------
export const preferredLocationSchema = z.object({
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(120).nullable().optional(),
  country: z.string().trim().max(120).nullable().optional(),
});
export type PreferredLocation = z.infer<typeof preferredLocationSchema>;

export const EXPERIENCE_BANDS = {
  FRESHER: [0, 0],
  '0-1': [0, 1],
  '1-3': [1, 3],
  '3-5': [3, 5],
  '5-8': [5, 8],
  '8+': [8, 50],
} as const;

export const answerPreferencesSchema = z.object({
  tone: z.enum(['concise', 'professional', 'enthusiastic']).default('professional'),
  maxLength: z.number().int().min(50).max(4000).default(600),
  alwaysRequireApproval: z.boolean().default(false),
  workAuthorizationCountries: z.array(z.string().max(80)).default([]),
  requiresSponsorship: z.boolean().nullable().default(null),
  willingToRelocate: z.boolean().nullable().default(null),
  availableFrom: z.string().max(40).nullable().default(null),
});
export type AnswerPreferences = z.infer<typeof answerPreferencesSchema>;

export const preferencesSchema = z
  .object({
    titles: z.array(z.string().trim().min(1).max(120)).min(1).max(30),
    experienceBand: z.enum(['FRESHER', '0-1', '1-3', '3-5', '5-8', '8+', 'CUSTOM']).default('CUSTOM'),
    experienceMinYears: z.number().min(0).max(50).nullable().default(null),
    experienceMaxYears: z.number().min(0).max(60).nullable().default(null),
    locations: z.array(preferredLocationSchema).max(30).default([]),
    workModes: z.array(z.enum(WORK_MODES)).default(['REMOTE', 'HYBRID', 'ONSITE']),
    employmentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).default(['FULL_TIME']),
    salaryMin: z.number().min(0).nullable().default(null),
    salaryMax: z.number().min(0).nullable().default(null),
    salaryCurrency: z.string().trim().length(3).toUpperCase().default('USD'),
    salaryPeriod: z.enum(SALARY_PERIODS).default('YEAR'),
    industries: z.array(z.string().trim().max(120)).max(30).default([]),
    preferredCompanies: z.array(z.string().trim().max(120)).max(100).default([]),
    excludedCompanies: z.array(z.string().trim().max(120)).max(200).default([]),
    noticePeriodDays: z.number().int().min(0).max(365).nullable().default(null),
    keywords: z.array(z.string().trim().max(80)).max(50).default([]),
    maxPostingAgeDays: z.number().int().min(1).max(365).nullable().default(30),
    searchFrequency: z.enum(SEARCH_FREQUENCIES).default('MANUAL'),
    platforms: z.array(z.enum(PLATFORM_KEYS)).default(['sandbox']),
    applicationMode: z.enum(APPLICATION_MODES).default('MANUAL'),
    autoApplyMinScore: z.number().min(0).max(100).default(75),
    dailyApplicationLimit: z.number().int().min(0).max(200).default(10),
    autoApplyConsent: z.boolean().default(false),
    answerPreferences: answerPreferencesSchema.default(answerPreferencesSchema.parse({})),
  })
  .superRefine((v, ctx) => {
    if (v.salaryMin != null && v.salaryMax != null && v.salaryMin > v.salaryMax) {
      ctx.addIssue({ code: 'custom', path: ['salaryMax'], message: 'salaryMax must be ≥ salaryMin' });
    }
    if (v.experienceMinYears != null && v.experienceMaxYears != null && v.experienceMinYears > v.experienceMaxYears) {
      ctx.addIssue({ code: 'custom', path: ['experienceMaxYears'], message: 'max must be ≥ min' });
    }
    if (v.applicationMode === 'AUTOMATIC' && !v.autoApplyConsent) {
      ctx.addIssue({ code: 'custom', path: ['autoApplyConsent'], message: 'Automatic mode requires explicit consent' });
    }
  });
export type PreferencesInput = z.infer<typeof preferencesSchema>;

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------
export const normalizedJobSchema = z.object({
  platform: z.enum(PLATFORM_KEYS),
  externalId: z.string().min(1).max(300),
  url: z.string().url().max(2000),
  applyUrl: z.string().url().max(2000).nullable().default(null),
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300),
  description: z.string().max(100_000).default(''),
  skills: z.array(z.string().max(80)).default([]),
  requiredSkills: z.array(z.string().max(80)).default([]),
  optionalSkills: z.array(z.string().max(80)).default([]),
  experienceMinYears: z.number().min(0).max(50).nullable().default(null),
  experienceMaxYears: z.number().min(0).max(60).nullable().default(null),
  location: z.string().max(300).nullable().default(null),
  city: z.string().max(120).nullable().default(null),
  country: z.string().max(120).nullable().default(null),
  workMode: z.enum(WORK_MODES).nullable().default(null),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable().default(null),
  salaryMin: z.number().nullable().default(null),
  salaryMax: z.number().nullable().default(null),
  salaryCurrency: z.string().max(3).nullable().default(null),
  salaryPeriod: z.enum(SALARY_PERIODS).nullable().default(null),
  postedAt: z.coerce.date().nullable().default(null),
  raw: z.unknown().optional(),
});
export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

export const jobListQuerySchema = z.object({
  view: z.string().default('ALL'),
  q: z.string().max(200).optional(),
  platform: z.enum(PLATFORM_KEYS).optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
  workMode: z.enum(WORK_MODES).optional(),
  sort: z.enum(['score', 'posted', 'discovered', 'company']).default('score'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;

/** Job captured by the browser extension from a page the user is viewing. */
export const capturedJobSchema = z.object({
  url: z.string().url().max(2000),
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300),
  description: z.string().max(100_000).default(''),
  location: z.string().max(300).nullable().optional(),
  employmentType: z.string().max(60).nullable().optional(),
  postedAt: z.string().max(60).nullable().optional(),
  salaryText: z.string().max(200).nullable().optional(),
  externalId: z.string().max(300).nullable().optional(),
  platformHint: z.enum(PLATFORM_KEYS).nullable().optional(),
});
export type CapturedJob = z.infer<typeof capturedJobSchema>;

// ---------------------------------------------------------------------------
// Application forms & answers
// ---------------------------------------------------------------------------
export const detectedFieldSchema = z.object({
  key: z.string().min(1).max(200),
  label: z.string().max(2000),
  type: z.enum(QUESTION_TYPES),
  required: z.boolean().default(false),
  options: z.array(z.object({ value: z.string(), label: z.string() })).default([]),
  selector: z.string().max(500).optional(),
  maxLength: z.number().int().positive().nullable().optional(),
  placeholder: z.string().max(500).nullable().optional(),
});
export type DetectedField = z.infer<typeof detectedFieldSchema>;

export const generatedAnswerSchema = z.object({
  answer: z.string().max(10_000).nullable(),
  requiresUserInput: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(2000).default(''),
  usedFacts: z.array(z.string().max(500)).default([]),
});
export type GeneratedAnswer = z.infer<typeof generatedAnswerSchema>;

export const updateAnswerSchema = z.object({
  answer: z.string().max(10_000),
  approve: z.boolean().default(true),
  saveForReuse: z.boolean().default(false),
});

export const createApplicationSchema = z.object({
  jobId: z.string().uuid(),
  mode: z.enum(APPLICATION_MODES).default('MANUAL'),
  resumeId: z.string().uuid().optional(),
});

export const externalApplicationSchema = z.object({
  jobId: z.string().uuid().optional(),
  capturedJob: capturedJobSchema.optional(),
  appliedAt: z.coerce.date().optional(),
  evidence: z.string().max(2000).optional(),
  userConfirmed: z.boolean(),
});

export const updateApplicationStatusSchema = z.object({
  status: z.enum(APPLICATION_STATUSES),
  reason: z.string().max(1000).optional(),
});

// ---------------------------------------------------------------------------
// AI configuration
// ---------------------------------------------------------------------------
export const aiProviderConfigInputSchema = z.object({
  providerKey: z.enum(AI_PROVIDER_KEYS),
  apiKey: z.string().min(8).max(500).optional(),
  defaultModel: z.string().min(1).max(120),
  taskModels: z.partialRecord(z.enum(AI_TASKS), z.string().min(1).max(120)).default({}),
  fallbackProviderKeys: z.array(z.enum(AI_PROVIDER_KEYS)).default([]),
  allowFallback: z.boolean().default(false),
  monthlyTokenLimit: z.number().int().min(0).nullable().default(null),
  enabled: z.boolean().default(true),
});
export type AIProviderConfigInput = z.infer<typeof aiProviderConfigInputSchema>;

export const aiScopeSchema = z.enum(AI_CONFIG_SCOPES);

// ---------------------------------------------------------------------------
// Enterprise & admin
// ---------------------------------------------------------------------------
export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ENTERPRISE_ROLES).default('ENTERPRISE_USER'),
  teamId: z.string().uuid().nullable().optional(),
});
export const createTeamSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const updateMemberSchema = z.object({
  role: z.enum(ENTERPRISE_ROLES).optional(),
  teamId: z.string().uuid().nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});
export const createEnterpriseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  adminEmail: z.string().trim().toLowerCase().email(),
  planKey: z.string().max(60).default('enterprise'),
});
export const adminUpdateUserSchema = z.object({
  platformRole: z.enum(PLATFORM_ROLES).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});

export const planLimitsSchema = z.object({
  users: z.number().int().min(1).nullable().default(1),
  searchesPerMonth: z.number().int().min(0).nullable().default(null),
  applicationsPerMonth: z.number().int().min(0).nullable().default(null),
  aiTokensPerMonth: z.number().int().min(0).nullable().default(null),
  storageMb: z.number().int().min(0).nullable().default(null),
  browserMinutesPerMonth: z.number().int().min(0).nullable().default(null),
});
export type PlanLimits = z.infer<typeof planLimitsSchema>;

export const planFeaturesSchema = z.object({
  autoApply: z.boolean().default(false),
  byoAiKey: z.boolean().default(false),
  enterprise: z.boolean().default(false),
  extension: z.boolean().default(true),
  scheduledSearch: z.boolean().default(false),
});
export type PlanFeatures = z.infer<typeof planFeaturesSchema>;

export const planInputSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(1).max(80),
  priceMonthlyCents: z.number().int().min(0),
  priceAnnualCents: z.number().int().min(0),
  currency: z.string().length(3).toUpperCase().default('USD'),
  limits: planLimitsSchema,
  features: planFeaturesSchema,
  aiMarkupPercent: z.number().min(0).max(500).default(20),
  isActive: z.boolean().default(true),
  isCustom: z.boolean().default(false),
});
export type PlanInput = z.infer<typeof planInputSchema>;

export const changeSubscriptionSchema = z.object({
  planKey: z.string().max(60),
  interval: z.enum(BILLING_INTERVALS).default('MONTHLY'),
});

export const matchingWeightsSchema = z
  .object({
    skill: z.number().min(0).max(1),
    experience: z.number().min(0).max(1),
    location: z.number().min(0).max(1),
    preference: z.number().min(0).max(1),
    salary: z.number().min(0).max(1),
  })
  .refine((w) => Math.abs(w.skill + w.experience + w.location + w.preference + w.salary - 1) < 0.001, {
    message: 'Weights must sum to 1',
  });
export type MatchingWeights = z.infer<typeof matchingWeightsSchema>;

export const intentSchema = z.enum(QUESTION_INTENTS);
