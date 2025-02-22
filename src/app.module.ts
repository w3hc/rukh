import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MistralService } from './mistral/mistral.service';
import { APP_GUARD } from '@nestjs/core';
import { CustomThrottlerGuard } from './throttler.guard';
import { ThrottlerModule } from '@nestjs/throttler';
import { ContextModule } from './context/context.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 3600000,
        limit: 3,
        name: 'default',
      },
    ]),
    ContextModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    MistralService,
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
  ],
})
export class AppModule {}
