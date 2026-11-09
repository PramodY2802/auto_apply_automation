import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { redactForLog } from '@autoapply/shared';

// ---------------------------------------------------------------------------
// Secrets: AES-256-GCM envelope "v1:<keyId>:<iv>:<tag>:<ciphertext>" (base64url).
// ---------------------------------------------------------------------------
export class SecretBox {
  private readonly keys = new Map<string, Buffer>();
  private readonly currentId: string;

  /**
   * @param keyring "id1:base64key,id2:base64key" — first entry encrypts; all decrypt (key rotation).
   *                A bare base64 key is accepted as id "k1".
   */
  constructor(keyring: string) {
    const entries = keyring.split(',').map((s) => s.trim()).filter(Boolean);
    if (!entries.length) throw new Error('ENCRYPTION_KEYS is empty');
    for (const e of entries) {
      const [id, b64] = e.includes(':') ? e.split(':') : ['k1', e];
      const key = Buffer.from(b64!, 'base64');
      if (key.length !== 32) throw new Error(`Encryption key "${id}" must be 32 bytes (base64)`);
      this.keys.set(id!, key);
    }
    this.currentId = entries[0]!.includes(':') ? entries[0]!.split(':')[0]! : 'k1';
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.keys.get(this.currentId)!, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', this.currentId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join(':');
  }

  decrypt(envelope: string): string {
    const [v, id, iv, tag, ct] = envelope.split(':');
    if (v !== 'v1' || !id || !iv || !tag || ct === undefined) throw new Error('Malformed secret envelope');
    const key = this.keys.get(id);
    if (!key) throw new Error(`Unknown encryption key id "${id}"`);
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
  }

  encryptJson(v: unknown): string {
    return this.encrypt(JSON.stringify(v));
  }
  decryptJson<T>(env: string): T {
    return JSON.parse(this.decrypt(env)) as T;
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Tokens (sessions, resets, invitations, API tokens) are stored only as SHA-256 hashes. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Structured logging with redaction of secrets & PII.
// ---------------------------------------------------------------------------
const SENSITIVE_KEYS = /(pass(word)?|secret|token|api[_-]?key|authorization|cookie|session|credential|storage_?state|csrf)/i;

export function redactObject(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof v === 'string') return redactForLog(v).slice(0, 2000);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redactObject(x, depth + 1));
  if (v instanceof Error) return { name: v.name, message: redactForLog(v.message) };
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : redactObject(val, depth + 1);
    return out;
  }
  return v;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export function createLogger(service: string, bindings: Record<string, unknown> = {}): Logger {
  const level = process.env.LOG_LEVEL ?? 'info';
  const order = { debug: 10, info: 20, warn: 30, error: 40 } as const;
  const emit = (lvl: keyof typeof order, msg: string, data?: Record<string, unknown>) => {
    if (order[lvl] < (order[level as keyof typeof order] ?? 20)) return;
    if (process.env.NODE_ENV === 'test' && lvl !== 'error' && !process.env.LOG_IN_TESTS) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, service, msg: redactForLog(msg), ...(redactObject({ ...bindings, ...data }) as object) });
    (lvl === 'error' ? process.stderr : process.stdout).write(line + '\n');
  };
  return {
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
    debug: (m, d) => emit('debug', m, d),
    child: (b) => createLogger(service, { ...bindings, ...b }),
  };
}

// ---------------------------------------------------------------------------
// Object storage (S3-compatible in production, local filesystem in development).
// ---------------------------------------------------------------------------
export interface StorageService {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export class LocalStorage implements StorageService {
  readonly driver = 'local' as const;
  constructor(private readonly root: string) {}
  private resolve(key: string): string {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, body: Buffer): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    await fs.writeFile(p, body, { mode: 0o600 });
  }
  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }
  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }
}

export class S3Storage implements StorageService {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  constructor(private readonly bucket: string, opts: { region: string; endpoint?: string; accessKeyId?: string; secretAccessKey?: string; forcePathStyle?: boolean }) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.accessKeyId && opts.secretAccessKey ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
    });
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }));
  }
  async get(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function createStorage(env: NodeJS.ProcessEnv = process.env): StorageService {
  if (env.STORAGE_DRIVER === 's3') {
    if (!env.S3_BUCKET) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
    return new S3Storage(env.S3_BUCKET, {
      region: env.S3_REGION ?? 'us-east-1',
      endpoint: env.S3_ENDPOINT || undefined,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    });
  }
  return new LocalStorage(env.LOCAL_STORAGE_PATH ?? path.resolve(process.cwd(), 'storage'));
}
