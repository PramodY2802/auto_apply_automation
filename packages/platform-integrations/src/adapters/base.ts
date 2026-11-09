import type { IntegrationOperation, NormalizedJob, PlatformKey } from '@autoapply/shared';
import {
  PlatformError,
  UnsupportedOperationError,
  type ApplicationFormDescriptor,
  type ApplicationStatusResult,
  type CapabilityMatrix,
  type ConnectionResult,
  type FillResult,
  type FormFillValue,
  type JobRef,
  type PlatformAdapter,
  type PlatformContext,
  type SearchQuery,
  type SearchResult,
  type SubmissionResult,
} from '../types';

/** Base class: every operation not overridden reports its honest capability status. */
export abstract class BaseAdapter implements PlatformAdapter {
  abstract readonly key: PlatformKey;
  abstract readonly displayName: string;
  abstract readonly capabilities: CapabilityMatrix;

  protected unsupported(op: IntegrationOperation): never {
    throw new UnsupportedOperationError(this.key, op, this.capabilities[op]);
  }

  protected async getJson(ctx: PlatformContext, url: string, timeoutMs = 20_000): Promise<any> {
    let res: Response;
    try {
      res = await ctx.fetch(url, { headers: { accept: 'application/json', 'user-agent': 'AutoApplyBot/0.1 (+job discovery; respects robots and rate limits)' }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e: any) {
      throw new PlatformError(this.key, 'NETWORK', `Network error calling ${new URL(url).host}: ${e?.message ?? e}`, true);
    }
    if (res.status === 404) throw new PlatformError(this.key, 'NOT_FOUND', `Not found: ${new URL(url).pathname}`);
    if (!res.ok) throw new PlatformError(this.key, 'HTTP', `${new URL(url).host} returned ${res.status}`, res.status >= 500 || res.status === 429);
    try {
      return await res.json();
    } catch {
      throw new PlatformError(this.key, 'PARSE', 'Response was not valid JSON');
    }
  }

  async authenticate(_ctx: PlatformContext, _input: Record<string, unknown>): Promise<ConnectionResult> {
    return this.unsupported('authenticate');
  }
  async validateConnection(ctx: PlatformContext): Promise<ConnectionResult> {
    return this.authenticate(ctx, {});
  }
  async searchJobs(_ctx: PlatformContext, _q: SearchQuery): Promise<SearchResult> {
    return this.unsupported('searchJobs');
  }
  async fetchJobDetails(_ctx: PlatformContext, _ref: JobRef): Promise<NormalizedJob> {
    return this.unsupported('fetchJobDetails');
  }
  abstract normalizeJob(raw: unknown, ctx?: { settings?: Record<string, unknown> }): NormalizedJob;
  async getApplicationForm(_ctx: PlatformContext, _ref: JobRef): Promise<ApplicationFormDescriptor> {
    return this.unsupported('getApplicationForm');
  }
  async fillApplicationForm(_ctx: PlatformContext, _ref: JobRef, _v: FormFillValue[]): Promise<FillResult> {
    return this.unsupported('fillApplicationForm');
  }
  async submitApplication(_ctx: PlatformContext, _ref: JobRef, _v: FormFillValue[]): Promise<SubmissionResult> {
    return this.unsupported('submitApplication');
  }
  async checkApplicationStatus(_ctx: PlatformContext, _ref: JobRef): Promise<ApplicationStatusResult> {
    return this.unsupported('checkApplicationStatus');
  }
  async disconnect(_ctx: PlatformContext): Promise<void> {
    /* stateless by default; stored credentials/sessions are deleted by the API */
  }
}

/** Local filter used by board-style sources that return a company's full job list. */
export function matchesQuery(job: NormalizedJob, q: SearchQuery): boolean {
  const kw = q.keywords.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hay = `${job.title} ${job.description.slice(0, 2000)}`.toLowerCase();
  const titleHay = job.title.toLowerCase();
  const kwOk = !kw.length || kw.every((w) => hay.includes(w)) && kw.some((w) => titleHay.includes(w));
  if (!kwOk) return false;
  if (q.workModes?.length && job.workMode && !q.workModes.includes(job.workMode)) return false;
  if (q.location && job.workMode !== 'REMOTE') {
    const loc = `${job.location ?? ''} ${job.city ?? ''} ${job.country ?? ''}`.toLowerCase();
    if (loc.trim() && !loc.includes(q.location.toLowerCase().split(',')[0]!.trim())) return false;
  }
  if (q.postedWithinDays && job.postedAt && Date.now() - job.postedAt.getTime() > q.postedWithinDays * 86_400_000) return false;
  return true;
}
