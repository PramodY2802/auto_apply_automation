import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createContainer } from '@autoapply/services';
import { CONFIG, CONTAINER, InjectContainer, type AppConfig, type Container } from './common/core';
import { loadConfig } from './config';
import { AccountController, AuthController } from './modules/auth/auth.controller';
import { AuthGuard } from './modules/auth/auth.guard';
import { AuthService } from './modules/auth/auth.service';
import { ProfileController, ResumesController } from './modules/candidate/candidate.controller';
import { DiscoveryController, JobsController, PlatformsController } from './modules/jobs/jobs.controller';
import { ApplicationsController, ExtensionController, SavedAnswersController } from './modules/applications/applications.controller';
import { AdminAiProvidersController, AiController } from './modules/ai/ai.controller';
import { BillingController, HealthController, NotificationsController } from './modules/account/account-misc.controller';
import { EnterpriseController } from './modules/enterprise/enterprise.controller';
import { AdminController } from './modules/admin/admin.controller';

export interface AppModuleOptions {
  config?: AppConfig;
  container?: Container;
}

export class AppModule {
  static forRoot(opts: AppModuleOptions = {}): new (...args: any[]) => unknown {
    const config = opts.config ?? loadConfig();
    const container = opts.container ?? createContainer({ databaseUrl: config.DATABASE_URL, redisUrl: config.REDIS_URL });
    @Module({
      imports: [
        ThrottlerModule.forRoot({
          throttlers: [{ name: 'default', ttl: 60_000, limit: config.RATE_LIMIT_PER_MINUTE }],
          // Only honoured in the test environment (never in development/production).
          skipIf: () => config.NODE_ENV === 'test' && process.env.DISABLE_RATE_LIMIT === 'true',
        }),
      ],
      controllers: [
        HealthController,
        AuthController,
        AccountController,
        ResumesController,
        ProfileController,
        JobsController,
        DiscoveryController,
        PlatformsController,
        ApplicationsController,
        SavedAnswersController,
        ExtensionController,
        AiController,
        AdminAiProvidersController,
        NotificationsController,
        BillingController,
        EnterpriseController,
        AdminController,
      ],
      providers: [
        { provide: CONFIG, useValue: config },
        { provide: CONTAINER, useValue: container },
        AuthService,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    })
    class RootModule implements OnApplicationShutdown {
      constructor(@InjectContainer() public readonly c: Container) {}
      async onApplicationShutdown() {
        await this.c.queues?.close();
        await this.c.handle.close();
      }
    }
    return RootModule;
  }
}
