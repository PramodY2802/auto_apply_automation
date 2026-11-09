import type { NormalizedJob, PlatformKey } from '@autoapply/shared';
import { normalizeJobPosting } from '../jsonld';
import type { CapabilityMatrix, ConnectionResult, PlatformContext } from '../types';
import { BaseAdapter } from './base';

/**
 * Adapters for platforms with no public job-search or apply API for third
 * parties, whose terms prohibit scraping/automated applying:
 *  - The user signs in to the platform themselves, in their own browser.
 *  - The browser extension captures the job page the user is viewing
 *    (schema.org JobPosting JSON-LD / visible page data) and sends it here.
 *  - Answers are prepared in-app; the extension fills fields in the user's tab;
 *    the user reviews and clicks submit. Nothing runs headless on these sites.
 * Automated search/submit can be enabled later through an official partner API.
 */
abstract class AssistedAdapter extends BaseAdapter {
  protected abstract readonly loginUrl: string;
  protected abstract readonly partnerNote: string;

  get capabilities(): CapabilityMatrix {
    return {
      authenticate: { status: 'USER_ASSISTED', note: 'Sign in yourself (including any MFA) in your own browser; we never store your password' },
      searchJobs: { status: 'UNSUPPORTED', note: `No public search API; automated searching/scraping is not permitted. ${this.partnerNote}` },
      fetchJobDetails: { status: 'USER_ASSISTED', note: 'Captured by the browser extension from the job page you are viewing' },
      getApplicationForm: { status: 'USER_ASSISTED', note: 'The extension reads the application form in your tab' },
      fillApplicationForm: { status: 'USER_ASSISTED', note: 'The extension fills approved answers in your tab' },
      submitApplication: { status: 'USER_ASSISTED', note: 'You review and click submit; the extension reports the confirmation' },
      checkApplicationStatus: { status: 'USER_ASSISTED', note: 'Status updates are user-confirmed (or reported by the extension)' },
    };
  }

  override async authenticate(_ctx: PlatformContext): Promise<ConnectionResult> {
    return {
      status: 'PENDING_USER_ACTION',
      message: `Sign in to ${this.displayName} in your browser and install the AutoApply extension. Your session stays in your browser.`,
      userAction: { type: 'INSTALL_EXTENSION', url: this.loginUrl, instructions: `Open ${this.loginUrl}, sign in, then click "Mark connected" in the extension popup.` },
    };
  }

  override async validateConnection(ctx: PlatformContext): Promise<ConnectionResult> {
    const lastSeen = ctx.settings.extensionLastSeenAt as string | undefined;
    if (lastSeen && Date.now() - new Date(lastSeen).getTime() < 14 * 86_400_000) {
      return { status: 'CONNECTED', message: `Extension reported an active ${this.displayName} session` };
    }
    return this.authenticate(ctx);
  }

  normalizeJob(raw: any): NormalizedJob {
    return normalizeJobPosting({ jsonLd: raw?.jsonLd, captured: raw?.captured, url: raw?.url ?? raw?.captured?.url, platform: this.key as PlatformKey });
  }
}

export class LinkedInAdapter extends AssistedAdapter {
  readonly key = 'linkedin' as const;
  readonly displayName = 'LinkedIn';
  protected readonly loginUrl = 'https://www.linkedin.com/login';
  protected readonly partnerNote = 'Requires LinkedIn Talent/Partner program approval.';
}

export class IndeedAdapter extends AssistedAdapter {
  readonly key = 'indeed' as const;
  readonly displayName = 'Indeed';
  protected readonly loginUrl = 'https://secure.indeed.com/account/login';
  protected readonly partnerNote = 'Indeed\'s publisher job search API is closed to new integrations; requires partner approval.';
}

export class NaukriAdapter extends AssistedAdapter {
  readonly key = 'naukri' as const;
  readonly displayName = 'Naukri';
  protected readonly loginUrl = 'https://www.naukri.com/nlogin/login';
  protected readonly partnerNote = 'Requires a licensed Naukri (Info Edge) data/partner agreement.';
}
