import { sql } from 'drizzle-orm';
import { PERMISSIONS, ROLE_DEFS, type PlanFeatures, type PlanLimits } from '@autoapply/shared';
import { createDb, type Database } from './client';
import { aiProviders, permissions, plans, platformSettings, rolePermissions, roles, type AIModelPricing } from './schema';

export const DEFAULT_PLANS: {
  key: string;
  name: string;
  priceMonthlyCents: number;
  priceAnnualCents: number;
  limits: PlanLimits;
  features: PlanFeatures;
  aiMarkupPercent: number;
  sortOrder: number;
}[] = [
  {
    key: 'free',
    name: 'Free',
    priceMonthlyCents: 0,
    priceAnnualCents: 0,
    limits: { users: 1, searchesPerMonth: 30, applicationsPerMonth: 10, aiTokensPerMonth: 100_000, storageMb: 50, browserMinutesPerMonth: 30 },
    features: { autoApply: false, byoAiKey: false, enterprise: false, extension: true, scheduledSearch: false },
    aiMarkupPercent: 0,
    sortOrder: 0,
  },
  {
    key: 'basic',
    name: 'Basic',
    priceMonthlyCents: 1500,
    priceAnnualCents: 15000,
    limits: { users: 1, searchesPerMonth: 300, applicationsPerMonth: 100, aiTokensPerMonth: 1_000_000, storageMb: 200, browserMinutesPerMonth: 300 },
    features: { autoApply: false, byoAiKey: true, enterprise: false, extension: true, scheduledSearch: true },
    aiMarkupPercent: 20,
    sortOrder: 1,
  },
  {
    key: 'pro',
    name: 'Pro',
    priceMonthlyCents: 3900,
    priceAnnualCents: 39000,
    limits: { users: 1, searchesPerMonth: 2000, applicationsPerMonth: 600, aiTokensPerMonth: 5_000_000, storageMb: 1000, browserMinutesPerMonth: 2000 },
    features: { autoApply: true, byoAiKey: true, enterprise: false, extension: true, scheduledSearch: true },
    aiMarkupPercent: 20,
    sortOrder: 2,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    priceMonthlyCents: 29900,
    priceAnnualCents: 299000,
    limits: { users: 50, searchesPerMonth: 50_000, applicationsPerMonth: 20_000, aiTokensPerMonth: 100_000_000, storageMb: 20_000, browserMinutesPerMonth: 50_000 },
    features: { autoApply: true, byoAiKey: true, enterprise: true, extension: true, scheduledSearch: true },
    aiMarkupPercent: 15,
    sortOrder: 3,
  },
];

/**
 * Default model catalog. Prices are per 1M tokens in USD and are DEFAULTS ONLY —
 * they change frequently; Super Admins must verify and edit them in the admin panel.
 */
export const DEFAULT_AI_PROVIDERS: { key: string; name: string; baseUrl: string | null; models: AIModelPricing[] }[] = [
  {
    key: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', inputPer1M: 0.4, outputPer1M: 1.6 },
      { id: 'gpt-4.1', label: 'GPT-4.1', inputPer1M: 2, outputPer1M: 8 },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', inputPer1M: 0.15, outputPer1M: 0.6 },
    ],
  },
  {
    key: 'anthropic',
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', inputPer1M: 3, outputPer1M: 15 },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', inputPer1M: 1, outputPer1M: 5 },
    ],
  },
  {
    key: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', inputPer1M: 0.3, outputPer1M: 2.5 },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', inputPer1M: 1.25, outputPer1M: 10 },
    ],
  },
  {
    key: 'mock',
    name: 'Mock (development only)',
    baseUrl: null,
    models: [{ id: 'mock-deterministic', label: 'Deterministic mock', inputPer1M: 0, outputPer1M: 0 }],
  },
];

export const DEFAULT_MATCHING_WEIGHTS = { skill: 0.45, experience: 0.2, location: 0.15, preference: 0.1, salary: 0.1 };

export async function seedDatabase(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [key, description] of Object.entries(PERMISSIONS)) {
      await tx.insert(permissions).values({ key, description }).onConflictDoUpdate({ target: permissions.key, set: { description } });
    }
    for (const r of ROLE_DEFS) {
      await tx
        .insert(roles)
        .values({ key: r.key, name: r.name, scope: r.scope, description: r.name })
        .onConflictDoUpdate({ target: roles.key, set: { name: r.name, scope: r.scope } });
      for (const p of r.permissions) {
        await tx.insert(rolePermissions).values({ roleKey: r.key, permissionKey: p }).onConflictDoNothing();
      }
    }
    for (const p of DEFAULT_PLANS) {
      await tx.insert(plans).values({ ...p, currency: 'USD' }).onConflictDoNothing({ target: plans.key });
    }
    for (const p of DEFAULT_AI_PROVIDERS) {
      await tx.insert(aiProviders).values(p).onConflictDoNothing({ target: aiProviders.key });
    }
    const settings: Record<string, unknown> = {
      'matching.weights': DEFAULT_MATCHING_WEIGHTS,
      'limits.global': { maxConcurrentBrowserSessions: 4, maxApplicationsPerUserPerDay: 50, discoveryMaxJobsPerPlatform: 100 },
      'features.registrationOpen': true,
      'ai.allowMockProvider': process.env.NODE_ENV !== 'production',
    };
    for (const [key, value] of Object.entries(settings)) {
      await tx.insert(platformSettings).values({ key, value }).onConflictDoNothing({ target: platformSettings.key });
    }
    await tx.execute(sql`select 1`);
  });
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const h = createDb(url, { max: 1 });
  seedDatabase(h.db)
    .then(() => console.log('Seed complete'))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => h.close());
}
