import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MistralService } from './mistral/mistral.service';
import { AnthropicService } from './anthropic/anthropic.service';
import { OpenAIService } from './openai/openai.service';
import { APP_GUARD } from '@nestjs/core';
import { CustomThrottlerGuard } from './throttler.guard';
import { ThrottlerModule } from '@nestjs/throttler';
import { ContextModule } from './context/context.module';
import { AnthropicModule } from './anthropic/anthropic.module';
import { OpenAIModule } from './openai/openai.module';
import { CostTracker } from './memory/cost-tracking.service';
import { SubsService } from './subs/subs.service';
import { WebReaderModule } from './web/web-reader.module';
import { RagModule } from './rag/rag.module';
import { ObserveModule, isObserveEnabled } from './observe';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    // Evaluated after ConfigModule.forRoot has loaded .env into process.env
    ...(isObserveEnabled()
      ? [
          ObserveModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              appKey: config.getOrThrow<string>('OBSERVE_APP_KEY'),
              appSecret: config.getOrThrow<string>('OBSERVE_APP_SECRET'),
              serviceId: config.get<string>('OBSERVE_SERVICE_ID') ?? 'rukh',
              serviceVersion: '0.2.0',
              debug: config.get<string>('OBSERVE_DEBUG') === 'true',
            }),
          }),
        ]
      : []),
    ThrottlerModule.forRoot([
      {
        ttl: 3600000,
        limit: 50,
        name: 'ask',
      },
      {
        ttl: 60000,
        limit: 20,
        name: 'web',
      },
    ]),
    ContextModule,
    AnthropicModule,
    OpenAIModule,
    WebReaderModule,
    RagModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    MistralService,
    AnthropicService,
    OpenAIService,
    CostTracker,
    SubsService,
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule {}
