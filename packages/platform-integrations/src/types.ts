import type { CapabilityStatus, ConnectionStatus, DetectedField, IntegrationOperation, NormalizedJob, PlatformKey, WorkMode } from '@autoapply/shared';

export interface Capability {
  status: CapabilityStatus;
  note: string;
}

export type CapabilityMatrix = Record<IntegrationOperation, Capability>;

export interface PlatformLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

/** Field values to write into a form, keyed by DetectedField.key. */
export interface FormFillValue {
  key: string;
  value: string | string[] | boolean | null;
  /** For FILE fields: absolute path of a local temp file (resume). */
  filePath?: string;
}

export interface FillResult {
  filled: string[];
  skipped: { key: string; reason: string }[];
  screenshotPath?: string;
}

export interface SubmissionResult {
  submitted: boolean;
  /** True only when a confirmation was positively observed (page text / API response). */
  verified: boolean;
  externalApplicationId?: string;
  confirmationText?: string;
  confirmationUrl?: string;
  screenshotPath?: string;
  error?: string;
}

/**
 * Port implemented by the browser-automation worker (Playwright). Platform
 * adapters never import Playwright directly; they describe *what* to do.
 */
export interface BrowserFormDriver {
  detectForm(url: string, opts?: { formSelector?: string; storageState?: unknown }): Promise<DetectedField[]>;
  fillForm(url: string, values: FormFillValue[], opts?: { formSelector?: string; storageState?: unknown; screenshot?: boolean }): Promise<FillResult>;
  fillAndSubmit(
    url: string,
    values: FormFillValue[],
    opts: { formSelector?: string; submitSelector?: string; confirmation: { selector?: string; textPattern: string; referencePattern?: string }; storageState?: unknown; screenshot?: boolean },
  ): Promise<SubmissionResult>;
}

export interface PlatformContext {
  userId: string;
  /** Non-secret connection settings (e.g. Greenhouse board tokens). */
  settings: Record<string, unknown>;
  /** Decrypted credentials (only passed in-process; never logged or returned to clients). */
  credentials?: Record<string, string> | null;
  fetch: typeof fetch;
  browser?: BrowserFormDriver;
  logger: PlatformLogger;
}

export interface SearchQuery {
  keywords: string;
  location?: string | null;
  workModes?: WorkMode[];
  postedWithinDays?: number | null;
  limit?: number;
}

export interface SearchResult {
  jobs: NormalizedJob[];
  /** Raw postings examined before local filtering. */
  examined: number;
  warnings: string[];
}

export interface ConnectionResult {
  status: ConnectionStatus;
  message: string;
  /** Settings to persist (non-secret). */
  settings?: Record<string, unknown>;
  /** User action required to complete the connection (e.g. log in via the extension). */
  userAction?: { type: 'OPEN_URL' | 'INSTALL_EXTENSION' | 'PROVIDE_SETTINGS'; url?: string; instructions: string };
}

export interface ApplicationFormDescriptor {
  url: string;
  fields: DetectedField[];
  /** How this form will be submitted. */
  submission: 'AUTOMATED' | 'USER_ASSISTED';
  instructions?: string;
}

export interface ApplicationStatusResult {
  status: 'APPLIED' | 'REJECTED' | 'INTERVIEW' | 'OFFER' | 'UNKNOWN';
  verified: boolean;
  detail?: string;
}

export interface JobRef {
  externalId: string;
  url: string;
  applyUrl?: string | null;
}

export interface PlatformAdapter {
  readonly key: PlatformKey;
  readonly displayName: string;
  readonly capabilities: CapabilityMatrix;
  authenticate(ctx: PlatformContext, input: Record<string, unknown>): Promise<ConnectionResult>;
  validateConnection(ctx: PlatformContext): Promise<ConnectionResult>;
  searchJobs(ctx: PlatformContext, query: SearchQuery): Promise<SearchResult>;
  fetchJobDetails(ctx: PlatformContext, ref: JobRef): Promise<NormalizedJob>;
  normalizeJob(raw: unknown, ctx?: { settings?: Record<string, unknown> }): NormalizedJob;
  getApplicationForm(ctx: PlatformContext, ref: JobRef): Promise<ApplicationFormDescriptor>;
  fillApplicationForm(ctx: PlatformContext, ref: JobRef, values: FormFillValue[]): Promise<FillResult>;
  submitApplication(ctx: PlatformContext, ref: JobRef, values: FormFillValue[]): Promise<SubmissionResult>;
  checkApplicationStatus(ctx: PlatformContext, ref: JobRef & { externalApplicationId?: string | null }): Promise<ApplicationStatusResult>;
  disconnect(ctx: PlatformContext): Promise<void>;
}

export class UnsupportedOperationError extends Error {
  constructor(
    public readonly platform: PlatformKey,
    public readonly operation: IntegrationOperation,
    public readonly capability: Capability,
  ) {
    super(`${platform}.${operation} is ${capability.status.toLowerCase().replace('_', ' ')}: ${capability.note}`);
    this.name = 'UnsupportedOperationError';
  }
}

export class PlatformError extends Error {
  constructor(
    public readonly platform: PlatformKey,
    public readonly code: 'NETWORK' | 'HTTP' | 'PARSE' | 'NOT_FOUND' | 'CONFIG' | 'AUTH',
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}
