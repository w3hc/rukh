import { Module } from '@nestjs/common';
import { DeepSeekService } from './deepseek.service';

@Module({
  providers: [DeepSeekService],
  exports: [DeepSeekService],
})
export class DeepSeekModule {}
