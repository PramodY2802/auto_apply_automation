/**
 * Bootstrap a Super Admin account:
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='…' node dist/cli/create-admin.js
 */
import { hash } from '@node-rs/argon2';
import { createDb, eq, users } from '@autoapply/database';
import { passwordSchema } from '@autoapply/shared';

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  passwordSchema.parse(password);
  const h = createDb(process.env.DATABASE_URL!, { max: 1 });
  try {
    const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const [existing] = await h.db.select().from(users).where(eq(users.email, email));
    if (existing) {
      await h.db.update(users).set({ platformRole: 'SUPER_ADMIN', passwordHash, status: 'ACTIVE' }).where(eq(users.id, existing.id));
      console.log(`Promoted ${email} to SUPER_ADMIN`);
    } else {
      await h.db.insert(users).values({ email, passwordHash, fullName: process.env.ADMIN_NAME ?? 'Super Admin', platformRole: 'SUPER_ADMIN', emailVerifiedAt: new Date() });
      console.log(`Created SUPER_ADMIN ${email}`);
    }
  } finally {
    await h.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
