import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

export async function runMigrations(url: string): Promise<void> {
  const handle = createDb(url, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: path.resolve(__dirname, '../migrations') });
  } finally {
    await handle.close();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  runMigrations(url)
    .then(() => {
      console.log('Migrations applied');
    })
    .catch((err) => {
      console.error('Migration failed', err);
      process.exit(1);
    });
}
