import { INTEGRATION_OPERATIONS, type PlatformKey, type PreferredLocation, type WorkMode } from '@autoapply/shared';
import { IndeedAdapter, LinkedInAdapter, NaukriAdapter } from './adapters/assisted';
import { GreenhouseAdapter, LeverAdapter } from './adapters/public-boards';
import { SandboxAdapter } from './adapters/sandbox';
import type { PlatformAdapter, SearchQuery } from './types';

export class PlatformRegistry {
  private readonly adapters = new Map<PlatformKey, PlatformAdapter>();

  constructor(adapters: PlatformAdapter[] = [new SandboxAdapter(), new GreenhouseAdapter(), new LeverAdapter(), new LinkedInAdapter(), new IndeedAdapter(), new NaukriAdapter()]) {
    for (const a of adapters) this.adapters.set(a.key, a);
  }

  register(a: PlatformAdapter): void {
    this.adapters.set(a.key, a);
  }

  get(key: PlatformKey): PlatformAdapter {
    const a = this.adapters.get(key);
    if (!a) throw new Error(`Unknown platform: ${key}`);
    return a;
  }

  list(): PlatformAdapter[] {
    return [...this.adapters.values()];
  }

  /** Capability matrix for the UI / docs. */
  describe() {
    return this.list().map((a) => ({
      key: a.key,
      name: a.displayName,
      capabilities: Object.fromEntries(INTEGRATION_OPERATIONS.map((op) => [op, a.capabilities[op]])),
      supportsAutomatedSearch: a.capabilities.searchJobs.status === 'IMPLEMENTED' || a.capabilities.searchJobs.status === 'AWAITING_CREDENTIALS',
      supportsAutomatedSubmit: a.capabilities.submitApplication.status === 'IMPLEMENTED',
    }));
  }
}

/** Builds platform search queries from candidate preferences (one per title × location). */
export function buildSearchQueries(prefs: {
  titles: string[];
  locations: PreferredLocation[];
  workModes: WorkMode[];
  maxPostingAgeDays: number | null;
  keywords: string[];
}): SearchQuery[] {
  const locs = prefs.locations.length ? prefs.locations.map((l) => l.city ?? l.state ?? l.country ?? null) : [null];
  const remoteOnly = prefs.workModes.length === 1 && prefs.workModes[0] === 'REMOTE';
  const out: SearchQuery[] = [];
  const seen = new Set<string>();
  for (const title of prefs.titles.slice(0, 10)) {
    for (const loc of remoteOnly ? [null] : locs.slice(0, 5)) {
      const key = `${title.toLowerCase()}|${loc ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ keywords: title, location: loc, workModes: prefs.workModes, postedWithinDays: prefs.maxPostingAgeDays, limit: 50 });
    }
  }
  return out;
}
