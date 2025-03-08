import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MistralService } from './mistral/mistral.service';
import { AnthropicService } from './anthropic/anthropic.service';
import { APP_GUARD } from '@nestjs/core';
import { CustomThrottlerGuard } from './throttler.guard';
import { ThrottlerModule } from '@nestjs/throttler';
import { ContextModule } from './context/context.module';
import { AnthropicModule } from './anthropic/anthropic.module';
import { CostTracker } from './memory/cost-tracking.service';
import { SiweModule } from './siwe/siwe.module';
import { SubsService } from './subs/subs.service';
import { SiweController } from './siwe/siwe.controller';
import { SiweService } from './siwe/siwe.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 3600000,
        limit: 50,
        name: 'ask',
      },
    ]),
    ContextModule,
    AnthropicModule,
    SiweModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    MistralService,
    AnthropicService,
    CostTracker,
    SubsService,
    SiweController,
    SiweService,
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule {}
