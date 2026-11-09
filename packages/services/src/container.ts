import type { AIProviderRegistry } from '@autoapply/ai-providers';
import { createDb, type Database, type DbHandle } from '@autoapply/database';
import { PlatformRegistry, type BrowserFormDriver } from '@autoapply/platform-integrations';
import { AIService } from './ai';
import { ApplicationService } from './applications';
import { BillingService, ManualPaymentProvider, StripePaymentProvider } from './billing';
import { createStorage, SecretBox, type StorageService } from './infra';
import { DiscoveryService, DocumentProcessingService, JobIngestService, MatchService } from './jobs';
import { AuditService, createMailer, NotificationService, SettingsService, UsageService, type Mailer } from './platform';
import { ProfileService } from './profile';
import { QUEUES, QueueClient, redisConnection } from './queues';

export interface ContainerOptions {
  databaseUrl?: string;
  redisUrl?: string;
  db?: DbHandle;
  storage?: StorageService;
  mailer?: Mailer;
  browser?: BrowserFormDriver;
  registry?: PlatformRegistry;
  fetchImpl?: typeof fetch;
  queues?: QueueClient | null;
  allowMockAi?: boolean;
  /** Override the AI provider registry (tests inject scripted mock providers). */
  aiRegistry?: AIProviderRegistry;
}

/** Wires all domain services (used by both the API and the workers). */
export function createContainer(opts: ContainerOptions = {}) {
  const handle = opts.db ?? createDb(opts.databaseUrl ?? process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5432/autoapply');
  const db: Database = handle.db;
  const keyring = process.env.ENCRYPTION_KEYS;
  if (!keyring) throw new Error('ENCRYPTION_KEYS is required (generate with: openssl rand -base64 32)');
  const box = new SecretBox(keyring);
  const storage = opts.storage ?? createStorage();
  const mailer = opts.mailer ?? createMailer();
  const queues = opts.queues === null ? null : (opts.queues ?? new QueueClient(redisConnection(opts.redisUrl)));
  const registry = opts.registry ?? new PlatformRegistry();
  const settings = new SettingsService(db);
  const audit = new AuditService(db);
  const usage = new UsageService(db);
  const notifications = new NotificationService(db, mailer, queues ? async (id) => void (await queues.add(QUEUES.NOTIFICATIONS, { notificationId: id }, { idempotencyKey: `notify:${id}` })) : undefined);
  const payments = process.env.PAYMENT_PROVIDER === 'stripe' ? new StripePaymentProvider() : new ManualPaymentProvider();
  const billing = new BillingService(db, payments);
  const ai = new AIService({ db, box, usage, allowMock: opts.allowMockAi ?? process.env.NODE_ENV !== 'production', registry: opts.aiRegistry });
  const profiles = new ProfileService(db);
  const ingest = new JobIngestService(db);
  const matcher = new MatchService(db, profiles, settings);
  const documents = new DocumentProcessingService(db, storage, ai, profiles, notifications);
  const discovery = new DiscoveryService(db, box, registry, ingest, matcher, usage, notifications, { fetchImpl: opts.fetchImpl });
  const applications = new ApplicationService({
    db,
    box,
    storage,
    registry,
    ai,
    profiles,
    usage,
    notifications,
    audit,
    browser: opts.browser,
    fetchImpl: opts.fetchImpl,
    enqueuePrepare: queues ? async (id, userId) => void (await queues.add(QUEUES.APPLICATION_PREP, { applicationId: id, userId }, { idempotencyKey: `prep:${id}:${Date.now()}` })) : undefined,
    enqueueSubmit: queues ? async (id, userId) => void (await queues.add(QUEUES.APPLICATION_SUBMIT, { applicationId: id, userId }, { idempotencyKey: `submit:${id}:${Date.now()}` })) : undefined,
  });
  return { handle, db, box, storage, mailer, queues, registry, settings, audit, usage, notifications, billing, payments, ai, profiles, ingest, matcher, documents, discovery, applications };
}

export type Container = ReturnType<typeof createContainer>;
