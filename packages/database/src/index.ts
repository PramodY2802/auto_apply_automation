export * from './schema';
export * from './client';
export { runMigrations } from './migrate';
export { seedDatabase, DEFAULT_PLANS, DEFAULT_AI_PROVIDERS, DEFAULT_MATCHING_WEIGHTS } from './seed';
export { sql, eq, and, or, not, inArray, desc, asc, isNull, isNotNull, gte, lte, gt, lt, ilike, count, sum, ne } from 'drizzle-orm';
export type { SQL } from 'drizzle-orm';
export { resetDatabase } from './testing';
