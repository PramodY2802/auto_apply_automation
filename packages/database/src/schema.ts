import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
} from 'drizzle-orm/pg-core';
import {
  ACCOUNT_TYPES,
  AI_CONFIG_SCOPES,
  ANSWER_SOURCES,
  APPLICATION_MODES,
  APPLICATION_SOURCES,
  APPLICATION_STATUSES,
  APPROVAL_STATUSES,
  BILLING_INTERVALS,
  CONNECTION_STATUSES,
  DISCOVERY_TRIGGERS,
  EMPLOYMENT_TYPES,
  ENTERPRISE_ROLES,
  EXTRACTION_METHODS,
  EXTRACTION_STATUSES,
  INVOICE_KINDS,
  INVOICE_STATUSES,
  PLATFORM_ROLES,
  QUESTION_TYPES,
  RESUME_STATUSES,
  RUN_STATUSES,
  SALARY_PERIODS,
  SEARCH_FREQUENCIES,
  SKILL_CATEGORIES,
  SUBSCRIPTION_STATUSES,
  USAGE_METRICS,
  USER_STATUSES,
  WORK_MODES,
  type AnswerPreferences,
  type ExtractedResume,
  type PlanFeatures,
  type PlanLimits,
  type PreferredLocation,
} from '@autoapply/shared';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const platformRoleEnum = pgEnum('platform_role', PLATFORM_ROLES);
export const accountTypeEnum = pgEnum('account_type', ACCOUNT_TYPES);
export const enterpriseRoleEnum = pgEnum('enterprise_role', ENTERPRISE_ROLES);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const applicationStatusEnum = pgEnum('application_status', APPLICATION_STATUSES);
export const applicationSourceEnum = pgEnum('application_source', APPLICATION_SOURCES);
export const applicationModeEnum = pgEnum('application_mode', APPLICATION_MODES);
export const connectionStatusEnum = pgEnum('connection_status', CONNECTION_STATUSES);
export const workModeEnum = pgEnum('work_mode', WORK_MODES);
export const employmentTypeEnum = pgEnum('employment_type', EMPLOYMENT_TYPES);
export const salaryPeriodEnum = pgEnum('salary_period', SALARY_PERIODS);
export const searchFrequencyEnum = pgEnum('search_frequency', SEARCH_FREQUENCIES);
export const skillCategoryEnum = pgEnum('skill_category', SKILL_CATEGORIES);
export const resumeStatusEnum = pgEnum('resume_status', RESUME_STATUSES);
export const extractionStatusEnum = pgEnum('extraction_status', EXTRACTION_STATUSES);
export const extractionMethodEnum = pgEnum('extraction_method', EXTRACTION_METHODS);
export const aiConfigScopeEnum = pgEnum('ai_config_scope', AI_CONFIG_SCOPES);
export const questionTypeEnum = pgEnum('question_type', QUESTION_TYPES);
export const answerSourceEnum = pgEnum('answer_source', ANSWER_SOURCES);
export const approvalStatusEnum = pgEnum('approval_status', APPROVAL_STATUSES);
export const subscriptionStatusEnum = pgEnum('subscription_status', SUBSCRIPTION_STATUSES);
export const billingIntervalEnum = pgEnum('billing_interval', BILLING_INTERVALS);
export const usageMetricEnum = pgEnum('usage_metric', USAGE_METRICS);
export const invoiceKindEnum = pgEnum('invoice_kind', INVOICE_KINDS);
export const invoiceStatusEnum = pgEnum('invoice_status', INVOICE_STATUSES);
export const discoveryTriggerEnum = pgEnum('discovery_trigger', DISCOVERY_TRIGGERS);
export const runStatusEnum = pgEnum('run_status', RUN_STATUSES);
export const authTokenTypeEnum = pgEnum('auth_token_type', ['EMAIL_VERIFICATION', 'PASSWORD_RESET']);
export const memberStatusEnum = pgEnum('member_status', ['ACTIVE', 'SUSPENDED']);
export const roleScopeEnum = pgEnum('role_scope', ['PLATFORM', 'ENTERPRISE']);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () =>
  ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Identity, tenancy, RBAC
// ---------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    accountType: accountTypeEnum('account_type').notNull().default('INDIVIDUAL'),
    platformRole: platformRoleEnum('platform_role').notNull().default('USER'),
    status: userStatusEnum('status').notNull().default('ACTIVE'),
    emailVerifiedAt: ts('email_verified_at'),
    lastLoginAt: ts('last_login_at'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: ts('locked_until'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [uniqueIndex('users_email_uq').on(t.email), check('users_email_lower', sql`${t.email} = lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfToken: text('csrf_token').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const authTokens = pgTable(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: authTokenTypeEnum('type').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('auth_tokens_hash_uq').on(t.tokenHash), index('auth_tokens_user_idx').on(t.userId, t.type)],
);

/** Scoped personal API tokens (used by the browser extension). */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    tokenPrefix: text('token_prefix').notNull(),
    scopes: text('scopes').array().notNull().default(sql`'{}'::text[]`),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_tokens_hash_uq').on(t.tokenHash), index('api_tokens_user_idx').on(t.userId)],
);

export const enterprises = pgTable(
  'enterprises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    status: memberStatusEnum('status').notNull().default('ACTIVE'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [uniqueIndex('enterprises_slug_uq').on(t.slug)],
);

export const teams = pgTable(
  'teams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enterpriseId: uuid('enterprise_id')
      .notNull()
      .references(() => enterprises.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('teams_enterprise_name_uq').on(t.enterpriseId, t.name)],
);

export const enterpriseMembers = pgTable(
  'enterprise_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enterpriseId: uuid('enterprise_id')
      .notNull()
      .references(() => enterprises.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: enterpriseRoleEnum('role').notNull().default('ENTERPRISE_USER'),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    status: memberStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('enterprise_members_uq').on(t.enterpriseId, t.userId),
    // A user belongs to at most one enterprise (simplifies tenant resolution).
    uniqueIndex('enterprise_members_user_uq').on(t.userId),
  ],
);

export const enterpriseInvitations = pgTable(
  'enterprise_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enterpriseId: uuid('enterprise_id')
      .notNull()
      .references(() => enterprises.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: enterpriseRoleEnum('role').notNull().default('ENTERPRISE_USER'),
    teamId: uuid('team_id').references(() => teams.id, { onDelete: 'set null' }),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('invitations_token_uq').on(t.tokenHash), index('invitations_enterprise_idx').on(t.enterpriseId)],
);

export const roles = pgTable('roles', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  scope: roleScopeEnum('scope').notNull(),
  description: text('description').notNull().default(''),
});

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  description: text('description').notNull().default(''),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleKey: text('role_key')
      .notNull()
      .references(() => roles.key, { onDelete: 'cascade' }),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleKey, t.permissionKey] })],
);

// ---------------------------------------------------------------------------
// Candidate data
// ---------------------------------------------------------------------------
export const resumes = pgTable(
  'resumes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id, { onDelete: 'set null' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    status: resumeStatusEnum('status').notNull().default('UPLOADED'),
    label: text('label'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('resumes_user_idx').on(t.userId), uniqueIndex('resumes_user_sha_uq').on(t.userId, t.sha256).where(sql`${t.deletedAt} is null`)],
);

export interface ExtractionPage {
  page: number;
  method: 'NATIVE_TEXT' | 'OCR' | 'DOCX';
  text: string;
  confidence: number | null;
  preprocessing?: string[];
}
export interface ExtractionStep {
  step: string;
  status: 'ok' | 'skipped' | 'error';
  ms: number;
  detail?: string;
}

export const resumeExtractions = pgTable(
  'resume_extractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resumeId: uuid('resume_id')
      .notNull()
      .references(() => resumes.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: extractionStatusEnum('status').notNull().default('PENDING'),
    documentType: text('document_type'),
    method: extractionMethodEnum('method'),
    ocrEngine: text('ocr_engine'),
    rawText: text('raw_text'),
    pages: jsonb('pages').$type<ExtractionPage[]>().notNull().default([]),
    structured: jsonb('structured').$type<ExtractedResume | null>(),
    fieldConfidence: jsonb('field_confidence').$type<Record<string, number>>().notNull().default({}),
    warnings: jsonb('warnings').$type<string[]>().notNull().default([]),
    aiProvider: text('ai_provider'),
    aiModel: text('ai_model'),
    parser: text('parser'),
    errors: jsonb('errors').$type<{ step: string; message: string }[]>().notNull().default([]),
    steps: jsonb('steps').$type<ExtractionStep[]>().notNull().default([]),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('resume_extractions_resume_idx').on(t.resumeId), index('resume_extractions_user_idx').on(t.userId)],
);

export interface ProfileLinks {
  linkedin?: string | null;
  github?: string | null;
  portfolio?: string | null;
  other?: string[];
}
export interface ProfileExtras {
  certifications: ExtractedResume['certifications'];
  projects: ExtractedResume['projects'];
  achievements: string[];
  previousTitles: string[];
}

export const candidateProfiles = pgTable(
  'candidate_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id, { onDelete: 'set null' }),
    fullName: text('full_name'),
    email: text('email'),
    phone: text('phone'),
    location: text('location'),
    headline: text('headline'),
    summary: text('summary'),
    currentTitle: text('current_title'),
    totalExperienceMonths: integer('total_experience_months'),
    links: jsonb('links').$type<ProfileLinks>().notNull().default({}),
    extras: jsonb('extras').$type<ProfileExtras>().notNull().default({ certifications: [], projects: [], achievements: [], previousTitles: [] }),
    fieldConfidence: jsonb('field_confidence').$type<Record<string, number>>().notNull().default({}),
    sourceResumeId: uuid('source_resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    reviewedAt: ts('reviewed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('candidate_profiles_user_uq').on(t.userId)],
);

export const candidateExperiences = pgTable(
  'candidate_experiences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => candidateProfiles.id, { onDelete: 'cascade' }),
    company: text('company'),
    title: text('title'),
    location: text('location'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    isCurrent: boolean('is_current').notNull().default(false),
    description: text('description'),
    sourcePage: integer('source_page'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('candidate_experiences_profile_idx').on(t.profileId)],
);

export const candidateEducation = pgTable(
  'candidate_education',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => candidateProfiles.id, { onDelete: 'cascade' }),
    institution: text('institution'),
    degree: text('degree'),
    field: text('field'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    grade: text('grade'),
    sourcePage: integer('source_page'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('candidate_education_profile_idx').on(t.profileId)],
);

export const candidateSkills = pgTable(
  'candidate_skills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => candidateProfiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    category: skillCategoryEnum('category').notNull().default('TECHNICAL'),
    years: doublePrecision('years'),
    confidence: doublePrecision('confidence'),
    source: text('source').notNull().default('USER'),
  },
  (t) => [uniqueIndex('candidate_skills_uq').on(t.profileId, t.normalizedName)],
);

export const candidatePreferences = pgTable(
  'candidate_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    titles: text('titles').array().notNull().default(sql`'{}'::text[]`),
    experienceBand: text('experience_band').notNull().default('CUSTOM'),
    experienceMinYears: doublePrecision('experience_min_years'),
    experienceMaxYears: doublePrecision('experience_max_years'),
    locations: jsonb('locations').$type<PreferredLocation[]>().notNull().default([]),
    workModes: text('work_modes').array().notNull().default(sql`'{}'::text[]`),
    employmentTypes: text('employment_types').array().notNull().default(sql`'{}'::text[]`),
    salaryMin: doublePrecision('salary_min'),
    salaryMax: doublePrecision('salary_max'),
    salaryCurrency: text('salary_currency').notNull().default('USD'),
    salaryPeriod: salaryPeriodEnum('salary_period').notNull().default('YEAR'),
    industries: text('industries').array().notNull().default(sql`'{}'::text[]`),
    preferredCompanies: text('preferred_companies').array().notNull().default(sql`'{}'::text[]`),
    excludedCompanies: text('excluded_companies').array().notNull().default(sql`'{}'::text[]`),
    noticePeriodDays: integer('notice_period_days'),
    keywords: text('keywords').array().notNull().default(sql`'{}'::text[]`),
    maxPostingAgeDays: integer('max_posting_age_days'),
    searchFrequency: searchFrequencyEnum('search_frequency').notNull().default('MANUAL'),
    platforms: text('platforms').array().notNull().default(sql`'{}'::text[]`),
    applicationMode: applicationModeEnum('application_mode').notNull().default('MANUAL'),
    autoApplyMinScore: doublePrecision('auto_apply_min_score').notNull().default(75),
    dailyApplicationLimit: integer('daily_application_limit').notNull().default(10),
    autoApplyConsentAt: ts('auto_apply_consent_at'),
    answerPreferences: jsonb('answer_preferences').$type<AnswerPreferences>().notNull(),
    nextSearchAt: ts('next_search_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('candidate_preferences_user_uq').on(t.userId), index('candidate_preferences_next_search_idx').on(t.nextSearchAt)],
);

// ---------------------------------------------------------------------------
// Platforms & sessions
// ---------------------------------------------------------------------------
export const platformConnections = pgTable(
  'platform_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    status: connectionStatusEnum('status').notNull().default('DISCONNECTED'),
    authType: text('auth_type').notNull().default('NONE'),
    /** AES-256-GCM envelope; never returned by the API. */
    encryptedCredentials: text('encrypted_credentials'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    lastValidatedAt: ts('last_validated_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('platform_connections_uq').on(t.userId, t.platform)],
);

export const browserSessions = pgTable(
  'browser_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').references(() => platformConnections.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    /** Encrypted Playwright storageState (cookies/localStorage). */
    encryptedState: text('encrypted_state'),
    status: text('status').notNull().default('ACTIVE'),
    expiresAt: ts('expires_at'),
    lastUsedAt: ts('last_used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('browser_sessions_user_idx').on(t.userId, t.platform)],
);

// ---------------------------------------------------------------------------
// Jobs (logical jobs are global/public data; per-user access goes through job_matches)
// ---------------------------------------------------------------------------
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fingerprint: text('fingerprint').notNull(),
    title: text('title').notNull(),
    normalizedTitle: text('normalized_title').notNull(),
    company: text('company').notNull(),
    normalizedCompany: text('normalized_company').notNull(),
    description: text('description').notNull().default(''),
    skills: text('skills').array().notNull().default(sql`'{}'::text[]`),
    requiredSkills: text('required_skills').array().notNull().default(sql`'{}'::text[]`),
    optionalSkills: text('optional_skills').array().notNull().default(sql`'{}'::text[]`),
    experienceMinYears: doublePrecision('experience_min_years'),
    experienceMaxYears: doublePrecision('experience_max_years'),
    location: text('location'),
    city: text('city'),
    country: text('country'),
    workMode: workModeEnum('work_mode'),
    employmentType: employmentTypeEnum('employment_type'),
    salaryMin: doublePrecision('salary_min'),
    salaryMax: doublePrecision('salary_max'),
    salaryCurrency: text('salary_currency'),
    salaryPeriod: salaryPeriodEnum('salary_period'),
    url: text('url').notNull(),
    applyUrl: text('apply_url'),
    postedAt: ts('posted_at'),
    discoveredAt: ts('discovered_at').notNull().defaultNow(),
    updatedAt: updatedAt(),
    closedAt: ts('closed_at'),
  },
  (t) => [
    uniqueIndex('jobs_fingerprint_uq').on(t.fingerprint),
    index('jobs_company_idx').on(t.normalizedCompany),
    index('jobs_posted_idx').on(t.postedAt),
  ],
);

export const jobSources = pgTable(
  'job_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    platform: text('platform').notNull(),
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    applyUrl: text('apply_url'),
    raw: jsonb('raw'),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('job_sources_platform_external_uq').on(t.platform, t.externalId), index('job_sources_job_idx').on(t.jobId)],
);

export interface DiscoveryLog {
  at: string;
  level: 'info' | 'warn' | 'error';
  platform?: string;
  message: string;
}

export const jobDiscoveryRuns = pgTable(
  'job_discovery_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id, { onDelete: 'set null' }),
    trigger: discoveryTriggerEnum('trigger').notNull().default('MANUAL'),
    status: runStatusEnum('status').notNull().default('QUEUED'),
    platforms: text('platforms').array().notNull().default(sql`'{}'::text[]`),
    queries: jsonb('queries').$type<unknown[]>().notNull().default([]),
    stats: jsonb('stats')
      .$type<{ found: number; created: number; duplicates: number; matched: number; skipped: number }>()
      .notNull()
      .default({ found: 0, created: 0, duplicates: 0, matched: 0, skipped: 0 }),
    logs: jsonb('logs').$type<DiscoveryLog[]>().notNull().default([]),
    error: text('error'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [index('discovery_runs_user_idx').on(t.userId, t.createdAt)],
);

export interface MatchExplanation {
  summary: string;
  factors: { factor: string; score: number; weight: number; detail: string }[];
  disqualifiers: string[];
}

export const jobMatches = pgTable(
  'job_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    overallScore: doublePrecision('overall_score').notNull(),
    skillScore: doublePrecision('skill_score').notNull(),
    experienceScore: doublePrecision('experience_score').notNull(),
    locationScore: doublePrecision('location_score').notNull(),
    preferenceScore: doublePrecision('preference_score').notNull(),
    salaryScore: doublePrecision('salary_score').notNull(),
    matchedSkills: text('matched_skills').array().notNull().default(sql`'{}'::text[]`),
    missingSkills: text('missing_skills').array().notNull().default(sql`'{}'::text[]`),
    explanation: jsonb('explanation').$type<MatchExplanation>().notNull(),
    disqualified: boolean('disqualified').notNull().default(false),
    isNew: boolean('is_new').notNull().default(true),
    hidden: boolean('hidden').notNull().default(false),
    saved: boolean('saved').notNull().default(false),
    discoveryRunId: uuid('discovery_run_id').references(() => jobDiscoveryRuns.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('job_matches_user_job_uq').on(t.userId, t.jobId), index('job_matches_user_score_idx').on(t.userId, t.overallScore)],
);

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------
export interface ConfirmationEvidence {
  verified: boolean;
  method: 'PAGE_CONFIRMATION' | 'PLATFORM_API' | 'USER_CONFIRMED' | 'EXTENSION_EVENT';
  confirmationText?: string;
  confirmationUrl?: string;
  screenshotKey?: string;
  externalReference?: string;
  capturedAt: string;
}

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id, { onDelete: 'set null' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'restrict' }),
    jobSourceId: uuid('job_source_id').references(() => jobSources.id, { onDelete: 'set null' }),
    platform: text('platform').notNull(),
    externalApplicationId: text('external_application_id'),
    source: applicationSourceEnum('source').notNull().default('INTERNAL'),
    mode: applicationModeEnum('mode').notNull().default('MANUAL'),
    status: applicationStatusEnum('status').notNull().default('READY_TO_APPLY'),
    resumeId: uuid('resume_id').references(() => resumes.id, { onDelete: 'set null' }),
    coverLetter: text('cover_letter'),
    formSnapshot: jsonb('form_snapshot').$type<unknown>(),
    submittedAt: ts('submitted_at'),
    confirmation: jsonb('confirmation').$type<ConfirmationEvidence | null>(),
    lastSyncedAt: ts('last_synced_at'),
    error: jsonb('error').$type<{ code: string; message: string; at: string } | null>(),
    attemptCount: integer('attempt_count').notNull().default(0),
    lockedAt: ts('locked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One application record per user per logical job → no duplicate submissions.
    uniqueIndex('applications_user_job_uq').on(t.userId, t.jobId),
    index('applications_user_status_idx').on(t.userId, t.status),
    index('applications_enterprise_idx').on(t.enterpriseId),
  ],
);

export const applicationAnswers = pgTable(
  'application_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    fieldKey: text('field_key').notNull(),
    question: text('question').notNull(),
    questionType: questionTypeEnum('question_type').notNull(),
    intent: text('intent').notNull().default('CUSTOM'),
    options: jsonb('options').$type<{ value: string; label: string }[]>().notNull().default([]),
    required: boolean('required').notNull().default(false),
    answer: text('answer'),
    source: answerSourceEnum('source'),
    requiresUserInput: boolean('requires_user_input').notNull().default(false),
    isSensitive: boolean('is_sensitive').notNull().default(false),
    approvalStatus: approvalStatusEnum('approval_status').notNull().default('PENDING'),
    confidence: doublePrecision('confidence'),
    reasoning: text('reasoning'),
    aiUsageLogId: uuid('ai_usage_log_id'),
    version: integer('version').notNull().default(1),
    history: jsonb('history').$type<{ answer: string | null; source: string | null; at: string; by: string }[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('application_answers_field_uq').on(t.applicationId, t.fieldKey)],
);

export const savedAnswers = pgTable(
  'saved_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionKey: text('question_key').notNull(),
    question: text('question').notNull(),
    intent: text('intent').notNull().default('CUSTOM'),
    answer: text('answer').notNull(),
    useCount: integer('use_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('saved_answers_uq').on(t.userId, t.questionKey)],
);

/** Append-only. The DB trigger in migration 0001 rejects UPDATE/DELETE. */
export const applicationEvents = pgTable(
  'application_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    message: text('message').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    actorUserId: uuid('actor_user_id'),
    createdAt: createdAt(),
  },
  (t) => [index('application_events_app_idx').on(t.applicationId, t.createdAt)],
);

export const applicationStatusHistory = pgTable(
  'application_status_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    fromStatus: applicationStatusEnum('from_status'),
    toStatus: applicationStatusEnum('to_status').notNull(),
    reason: text('reason'),
    actorUserId: uuid('actor_user_id'),
    actorType: text('actor_type').notNull().default('USER'),
    createdAt: createdAt(),
  },
  (t) => [index('application_status_history_app_idx').on(t.applicationId)],
);

// ---------------------------------------------------------------------------
// AI providers
// ---------------------------------------------------------------------------
export interface AIModelPricing {
  id: string;
  label: string;
  inputPer1M: number;
  outputPer1M: number;
}

export const aiProviders = pgTable('ai_providers', {
  key: text('key').primaryKey(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  baseUrl: text('base_url'),
  models: jsonb('models').$type<AIModelPricing[]>().notNull().default([]),
  updatedAt: updatedAt(),
});

export const aiProviderConfigs = pgTable(
  'ai_provider_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scope: aiConfigScopeEnum('scope').notNull(),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    providerKey: text('provider_key')
      .notNull()
      .references(() => aiProviders.key),
    encryptedApiKey: text('encrypted_api_key'),
    apiKeyLast4: text('api_key_last4'),
    defaultModel: text('default_model').notNull(),
    taskModels: jsonb('task_models').$type<Partial<Record<string, string>>>().notNull().default({}),
    fallbackProviderKeys: text('fallback_provider_keys').array().notNull().default(sql`'{}'::text[]`),
    allowFallback: boolean('allow_fallback').notNull().default(false),
    monthlyTokenLimit: bigint('monthly_token_limit', { mode: 'number' }),
    enabled: boolean('enabled').notNull().default(true),
    isActive: boolean('is_active').notNull().default(false),
    lastHealth: jsonb('last_health').$type<{ ok: boolean; latencyMs?: number; error?: string; at: string } | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ai_configs_scope_idx').on(t.scope, t.enterpriseId, t.userId),
    check(
      'ai_configs_scope_owner',
      sql`(${t.scope} = 'PLATFORM' and ${t.enterpriseId} is null and ${t.userId} is null) or (${t.scope} = 'ENTERPRISE' and ${t.enterpriseId} is not null and ${t.userId} is null) or (${t.scope} = 'USER' and ${t.userId} is not null)`,
    ),
  ],
);

export const aiUsageLogs = pgTable(
  'ai_usage_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id, { onDelete: 'set null' }),
    configId: uuid('config_id').references(() => aiProviderConfigs.id, { onDelete: 'set null' }),
    scope: aiConfigScopeEnum('scope').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    task: text('task').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 14, scale: 6 }).notNull().default('0'),
    latencyMs: integer('latency_ms').notNull().default(0),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    fallbackFrom: text('fallback_from'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_usage_user_idx').on(t.userId, t.createdAt), index('ai_usage_enterprise_idx').on(t.enterpriseId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    priceMonthlyCents: integer('price_monthly_cents').notNull().default(0),
    priceAnnualCents: integer('price_annual_cents').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    limits: jsonb('limits').$type<PlanLimits>().notNull(),
    features: jsonb('features').$type<PlanFeatures>().notNull(),
    aiMarkupPercent: doublePrecision('ai_markup_percent').notNull().default(20),
    isActive: boolean('is_active').notNull().default(true),
    isCustom: boolean('is_custom').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('plans_key_uq').on(t.key)],
);

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatusEnum('status').notNull().default('ACTIVE'),
    interval: billingIntervalEnum('interval').notNull().default('MONTHLY'),
    currentPeriodStart: ts('current_period_start').notNull(),
    currentPeriodEnd: ts('current_period_end').notNull(),
    cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
    pendingPlanId: uuid('pending_plan_id').references(() => plans.id),
    paymentProvider: text('payment_provider').notNull().default('manual'),
    providerSubscriptionId: text('provider_subscription_id'),
    canceledAt: ts('canceled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('subscriptions_user_idx').on(t.userId),
    index('subscriptions_enterprise_idx').on(t.enterpriseId),
    check('subscriptions_owner', sql`(${t.userId} is not null) <> (${t.enterpriseId} is not null)`),
  ],
);

export const usageRecords = pgTable(
  'usage_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id, { onDelete: 'set null' }),
    metric: usageMetricEnum('metric').notNull(),
    quantity: bigint('quantity', { mode: 'number' }).notNull(),
    costUsd: numeric('cost_usd', { precision: 14, scale: 6 }).notNull().default('0'),
    periodKey: text('period_key').notNull(),
    /** Idempotency: the originating record (ai_usage_log id, application id, run id…). */
    sourceId: text('source_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('usage_user_period_idx').on(t.userId, t.periodKey, t.metric),
    index('usage_enterprise_period_idx').on(t.enterpriseId, t.periodKey, t.metric),
    uniqueIndex('usage_source_uq').on(t.metric, t.sourceId),
  ],
);

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitAmountCents: number;
  amountCents: number;
}

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    subscriptionId: uuid('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    enterpriseId: uuid('enterprise_id').references(() => enterprises.id, { onDelete: 'set null' }),
    kind: invoiceKindEnum('kind').notNull(),
    status: invoiceStatusEnum('status').notNull().default('OPEN'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('USD'),
    periodStart: ts('period_start').notNull(),
    periodEnd: ts('period_end').notNull(),
    lineItems: jsonb('line_items').$type<InvoiceLine[]>().notNull().default([]),
    paymentProvider: text('payment_provider').notNull().default('manual'),
    providerInvoiceId: text('provider_invoice_id'),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    paidAt: ts('paid_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_number_uq').on(t.number),
    index('invoices_user_idx').on(t.userId),
    index('invoices_enterprise_idx').on(t.enterpriseId),
    uniqueIndex('invoices_period_uq').on(t.subscriptionId, t.kind, t.periodStart),
  ],
);

// ---------------------------------------------------------------------------
// Notifications, audit, settings
// ---------------------------------------------------------------------------
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    channel: text('channel').notNull().default('IN_APP'),
    readAt: ts('read_at'),
    emailedAt: ts('emailed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt, t.createdAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: uuid('actor_user_id'),
    enterpriseId: uuid('enterprise_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: text('ip'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_actor_idx').on(t.actorUserId, t.createdAt), index('audit_logs_enterprise_idx').on(t.enterpriseId, t.createdAt), index('audit_logs_action_idx').on(t.action)],
);

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: updatedAt(),
});
