import { normalizedJobSchema, type CapturedJob, type EmploymentType, type NormalizedJob, type PlatformKey } from '@autoapply/shared';
import { enrichJob, htmlToText, parseSalary } from '@autoapply/matching-engine';

const EMPLOYMENT_MAP: Record<string, EmploymentType> = {
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  CONTRACTOR: 'CONTRACT',
  CONTRACT: 'CONTRACT',
  TEMPORARY: 'TEMPORARY',
  INTERN: 'INTERNSHIP',
  INTERNSHIP: 'INTERNSHIP',
  PER_DIEM: 'TEMPORARY',
};

export function platformFromUrl(url: string): PlatformKey | null {
  const h = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (h.endsWith('linkedin.com')) return 'linkedin';
  if (h.includes('indeed.')) return 'indeed';
  if (h.endsWith('naukri.com')) return 'naukri';
  if (h.includes('greenhouse.io')) return 'greenhouse';
  if (h.includes('lever.co')) return 'lever';
  return null;
}

function stableIdFromUrl(url: string): string {
  try {
    const u = new URL(url);
    // Common job id query params on major boards.
    for (const p of ['jk', 'currentJobId', 'jobId', 'gh_jid', 'id']) {
      const v = u.searchParams.get(p);
      if (v) return v;
    }
    const m = /(\d{6,})/.exec(u.pathname);
    if (m) return m[1]!;
    return `${u.hostname}${u.pathname}`.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

/**
 * Normalizes a schema.org JobPosting (JSON-LD), as published by most job boards
 * for search engines, or a CapturedJob sent by the browser extension.
 */
export function normalizeJobPosting(input: { jsonLd?: any; captured?: CapturedJob; url: string; platform?: PlatformKey | null }): NormalizedJob {
  const ld = input.jsonLd ?? {};
  const cap = input.captured;
  const platform = input.platform ?? cap?.platformHint ?? platformFromUrl(input.url) ?? 'sandbox';
  const org = ld.hiringOrganization;
  const company = cap?.company ?? (typeof org === 'string' ? org : org?.name) ?? 'Unknown company';
  const addr = Array.isArray(ld.jobLocation) ? ld.jobLocation[0]?.address : ld.jobLocation?.address;
  const city = addr?.addressLocality ?? null;
  const country = typeof addr?.addressCountry === 'string' ? addr.addressCountry : (addr?.addressCountry?.name ?? null);
  const location = cap?.location ?? ([city, addr?.addressRegion, country].filter(Boolean).join(', ') || null);
  const remote = ld.jobLocationType === 'TELECOMMUTE';
  const et = Array.isArray(ld.employmentType) ? ld.employmentType[0] : ld.employmentType ?? cap?.employmentType;
  const sal = ld.baseSalary?.value;
  const salaryFromText = parseSalary(cap?.salaryText);
  const description = cap?.description ?? (ld.description ? htmlToText(String(ld.description)) : '');
  const base = normalizedJobSchema.parse({
    platform,
    externalId: String(cap?.externalId ?? ld.identifier?.value ?? ld.identifier ?? stableIdFromUrl(input.url)).slice(0, 300),
    url: input.url,
    applyUrl: ld.directApply === false ? null : null,
    title: (cap?.title ?? ld.title ?? 'Untitled role').slice(0, 300),
    company: String(company).slice(0, 300),
    description,
    location,
    city,
    country,
    workMode: remote ? 'REMOTE' : null,
    employmentType: et ? EMPLOYMENT_MAP[String(et).toUpperCase().replace(/[- ]/g, '_')] ?? null : null,
    salaryMin: typeof sal?.minValue === 'number' ? sal.minValue : typeof sal?.value === 'number' ? sal.value : salaryFromText.min,
    salaryMax: typeof sal?.maxValue === 'number' ? sal.maxValue : salaryFromText.max,
    salaryCurrency: ld.baseSalary?.currency ?? salaryFromText.currency,
    salaryPeriod: sal?.unitText ? ({ YEAR: 'YEAR', MONTH: 'MONTH', HOUR: 'HOUR' } as const)[String(sal.unitText).toUpperCase() as 'YEAR'] ?? null : salaryFromText.period,
    postedAt: cap?.postedAt ?? ld.datePosted ?? null,
    raw: input.jsonLd ? { jsonLd: true } : { captured: true },
  });
  return enrichJob(base);
}
