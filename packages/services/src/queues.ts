import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import IORedis from 'ioredis';

/** Queue topology. Each worker process subscribes to a subset (WORKER_QUEUES env). */
export const QUEUES = {
  DOCUMENTS: 'document-processing',
  DISCOVERY: 'job-discovery',
  MATCHING: 'job-matching',
  APPLICATION_PREP: 'application-preparation',
  APPLICATION_SUBMIT: 'application-submission',
  APPLICATION_SYNC: 'application-sync',
  NOTIFICATIONS: 'notifications',
  BILLING: 'billing',
  SCHEDULER: 'scheduler',
  DEAD_LETTER: 'dead-letter',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export interface JobPayloads {
  [QUEUES.DOCUMENTS]: { extractionId: string; userId: string };
  [QUEUES.DISCOVERY]: { runId: string; userId: string };
  [QUEUES.MATCHING]: { userId: string; jobIds?: string[] };
  [QUEUES.APPLICATION_PREP]: { applicationId: string; userId: string };
  [QUEUES.APPLICATION_SUBMIT]: { applicationId: string; userId: string };
  [QUEUES.APPLICATION_SYNC]: { applicationId?: string; userId?: string };
  [QUEUES.NOTIFICATIONS]: { notificationId: string };
  [QUEUES.BILLING]: { type: 'RENEWALS' | 'AI_USAGE_INVOICES'; periodKey?: string };
  [QUEUES.SCHEDULER]: { type: 'SCHEDULED_DISCOVERY' | 'AUTO_APPLY' | 'SYNC_ALL' };
  [QUEUES.DEAD_LETTER]: { queue: string; jobId: string; name: string; data: unknown; failedReason: string; attemptsMade: number };
}

/** Default retry/backoff policy per queue. Browser submissions are NOT auto-retried (avoid duplicate submits). */
export const DEFAULT_JOB_OPTIONS: Record<QueueName, JobsOptions> = {
  [QUEUES.DOCUMENTS]: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  [QUEUES.DISCOVERY]: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  [QUEUES.MATCHING]: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  [QUEUES.APPLICATION_PREP]: { attempts: 2, backoff: { type: 'exponential', delay: 15_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  [QUEUES.APPLICATION_SUBMIT]: { attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 },
  [QUEUES.APPLICATION_SYNC]: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  [QUEUES.NOTIFICATIONS]: { attempts: 5, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  [QUEUES.BILLING]: { attempts: 5, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 100, removeOnFail: 1000 },
  [QUEUES.SCHEDULER]: { attempts: 1, removeOnComplete: 100, removeOnFail: 1000 },
  [QUEUES.DEAD_LETTER]: { attempts: 1, removeOnComplete: false, removeOnFail: false },
};

export function redisConnection(url = process.env.REDIS_URL ?? 'redis://localhost:6379'): IORedis {
  return new IORedis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
}

/** Producer used by the API and workers to enqueue jobs. */
export class QueueClient {
  private readonly queues = new Map<QueueName, Queue>();
  constructor(private readonly connection: ConnectionOptions) {}

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS[name] });
      this.queues.set(name, q);
    }
    return q;
  }

  /**
   * Enqueue with an idempotency key (BullMQ jobId) — the same logical operation
   * cannot be queued twice while a previous one exists.
   */
  async add<Q extends keyof JobPayloads>(name: Q, data: JobPayloads[Q], opts: JobsOptions & { idempotencyKey?: string } = {}) {
    const { idempotencyKey, ...rest } = opts;
    return this.queue(name as QueueName).add(name, data, { ...rest, jobId: idempotencyKey ? idempotencyKey.replace(/:/g, '_') : undefined });
  }

  async counts() {
    const out: Record<string, Record<string, number>> = {};
    for (const name of Object.values(QUEUES)) {
      out[name] = await this.queue(name).getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused');
    }
    return out;
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
