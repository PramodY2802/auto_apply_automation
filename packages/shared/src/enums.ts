/**
 * Canonical enums shared by API, workers, web and database.
 * Values are persisted in Postgres enums — append only, never rename.
 */

export const PLATFORM_ROLES = ['USER', 'PLATFORM_ADMIN', 'SUPER_ADMIN'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ACCOUNT_TYPES = ['INDIVIDUAL', 'ENTERPRISE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ENTERPRISE_ROLES = ['ENTERPRISE_ADMIN', 'ENTERPRISE_USER'] as const;
export type EnterpriseRole = (typeof ENTERPRISE_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const APPLICATION_STATUSES = [
  'DISCOVERED',
  'NOT_APPLIED',
  'READY_TO_APPLY',
  'IN_PROGRESS',
  'PENDING_APPROVAL',
  'APPLIED',
  'FAILED',
  'REJECTED',
  'INTERVIEW',
  'OFFER',
  'WITHDRAWN',
  'NEEDS_VERIFICATION',
  'UNKNOWN',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Allowed status transitions. APPLIED can only be reached through a verified
 * submission (enforced in the application service, not just here).
 */
export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  DISCOVERED: ['NOT_APPLIED', 'READY_TO_APPLY', 'IN_PROGRESS', 'WITHDRAWN'],
  NOT_APPLIED: ['READY_TO_APPLY', 'IN_PROGRESS', 'WITHDRAWN', 'APPLIED', 'NEEDS_VERIFICATION'],
  READY_TO_APPLY: ['IN_PROGRESS', 'PENDING_APPROVAL', 'WITHDRAWN', 'FAILED', 'NOT_APPLIED'],
  IN_PROGRESS: ['PENDING_APPROVAL', 'APPLIED', 'FAILED', 'NEEDS_VERIFICATION', 'WITHDRAWN', 'READY_TO_APPLY'],
  PENDING_APPROVAL: ['IN_PROGRESS', 'READY_TO_APPLY', 'WITHDRAWN', 'FAILED'],
  APPLIED: ['INTERVIEW', 'REJECTED', 'OFFER', 'WITHDRAWN', 'UNKNOWN'],
  FAILED: ['READY_TO_APPLY', 'IN_PROGRESS', 'WITHDRAWN', 'NEEDS_VERIFICATION'],
  REJECTED: ['INTERVIEW', 'OFFER'],
  INTERVIEW: ['OFFER', 'REJECTED', 'WITHDRAWN'],
  OFFER: ['WITHDRAWN', 'REJECTED'],
  WITHDRAWN: ['READY_TO_APPLY'],
  NEEDS_VERIFICATION: ['APPLIED', 'FAILED', 'UNKNOWN', 'NOT_APPLIED', 'WITHDRAWN'],
  UNKNOWN: ['APPLIED', 'NEEDS_VERIFICATION', 'NOT_APPLIED', 'WITHDRAWN', 'REJECTED', 'INTERVIEW', 'OFFER'],
};

export function canTransition(from: ApplicationStatus, to: ApplicationStatus): boolean {
  return from === to || APPLICATION_TRANSITIONS[from].includes(to);
}

export const APPLICATION_SOURCES = ['INTERNAL', 'EXTERNAL'] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];

export const APPLICATION_MODES = ['MANUAL', 'AUTOMATIC'] as const;
export type ApplicationMode = (typeof APPLICATION_MODES)[number];

export const PLATFORM_KEYS = ['sandbox', 'greenhouse', 'lever', 'linkedin', 'indeed', 'naukri'] as const;
export type PlatformKey = (typeof PLATFORM_KEYS)[number];

/**
 * Honest capability status for an integration operation.
 * - IMPLEMENTED: implemented and verified in this codebase's automated tests.
 * - AWAITING_CREDENTIALS: implemented against a documented public API; needs credentials/config to run live.
 * - USER_ASSISTED: the platform does not allow automation of this step; the user performs it (optionally helped by the extension).
 * - MOCKED: only a development mock exists.
 * - UNSUPPORTED: not available / awaiting platform authorization (partner API).
 */
export const CAPABILITY_STATUSES = [
  'IMPLEMENTED',
  'AWAITING_CREDENTIALS',
  'USER_ASSISTED',
  'MOCKED',
  'UNSUPPORTED',
] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

export const INTEGRATION_OPERATIONS = [
  'authenticate',
  'searchJobs',
  'fetchJobDetails',
  'getApplicationForm',
  'fillApplicationForm',
  'submitApplication',
  'checkApplicationStatus',
] as const;
export type IntegrationOperation = (typeof INTEGRATION_OPERATIONS)[number];

export const CONNECTION_STATUSES = ['CONNECTED', 'DISCONNECTED', 'NEEDS_REAUTH', 'PENDING_USER_ACTION', 'ERROR'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const WORK_MODES = ['REMOTE', 'HYBRID', 'ONSITE'] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'TEMPORARY', 'FREELANCE'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const SALARY_PERIODS = ['YEAR', 'MONTH', 'HOUR'] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const SEARCH_FREQUENCIES = ['MANUAL', 'DAILY', 'TWICE_DAILY', 'WEEKLY'] as const;
export type SearchFrequency = (typeof SEARCH_FREQUENCIES)[number];

export const SKILL_CATEGORIES = [
  'TECHNICAL',
  'SOFT',
  'PROGRAMMING_LANGUAGE',
  'FRAMEWORK',
  'DATABASE',
  'CLOUD',
  'TOOL',
  'OTHER',
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const RESUME_STATUSES = ['UPLOADED', 'PROCESSING', 'EXTRACTED', 'FAILED'] as const;
export type ResumeStatus = (typeof RESUME_STATUSES)[number];

export const EXTRACTION_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const EXTRACTION_METHODS = ['NATIVE_TEXT', 'OCR', 'DOCX', 'HYBRID'] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];

export const AI_PROVIDER_KEYS = ['openai', 'anthropic', 'gemini', 'mock'] as const;
export type AIProviderKey = (typeof AI_PROVIDER_KEYS)[number];

export const AI_CONFIG_SCOPES = ['PLATFORM', 'ENTERPRISE', 'USER'] as const;
export type AIConfigScope = (typeof AI_CONFIG_SCOPES)[number];

export const AI_TASKS = [
  'RESUME_EXTRACTION',
  'JOB_ANALYSIS',
  'QUESTION_ANSWERING',
  'COVER_LETTER',
  'APPLICATION_ANSWER',
] as const;
export type AITask = (typeof AI_TASKS)[number];

export const QUESTION_TYPES = [
  'TEXT',
  'TEXTAREA',
  'YES_NO',
  'MULTIPLE_CHOICE',
  'DROPDOWN',
  'NUMBER',
  'FILE',
  'EMAIL',
  'PHONE',
  'URL',
  'DATE',
  'CHECKBOX',
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_INTENTS = [
  'FULL_NAME',
  'FIRST_NAME',
  'LAST_NAME',
  'EMAIL',
  'PHONE',
  'LOCATION',
  'LINKEDIN',
  'GITHUB',
  'PORTFOLIO',
  'RESUME_UPLOAD',
  'COVER_LETTER',
  'SALARY_EXPECTATION',
  'CURRENT_SALARY',
  'TOTAL_EXPERIENCE',
  'SKILL_EXPERIENCE',
  'NOTICE_PERIOD',
  'WORK_AUTHORIZATION',
  'SPONSORSHIP',
  'RELOCATION',
  'AVAILABILITY',
  'MOTIVATION',
  'CURRENT_TITLE',
  'CURRENT_COMPANY',
  'EDUCATION',
  'DEMOGRAPHIC',
  'LEGAL_DECLARATION',
  'CUSTOM',
] as const;
export type QuestionIntent = (typeof QUESTION_INTENTS)[number];

/** Intents that are legally significant or sensitive → always require explicit user confirmation. */
export const SENSITIVE_INTENTS: QuestionIntent[] = [
  'WORK_AUTHORIZATION',
  'SPONSORSHIP',
  'LEGAL_DECLARATION',
  'DEMOGRAPHIC',
  'CURRENT_SALARY',
];

export const ANSWER_SOURCES = ['PROFILE', 'SAVED_ANSWER', 'AI', 'USER', 'PREFERENCE'] as const;
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPROVED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_INTERVALS = ['MONTHLY', 'ANNUAL'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export const USAGE_METRICS = ['SEARCH', 'APPLICATION', 'AI_TOKENS', 'STORAGE_BYTES', 'BROWSER_MINUTES'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const INVOICE_KINDS = ['SUBSCRIPTION', 'AI_USAGE'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const INVOICE_STATUSES = ['DRAFT', 'OPEN', 'PAID', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const DISCOVERY_TRIGGERS = ['MANUAL', 'SCHEDULED', 'EXTENSION'] as const;
export type DiscoveryTrigger = (typeof DISCOVERY_TRIGGERS)[number];

export const RUN_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Dashboard views → filter definitions live in the API jobs service. */
export const JOB_VIEWS = [
  'ALL',
  'NEW',
  'RECOMMENDED',
  'NOT_APPLIED',
  'READY_TO_APPLY',
  'IN_PROGRESS',
  'APPLIED',
  'FAILED',
  'REJECTED',
  'INTERVIEW',
  'OFFER',
  'WITHDRAWN',
  'NEEDS_VERIFICATION',
] as const;
export type JobView = (typeof JOB_VIEWS)[number];
