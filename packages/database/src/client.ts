import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** Either the root db or a transaction handle. */
export type DbExecutor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DbHandle {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

export function createDb(url: string, opts: Partial<PoolConfig> = {}): DbHandle {
  const pool = new Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX ?? 10), ...opts });
  const db = drizzle(pool, { schema, casing: undefined });
  return { db, pool, close: () => pool.end() };
}
