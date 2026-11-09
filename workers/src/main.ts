import { QUEUES, createContainer, createLogger, redisConnection, type QueueName } from '@autoapply/services';
import { PlaywrightFormDriver } from './browser/driver';
import { registerSchedules, startHeartbeat, startWorkers } from './processors';

const logger = createLogger('workers');

/**
 * Worker entrypoint. Run one process per responsibility in production, e.g.
 *   WORKER_QUEUES=document-processing                       (OCR/extraction)
 *   WORKER_QUEUES=job-discovery,job-matching                (discovery)
 *   WORKER_QUEUES=application-preparation,application-submission (browser automation)
 *   WORKER_QUEUES=application-sync,notifications,billing,scheduler
 * or all queues in one process for development.
 */
async function main() {
  const all = Object.values(QUEUES) as QueueName[];
  const queues = (process.env.WORKER_QUEUES ? process.env.WORKER_QUEUES.split(',').map((s) => s.trim()) : all).filter((q): q is QueueName => (all as string[]).includes(q));
  if (!queues.length) throw new Error('WORKER_QUEUES selects no known queues');
  const needsBrowser = queues.some((q) => q === QUEUES.APPLICATION_PREP || q === QUEUES.APPLICATION_SUBMIT);
  const browser = needsBrowser ? new PlaywrightFormDriver() : undefined;
  const connection = redisConnection();
  const container = createContainer({ browser });
  const workers = startWorkers(container, connection, queues);
  if (queues.includes(QUEUES.SCHEDULER)) await registerSchedules(container);
  const hb = startHeartbeat(connection, queues);
  logger.info('workers started', { queues, browser: !!browser });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
    clearInterval(hb);
    await Promise.allSettled(workers.map((w) => w.close()));
    await browser?.close();
    await container.queues?.close();
    await container.handle.close();
    connection.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e) => {
  logger.error('fatal worker error', { error: e });
  process.exit(1);
});
