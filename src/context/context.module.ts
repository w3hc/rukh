import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { ContextController } from './context.controller';
import { ContextService } from './context.service';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 1024 * 1024, // 1MB
      },
    }),
  ],
  controllers: [ContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
