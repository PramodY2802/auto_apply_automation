import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { createDb, resetDatabase, users } from '@autoapply/database';
import { LogMailer, QueueClient, createContainer, redisConnection, type Container } from '@autoapply/services';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { ApiClient } from './client';

export const DB_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5432/autoapply_test';
export const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/4';
export const PASSWORD = 'Correct-horse-9';

export interface Harness {
  app: INestApplication;
  url: string;
  c: Container;
  mailer: LogMailer;
  client: () => ApiClient;
  signup: (email: string, extra?: Record<string, unknown>) => Promise<ApiClient>;
  createAdmin: (email: string, role: 'SUPER_ADMIN' | 'PLATFORM_ADMIN') => Promise<ApiClient>;
  close: () => Promise<void>;
}

export async function startHarness(opts: { rateLimit?: boolean } = {}): Promise<Harness> {
  process.env.DISABLE_RATE_LIMIT = opts.rateLimit ? 'false' : 'true';
  await resetDatabase(DB_URL);
  const redis = redisConnection(REDIS_URL);
  await redis.flushdb();
  redis.disconnect();
  const mailer = new LogMailer();
  const c = createContainer({ databaseUrl: DB_URL, queues: new QueueClient(redisConnection(REDIS_URL)), mailer });
  const config = loadConfig({ ...process.env, NODE_ENV: 'test', DATABASE_URL: DB_URL, REDIS_URL, RATE_LIMIT_PER_MINUTE: '100000' });
  const app = await createApp({ config, container: c });
  await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  const client = () => new ApiClient(url);
  return {
    app,
    url,
    c,
    mailer,
    client,
    async signup(email, extra = {}) {
      const cl = client();
      const r = await cl.post('/auth/signup', { email, password: PASSWORD, fullName: email.split('@')[0], ...extra });
      if (r.status !== 201) throw new Error(`signup failed ${r.status} ${JSON.stringify(r.body)}`);
      return cl;
    },
    async createAdmin(email, role) {
      const h = createDb(DB_URL, { max: 1 });
      await h.db.insert(users).values({ email, fullName: role, platformRole: role, emailVerifiedAt: new Date(), passwordHash: await hash(PASSWORD) });
      await h.close();
      const cl = client();
      const r = await cl.post('/auth/login', { email, password: PASSWORD });
      if (r.status !== 200) throw new Error('admin login failed');
      return cl;
    },
    async close() {
      await app.close();
    },
  };
}
