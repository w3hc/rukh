import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { APP_GUARD } from '@nestjs/core';
import { CustomThrottlerGuard } from './throttler.guard';
import { ThrottlerModule } from '@nestjs/throttler';
import { ContextModule } from './context/context.module';
import { CostTracker } from './memory/cost-tracking.service';
import { WebReaderModule } from './web/web-reader.module';
import { RagModule } from './rag/rag.module';
import { ProvidersModule } from './providers/providers.module';
import { ObserveModule, isObserveEnabled } from './observe';
import { validate } from './config/env.validation';
import { APP_VERSION } from './version';
import {
  NotificationsModule,
  isNotificationsEnabled,
} from './notifications/notifications.module';
import {
  SponsorshipModule,
  isSponsorshipEnabled,
} from './sponsorship/sponsorship.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    // Evaluated once ConfigModule has loaded and validated the environment
    ConditionalModule.registerWhen(
      ObserveModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          appKey: config.getOrThrow<string>('OBSERVE_APP_KEY'),
          appSecret: config.getOrThrow<string>('OBSERVE_APP_SECRET'),
          serviceId: config.get<string>('OBSERVE_SERVICE_ID'),
          serviceVersion: APP_VERSION,
          debug: config.get<string>('OBSERVE_DEBUG') === 'true',
        }),
      }),
      (env) => isObserveEnabled((key) => env[key]),
      { debug: false },
    ),
    ConditionalModule.registerWhen(
      SponsorshipModule,
      (env) => isSponsorshipEnabled((key) => env[key]),
      { debug: false },
    ),
    ConditionalModule.registerWhen(
      NotificationsModule,
      (env) => isNotificationsEnabled((key) => env[key]),
      { debug: false },
    ),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: 3600000,
          limit: config.get<number>('THROTTLE_ASK_LIMIT'),
          name: 'ask',
        },
        {
          ttl: 60000,
          limit: config.get<number>('THROTTLE_WEB_LIMIT'),
          name: 'web',
        },
      ],
    }),
    ContextModule,
    ProvidersModule,
    WebReaderModule,
    RagModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    CostTracker,
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule {}
