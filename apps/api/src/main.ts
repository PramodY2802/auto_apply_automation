import { createLogger } from '@autoapply/services';
import { createApp } from './bootstrap';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const app = await createApp({ config });
  await app.listen(config.PORT, '0.0.0.0');
  createLogger('api').info(`API listening on :${config.PORT} (docs at /api/docs)`);
}

main().catch((e) => {
  createLogger('api').error('fatal startup error', { error: e });
  process.exit(1);
});
