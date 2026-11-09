import { sql } from 'drizzle-orm';
import { createDb } from './client';
import { runMigrations } from './migrate';
import { seedDatabase } from './seed';

/** Drops and recreates the schema, applies all migrations and seeds defaults. Test/dev only. */
export async function resetDatabase(url: string): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('resetDatabase is disabled in production');
  const h = createDb(url, { max: 1 });
  try {
    await h.db.execute(sql.raw('drop schema if exists drizzle cascade; drop schema if exists public cascade; create schema public;'));
  } finally {
    await h.close();
  }
  await runMigrations(url);
  const h2 = createDb(url, { max: 1 });
  try {
    await seedDatabase(h2.db);
  } finally {
    await h2.close();
  }
}
