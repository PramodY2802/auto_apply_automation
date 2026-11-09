import { normalizedJobSchema, QUESTION_TYPES, type DetectedField, type NormalizedJob, type QuestionType } from '@autoapply/shared';
import { enrichJob, htmlToText } from '@autoapply/matching-engine';
import { PlatformError, type ApplicationFormDescriptor, type CapabilityMatrix, type ConnectionResult, type JobRef, type PlatformContext, type SearchQuery, type SearchResult } from '../types';
import { BaseAdapter, matchesQuery } from './base';

function boardTokens(settings: Record<string, unknown>, key: string): string[] {
  const v = settings[key];
  return Array.isArray(v) ? v.map(String).filter((s) => /^[a-z0-9_-]{2,80}$/i.test(s)) : [];
}

/**
 * Greenhouse public Job Board API (https://developers.greenhouse.io/job-board.html).
 * Read endpoints are public and intended for third-party job listings. Submitting
 * applications via API requires the *employer's* key, so submission is user-assisted.
 */
export class GreenhouseAdapter extends BaseAdapter {
  readonly key = 'greenhouse' as const;
  readonly displayName = 'Greenhouse (company job boards)';
  readonly capabilities: CapabilityMatrix = {
    authenticate: { status: 'IMPLEMENTED', note: 'No login needed; configure the company board tokens to follow' },
    searchJobs: { status: 'IMPLEMENTED', note: 'Public Job Board API; filtered locally. Verified against recorded API responses — live calls need outbound network access.' },
    fetchJobDetails: { status: 'IMPLEMENTED', note: 'Public Job Board API' },
    getApplicationForm: { status: 'IMPLEMENTED', note: 'Public application questions (?questions=true) are prepared and answered in-app' },
    fillApplicationForm: { status: 'USER_ASSISTED', note: 'The extension fills the hosted form in your own browser session' },
    submitApplication: { status: 'USER_ASSISTED', note: 'API submission requires the employer\'s API key; you submit the hosted form yourself' },
    checkApplicationStatus: { status: 'USER_ASSISTED', note: 'No candidate status API; update status manually or via email confirmations' },
  };
  private readonly api = 'https://boards-api.greenhouse.io/v1/boards';

  override async authenticate(ctx: PlatformContext, input: Record<string, unknown>): Promise<ConnectionResult> {
    const tokens = boardTokens({ ...ctx.settings, ...input }, 'boards');
    if (!tokens.length) {
      return {
        status: 'PENDING_USER_ACTION',
        message: 'Add at least one Greenhouse board token (the part after boards.greenhouse.io/)',
        userAction: { type: 'PROVIDE_SETTINGS', instructions: 'Enter company board tokens, e.g. "acme" for boards.greenhouse.io/acme' },
      };
    }
    return { status: 'CONNECTED', message: `Following ${tokens.length} Greenhouse board(s)`, settings: { boards: tokens } };
  }

  override async searchJobs(ctx: PlatformContext, q: SearchQuery): Promise<SearchResult> {
    const tokens = boardTokens(ctx.settings, 'boards');
    if (!tokens.length) throw new PlatformError(this.key, 'CONFIG', 'No Greenhouse boards configured');
    const out: NormalizedJob[] = [];
    const warnings: string[] = [];
    let examined = 0;
    for (const token of tokens) {
      try {
        const data = await this.getJson(ctx, `${this.api}/${encodeURIComponent(token)}/jobs?content=true`);
        for (const raw of data.jobs ?? []) {
          examined++;
          const job = this.normalizeJob({ ...raw, __board: token, __company: data.meta?.name ?? raw.company_name ?? token });
          if (matchesQuery(job, q)) out.push(job);
        }
      } catch (e: any) {
        warnings.push(`Board "${token}": ${e.message}`);
        ctx.logger.warn('greenhouse board fetch failed', { token, error: e.message });
      }
    }
    return { jobs: out.slice(0, q.limit ?? 100), examined, warnings };
  }

  override async fetchJobDetails(ctx: PlatformContext, ref: JobRef): Promise<NormalizedJob> {
    const [board, id] = ref.externalId.split(':');
    const data = await this.getJson(ctx, `${this.api}/${encodeURIComponent(board!)}/jobs/${encodeURIComponent(id!)}`);
    return this.normalizeJob({ ...data, __board: board });
  }

  normalizeJob(raw: any): NormalizedJob {
    const board = raw.__board ?? 'unknown';
    const content = raw.content ? htmlToText(decodeEntities(String(raw.content))) : '';
    return enrichJob(
      normalizedJobSchema.parse({
        platform: 'greenhouse',
        externalId: `${board}:${raw.id}`,
        url: raw.absolute_url,
        applyUrl: raw.absolute_url,
        title: raw.title,
        company: raw.__company ?? raw.company_name ?? board,
        description: content,
        location: raw.location?.name ?? null,
        postedAt: raw.first_published ?? raw.updated_at ?? null,
        raw: { id: raw.id, board },
      }),
    );
  }

  override async getApplicationForm(ctx: PlatformContext, ref: JobRef): Promise<ApplicationFormDescriptor> {
    const [board, id] = ref.externalId.split(':');
    const data = await this.getJson(ctx, `${this.api}/${encodeURIComponent(board!)}/jobs/${encodeURIComponent(id!)}?questions=true`);
    const fields: DetectedField[] = [];
    for (const q of data.questions ?? []) {
      for (const f of q.fields ?? []) {
        fields.push({
          key: f.name,
          label: htmlToText(String(q.label ?? f.name)),
          type: mapGreenhouseType(f.type),
          required: !!q.required,
          options: (f.values ?? []).map((v: any) => ({ value: String(v.value), label: String(v.label) })),
        });
      }
    }
    return { url: ref.applyUrl ?? ref.url, fields, submission: 'USER_ASSISTED', instructions: 'Answers are prepared here; open the posting and use the extension to fill, then submit yourself.' };
  }
}

function mapGreenhouseType(t: string): QuestionType {
  const m: Record<string, QuestionType> = {
    input_text: 'TEXT',
    textarea: 'TEXTAREA',
    input_file: 'FILE',
    multi_value_single_select: 'DROPDOWN',
    multi_value_multi_select: 'MULTIPLE_CHOICE',
    input_hidden: 'TEXT',
  };
  const r = m[t] ?? 'TEXT';
  return (QUESTION_TYPES as readonly string[]).includes(r) ? r : 'TEXT';
}

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

/**
 * Lever public Postings API (https://github.com/lever/postings-api).
 * Listing is public; the apply endpoint requires the employer's API key → user-assisted.
 */
export class LeverAdapter extends BaseAdapter {
  readonly key = 'lever' as const;
  readonly displayName = 'Lever (company job boards)';
  readonly capabilities: CapabilityMatrix = {
    authenticate: { status: 'IMPLEMENTED', note: 'No login needed; configure company site names to follow' },
    searchJobs: { status: 'IMPLEMENTED', note: 'Public Postings API; filtered locally. Verified against recorded API responses — live calls need outbound network access.' },
    fetchJobDetails: { status: 'IMPLEMENTED', note: 'Public Postings API' },
    getApplicationForm: { status: 'USER_ASSISTED', note: 'Lever does not publish custom questions publicly; the extension reads the hosted form' },
    fillApplicationForm: { status: 'USER_ASSISTED', note: 'The extension fills the hosted form in your own browser session' },
    submitApplication: { status: 'USER_ASSISTED', note: 'API apply requires the employer\'s key; you submit the hosted form yourself' },
    checkApplicationStatus: { status: 'USER_ASSISTED', note: 'No candidate status API' },
  };
  private readonly api = 'https://api.lever.co/v0/postings';

  override async authenticate(ctx: PlatformContext, input: Record<string, unknown>): Promise<ConnectionResult> {
    const sites = boardTokens({ ...ctx.settings, ...input }, 'sites');
    if (!sites.length) {
      return { status: 'PENDING_USER_ACTION', message: 'Add at least one Lever site name (jobs.lever.co/<site>)', userAction: { type: 'PROVIDE_SETTINGS', instructions: 'Enter company site names, e.g. "acme" for jobs.lever.co/acme' } };
    }
    return { status: 'CONNECTED', message: `Following ${sites.length} Lever site(s)`, settings: { sites } };
  }

  override async searchJobs(ctx: PlatformContext, q: SearchQuery): Promise<SearchResult> {
    const sites = boardTokens(ctx.settings, 'sites');
    if (!sites.length) throw new PlatformError(this.key, 'CONFIG', 'No Lever sites configured');
    const out: NormalizedJob[] = [];
    const warnings: string[] = [];
    let examined = 0;
    for (const site of sites) {
      try {
        const data = await this.getJson(ctx, `${this.api}/${encodeURIComponent(site)}?mode=json`);
        for (const raw of Array.isArray(data) ? data : []) {
          examined++;
          const job = this.normalizeJob({ ...raw, __site: site });
          if (matchesQuery(job, q)) out.push(job);
        }
      } catch (e: any) {
        warnings.push(`Site "${site}": ${e.message}`);
      }
    }
    return { jobs: out.slice(0, q.limit ?? 100), examined, warnings };
  }

  override async fetchJobDetails(ctx: PlatformContext, ref: JobRef): Promise<NormalizedJob> {
    const [site, id] = ref.externalId.split(':');
    return this.normalizeJob({ ...(await this.getJson(ctx, `${this.api}/${encodeURIComponent(site!)}/${encodeURIComponent(id!)}?mode=json`)), __site: site });
  }

  normalizeJob(raw: any): NormalizedJob {
    const site = raw.__site ?? 'unknown';
    const lists = (raw.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(String(l.content ?? ''))}`).join('\n');
    const description = [raw.descriptionPlain ?? htmlToText(String(raw.description ?? '')), lists, raw.additionalPlain ?? ''].filter(Boolean).join('\n');
    const commitment = raw.categories?.commitment as string | undefined;
    const workplace = raw.workplaceType as string | undefined;
    return enrichJob(
      normalizedJobSchema.parse({
        platform: 'lever',
        externalId: `${site}:${raw.id}`,
        url: raw.hostedUrl,
        applyUrl: raw.applyUrl ?? raw.hostedUrl,
        title: raw.text,
        company: raw.__company ?? site.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
        description,
        location: raw.categories?.location ?? null,
        workMode: workplace === 'remote' ? 'REMOTE' : workplace === 'hybrid' ? 'HYBRID' : workplace === 'onsite' ? 'ONSITE' : null,
        employmentType: commitment ? (/intern/i.test(commitment) ? 'INTERNSHIP' : /contract/i.test(commitment) ? 'CONTRACT' : /part/i.test(commitment) ? 'PART_TIME' : /full/i.test(commitment) ? 'FULL_TIME' : null) : null,
        salaryMin: raw.salaryRange?.min ?? null,
        salaryMax: raw.salaryRange?.max ?? null,
        salaryCurrency: raw.salaryRange?.currency ?? null,
        salaryPeriod: raw.salaryRange?.interval ? (/hour/i.test(raw.salaryRange.interval) ? 'HOUR' : /month/i.test(raw.salaryRange.interval) ? 'MONTH' : 'YEAR') : null,
        postedAt: raw.createdAt ? new Date(raw.createdAt) : null,
        raw: { id: raw.id, site },
      }),
    );
  }
}
