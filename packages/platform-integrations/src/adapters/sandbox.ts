import { normalizedJobSchema, type NormalizedJob } from '@autoapply/shared';
import { enrichJob, htmlToText } from '@autoapply/matching-engine';
import { PlatformError, type ApplicationFormDescriptor, type CapabilityMatrix, type ConnectionResult, type FormFillValue, type JobRef, type PlatformContext, type SearchQuery, type SearchResult } from '../types';
import { BaseAdapter } from './base';

/**
 * Controlled test job board (apps/sandbox-board). Every operation is fully
 * implemented and exercised end-to-end in automated tests — including real
 * browser form filling and confirmation verification — without touching any
 * real job portal.
 */
export class SandboxAdapter extends BaseAdapter {
  readonly key = 'sandbox' as const;
  readonly displayName = 'Sandbox Job Board (test environment)';
  readonly capabilities: CapabilityMatrix = {
    authenticate: { status: 'IMPLEMENTED', note: 'No credentials required' },
    searchJobs: { status: 'IMPLEMENTED', note: 'JSON search API' },
    fetchJobDetails: { status: 'IMPLEMENTED', note: 'JSON job API' },
    getApplicationForm: { status: 'IMPLEMENTED', note: 'Browser form detection (Playwright)' },
    fillApplicationForm: { status: 'IMPLEMENTED', note: 'Browser form filling (Playwright)' },
    submitApplication: { status: 'IMPLEMENTED', note: 'Browser submission with confirmation-page verification; stops on CAPTCHA' },
    checkApplicationStatus: { status: 'IMPLEMENTED', note: 'Status API by confirmation reference' },
  };

  private baseUrl(ctx: { settings?: Record<string, unknown> }): string {
    const u = (ctx.settings?.baseUrl as string | undefined) ?? process.env.SANDBOX_BOARD_URL ?? 'http://localhost:4100';
    return u.replace(/\/$/, '');
  }

  override async authenticate(ctx: PlatformContext): Promise<ConnectionResult> {
    try {
      await this.getJson(ctx, `${this.baseUrl(ctx)}/api/health`, 5000);
      return { status: 'CONNECTED', message: 'Sandbox board reachable', settings: { baseUrl: this.baseUrl(ctx) } };
    } catch (e: any) {
      return { status: 'ERROR', message: `Sandbox board unreachable: ${e.message}` };
    }
  }

  override async searchJobs(ctx: PlatformContext, q: SearchQuery): Promise<SearchResult> {
    const params = new URLSearchParams({ q: q.keywords });
    if (q.location) params.set('location', q.location);
    if (q.postedWithinDays) params.set('days', String(q.postedWithinDays));
    params.set('limit', String(q.limit ?? 50));
    const data = await this.getJson(ctx, `${this.baseUrl(ctx)}/api/jobs?${params}`);
    const jobs = (data.jobs ?? []).map((j: unknown) => this.normalizeJob(j, ctx));
    const filtered = q.workModes?.length ? jobs.filter((j: NormalizedJob) => !j.workMode || q.workModes!.includes(j.workMode)) : jobs;
    return { jobs: filtered, examined: jobs.length, warnings: [] };
  }

  override async fetchJobDetails(ctx: PlatformContext, ref: JobRef): Promise<NormalizedJob> {
    return this.normalizeJob(await this.getJson(ctx, `${this.baseUrl(ctx)}/api/jobs/${encodeURIComponent(ref.externalId)}`), ctx);
  }

  normalizeJob(raw: any, ctx?: { settings?: Record<string, unknown> }): NormalizedJob {
    const base = this.baseUrl(ctx ?? {});
    return enrichJob(
      normalizedJobSchema.parse({
        platform: 'sandbox',
        externalId: String(raw.id),
        url: raw.url ?? `${base}/jobs/${raw.id}`,
        applyUrl: raw.applyUrl ?? `${base}/jobs/${raw.id}/apply`,
        title: raw.title,
        company: raw.company,
        description: htmlToText(raw.description ?? ''),
        location: raw.location ?? null,
        city: raw.city ?? null,
        country: raw.country ?? null,
        workMode: raw.workMode ?? null,
        employmentType: raw.employmentType ?? null,
        salaryMin: raw.salary?.min ?? null,
        salaryMax: raw.salary?.max ?? null,
        salaryCurrency: raw.salary?.currency ?? null,
        salaryPeriod: raw.salary?.period ?? null,
        postedAt: raw.postedAt ?? null,
        raw: { id: raw.id },
      }),
    );
  }

  private applyUrl(ctx: PlatformContext, ref: JobRef): string {
    return ref.applyUrl ?? `${this.baseUrl(ctx)}/jobs/${encodeURIComponent(ref.externalId)}/apply`;
  }

  private requireBrowser(ctx: PlatformContext) {
    if (!ctx.browser) throw new PlatformError(this.key, 'CONFIG', 'Browser automation worker is required for this operation');
    return ctx.browser;
  }

  override async getApplicationForm(ctx: PlatformContext, ref: JobRef): Promise<ApplicationFormDescriptor> {
    const url = this.applyUrl(ctx, ref);
    const fields = await this.requireBrowser(ctx).detectForm(url, { formSelector: 'form#application-form' });
    return { url, fields, submission: 'AUTOMATED' };
  }

  override async fillApplicationForm(ctx: PlatformContext, ref: JobRef, values: FormFillValue[]) {
    return this.requireBrowser(ctx).fillForm(this.applyUrl(ctx, ref), values, { formSelector: 'form#application-form', screenshot: true });
  }

  override async submitApplication(ctx: PlatformContext, ref: JobRef, values: FormFillValue[]) {
    return this.requireBrowser(ctx).fillAndSubmit(this.applyUrl(ctx, ref), values, {
      formSelector: 'form#application-form',
      submitSelector: 'button[type=submit]',
      confirmation: { selector: '#confirmation', textPattern: 'Application submitted', referencePattern: 'Reference:\\s*(SBX-[A-Z0-9]+)' },
      screenshot: true,
    });
  }

  override async checkApplicationStatus(ctx: PlatformContext, ref: JobRef & { externalApplicationId?: string | null }) {
    if (!ref.externalApplicationId) return { status: 'UNKNOWN' as const, verified: false, detail: 'No confirmation reference stored' };
    const data = await this.getJson(ctx, `${this.baseUrl(ctx)}/api/applications/${encodeURIComponent(ref.externalApplicationId)}`);
    const map: Record<string, 'APPLIED' | 'REJECTED' | 'INTERVIEW' | 'OFFER'> = { RECEIVED: 'APPLIED', REVIEWING: 'APPLIED', INTERVIEW: 'INTERVIEW', REJECTED: 'REJECTED', OFFER: 'OFFER' };
    return { status: map[data.status] ?? 'UNKNOWN', verified: true, detail: `Board status: ${data.status}` };
  }
}
