import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { MistralService } from '../mistral/mistral.service';
import { ContextModule } from '../context/context.module';

@Module({
  imports: [ContextModule],
  providers: [RagService, MistralService],
  exports: [RagService],
})
export class RagModule {}
