import os from 'node:os';
import { Worker, type Job, type Processor } from 'bullmq';
import type IORedis from 'ioredis';
import {
  and,
  applications,
  candidatePreferences,
  enterpriseMembers,
  eq,
  inArray,
  isNotNull,
  jobDiscoveryRuns,
  lte,
  ne,
  sql,
} from '@autoapply/database';
import { QUEUES, createLogger, periodKey, type Container, type JobPayloads, type QueueName } from '@autoapply/services';
import type { PlatformKey } from '@autoapply/shared';

const logger = createLogger('workers');

/** Processor functions per queue — pure functions of the container (reused by tests). */
export function createProcessors(c: Container): Record<QueueName, Processor> {
  return {
    [QUEUES.DOCUMENTS]: async (job: Job<JobPayloads['document-processing']>) => {
      await c.documents.process(job.data.extractionId);
    },
    [QUEUES.DISCOVERY]: async (job: Job<JobPayloads['job-discovery']>) => {
      await c.discovery.run(job.data.runId);
    },
    [QUEUES.MATCHING]: async (job: Job<JobPayloads['job-matching']>) => {
      return c.matcher.scoreForUser(job.data.userId, job.data.jobIds);
    },
    [QUEUES.APPLICATION_PREP]: async (job: Job<JobPayloads['application-preparation']>) => {
      await c.applications.prepare(job.data.applicationId);
    },
    [QUEUES.APPLICATION_SUBMIT]: async (job: Job<JobPayloads['application-submission']>) => {
      return { outcome: await c.applications.submit(job.data.applicationId) };
    },
    [QUEUES.APPLICATION_SYNC]: async (job: Job<JobPayloads['application-sync']>) => {
      if (job.data.applicationId) return c.applications.sync(job.data.applicationId);
      const rows = await c.db
        .select({ id: applications.id })
        .from(applications)
        .where(and(inArray(applications.status, ['APPLIED', 'INTERVIEW', 'NEEDS_VERIFICATION', 'UNKNOWN', 'IN_PROGRESS']), sql`coalesce(${applications.lastSyncedAt}, ${applications.updatedAt}) < now() - interval '6 hours'`))
        .limit(500);
      for (const r of rows) await c.queues!.add(QUEUES.APPLICATION_SYNC, { applicationId: r.id }, { idempotencyKey: `sync:${r.id}:${Math.floor(Date.now() / 3600_000)}` });
      return { queued: rows.length };
    },
    [QUEUES.NOTIFICATIONS]: async (job: Job<JobPayloads['notifications']>) => {
      await c.notifications.deliver(job.data.notificationId);
    },
    [QUEUES.BILLING]: async (job: Job<JobPayloads['billing']>) => {
      if (job.data.type === 'RENEWALS') return c.billing.processRenewals();
      const prev = new Date();
      prev.setUTCMonth(prev.getUTCMonth() - 1);
      return { issued: await c.billing.issueAiUsageInvoices(job.data.periodKey ?? periodKey(prev)) };
    },
    [QUEUES.SCHEDULER]: async (job: Job<JobPayloads['scheduler']>) => {
      if (job.data.type === 'SCHEDULED_DISCOVERY') return scheduleDiscovery(c);
      if (job.data.type === 'AUTO_APPLY') return scheduleAutoApply(c);
      if (job.data.type === 'SYNC_ALL') {
        await c.queues!.add(QUEUES.APPLICATION_SYNC, {}, { idempotencyKey: `sync-all:${Math.floor(Date.now() / 3600_000)}` });
        return {};
      }
    },
    [QUEUES.DEAD_LETTER]: async () => undefined,
  };
}

/** Creates discovery runs for users whose scheduled search is due (plan permitting). */
export async function scheduleDiscovery(c: Container): Promise<{ scheduled: number }> {
  const due = await c.db
    .select({ id: candidatePreferences.id, userId: candidatePreferences.userId, platforms: candidatePreferences.platforms, freq: candidatePreferences.searchFrequency })
    .from(candidatePreferences)
    .where(and(ne(candidatePreferences.searchFrequency, 'MANUAL'), isNotNull(candidatePreferences.nextSearchAt), lte(candidatePreferences.nextSearchAt, new Date())))
    .limit(200);
  let scheduled = 0;
  for (const p of due) {
    const [m] = await c.db.select({ e: enterpriseMembers.enterpriseId }).from(enterpriseMembers).where(and(eq(enterpriseMembers.userId, p.userId), eq(enterpriseMembers.status, 'ACTIVE')));
    const actor = { userId: p.userId, enterpriseId: m?.e ?? null };
    // Push the next run forward first so a failing user can't be re-scheduled in a tight loop.
    const hours = { DAILY: 24, TWICE_DAILY: 12, WEEKLY: 168, MANUAL: 24 }[p.freq];
    await c.db.update(candidatePreferences).set({ nextSearchAt: new Date(Date.now() + hours * 3600_000) }).where(eq(candidatePreferences.id, p.id));
    try {
      await c.usage.assertFeature(actor, 'scheduledSearch');
      await c.usage.assertWithin(actor, 'SEARCH');
    } catch (e: any) {
      logger.info('scheduled discovery skipped', { userId: p.userId, reason: e.message });
      continue;
    }
    const [running] = await c.db.select({ id: jobDiscoveryRuns.id }).from(jobDiscoveryRuns).where(and(eq(jobDiscoveryRuns.userId, p.userId), inArray(jobDiscoveryRuns.status, ['QUEUED', 'RUNNING'])));
    if (running) continue;
    const [run] = await c.db.insert(jobDiscoveryRuns).values({ userId: p.userId, enterpriseId: actor.enterpriseId, trigger: 'SCHEDULED', status: 'QUEUED', platforms: p.platforms as PlatformKey[] }).returning();
    await c.queues!.add(QUEUES.DISCOVERY, { runId: run!.id, userId: p.userId }, { idempotencyKey: `discovery:${run!.id}` });
    scheduled++;
  }
  return { scheduled };
}

export async function scheduleAutoApply(c: Container): Promise<{ created: number }> {
  const users = await c.db.select({ userId: candidatePreferences.userId }).from(candidatePreferences).where(and(eq(candidatePreferences.applicationMode, 'AUTOMATIC'), isNotNull(candidatePreferences.autoApplyConsentAt))).limit(500);
  let created = 0;
  for (const u of users) {
    const [m] = await c.db.select({ e: enterpriseMembers.enterpriseId }).from(enterpriseMembers).where(and(eq(enterpriseMembers.userId, u.userId), eq(enterpriseMembers.status, 'ACTIVE')));
    try {
      created += await c.applications.runAutoApply(u.userId, m?.e ?? null);
    } catch (e: any) {
      logger.warn('auto-apply run failed', { userId: u.userId, error: e.message });
    }
  }
  return { created };
}

const CONCURRENCY: Record<QueueName, number> = {
  [QUEUES.DOCUMENTS]: 2,
  [QUEUES.DISCOVERY]: 2,
  [QUEUES.MATCHING]: 4,
  [QUEUES.APPLICATION_PREP]: 2,
  [QUEUES.APPLICATION_SUBMIT]: 2,
  [QUEUES.APPLICATION_SYNC]: 4,
  [QUEUES.NOTIFICATIONS]: 8,
  [QUEUES.BILLING]: 1,
  [QUEUES.SCHEDULER]: 1,
  [QUEUES.DEAD_LETTER]: 1,
};

/** Starts BullMQ workers for the given queues with retries, DLQ routing and structured logs. */
export function startWorkers(c: Container, connection: IORedis, queues: QueueName[]): Worker[] {
  const processors = createProcessors(c);
  return queues
    .filter((q) => q !== QUEUES.DEAD_LETTER)
    .map((name) => {
      const w = new Worker(name, processors[name], { connection, concurrency: Number(process.env[`CONCURRENCY_${name.toUpperCase().replace(/-/g, '_')}`] ?? CONCURRENCY[name]), lockDuration: name === QUEUES.APPLICATION_SUBMIT || name === QUEUES.APPLICATION_PREP ? 5 * 60_000 : 60_000 });
      w.on('completed', (job) => logger.info('job completed', { queue: name, jobId: job.id, ms: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined }));
      w.on('failed', async (job, err) => {
        logger.error('job failed', { queue: name, jobId: job?.id, attempts: job?.attemptsMade, error: err.message });
        if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
          await c.queues!.add(QUEUES.DEAD_LETTER, { queue: name, jobId: String(job.id), name: job.name, data: job.data, failedReason: err.message.slice(0, 500), attemptsMade: job.attemptsMade }).catch(() => undefined);
        }
      });
      w.on('error', (err) => logger.error('worker error', { queue: name, error: err.message }));
      return w;
    });
}

export async function registerSchedules(c: Container): Promise<void> {
  const q = c.queues!;
  await q.queue(QUEUES.SCHEDULER).upsertJobScheduler('scheduled-discovery', { every: 5 * 60_000 }, { name: 'scheduler', data: { type: 'SCHEDULED_DISCOVERY' } });
  await q.queue(QUEUES.SCHEDULER).upsertJobScheduler('auto-apply', { every: 15 * 60_000 }, { name: 'scheduler', data: { type: 'AUTO_APPLY' } });
  await q.queue(QUEUES.SCHEDULER).upsertJobScheduler('sync-all', { every: 60 * 60_000 }, { name: 'scheduler', data: { type: 'SYNC_ALL' } });
  await q.queue(QUEUES.BILLING).upsertJobScheduler('renewals', { every: 60 * 60_000 }, { name: 'billing', data: { type: 'RENEWALS' } });
  await q.queue(QUEUES.BILLING).upsertJobScheduler('ai-usage-invoices', { pattern: '0 3 1 * *' }, { name: 'billing', data: { type: 'AI_USAGE_INVOICES' } });
}

export function startHeartbeat(connection: IORedis, queues: QueueName[]): NodeJS.Timeout {
  const id = `${os.hostname()}:${process.pid}`;
  const beat = () =>
    connection.set(`autoapply:worker:${id}`, JSON.stringify({ id, queues, at: new Date().toISOString(), rssMb: Math.round(process.memoryUsage().rss / 1048576) }), 'EX', 60).catch(() => undefined);
  void beat();
  return setInterval(beat, 20_000);
}
