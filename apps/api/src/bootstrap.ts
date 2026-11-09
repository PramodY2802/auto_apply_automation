import 'reflect-metadata';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createLogger } from '@autoapply/services';
import { AppModule, type AppModuleOptions } from './app.module';
import { AllExceptionsFilter } from './common/core';
import { loadConfig } from './config';

export async function createApp(opts: AppModuleOptions = {}): Promise<INestApplication> {
  const config = opts.config ?? loadConfig();
  const logger = createLogger('api');
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot({ ...opts, config }), {
    logger: {
      log: (m: unknown) => logger.info(String(m)),
      error: (m: unknown) => logger.error(String(m)),
      warn: (m: unknown) => logger.warn(String(m)),
      debug: () => undefined,
      verbose: () => undefined,
      fatal: (m: unknown) => logger.error(String(m)),
    },
    bodyParser: true,
  });
  app.set('trust proxy', 1);
  app.useBodyParser('json', { limit: '1mb' });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  const extensionOrigins = config.EXTENSION_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || origin === config.WEB_ORIGIN || extensionOrigins.includes(origin) || (config.NODE_ENV !== 'production' && origin.startsWith('chrome-extension://'))) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
    allowedHeaders: ['content-type', 'x-csrf-token', 'authorization', 'x-request-id'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const doc = new DocumentBuilder()
    .setTitle('AutoApply API')
    .setDescription('Multi-tenant AI job discovery, matching, auto-apply and application tracking API. Browser clients authenticate with the session cookie + `x-csrf-token` header; the extension uses a personal API token (Bearer aa_pat_…) limited to extension endpoints.')
    .setVersion('1.0')
    .addCookieAuth('aa_session')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, doc), { jsonDocumentUrl: 'api/docs/openapi.json' });
  return app;
}
