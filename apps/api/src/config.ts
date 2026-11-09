import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .optional()
  .transform((v) => v === 'true' || v === '1');

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  ENCRYPTION_KEYS: z.string().min(40, 'ENCRYPTION_KEYS must contain at least one base64 32-byte key'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  COOKIE_SECURE: bool,
  COOKIE_DOMAIN: z.string().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  REQUIRE_EMAIL_VERIFICATION: bool,
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(50).default(10),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(300),
  EXTENSION_ORIGINS: z.string().default(''),
});
export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const r = configSchema.safeParse(env);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  if (r.data.NODE_ENV === 'production' && !r.data.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production');
  return r.data;
}
