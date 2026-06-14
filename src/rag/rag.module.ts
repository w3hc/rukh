import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { MistralService } from '../mistral/mistral.service';
import { ContextModule } from '../context/context.module';
import { WebReaderModule } from '../web/web-reader.module';

@Module({
  imports: [ContextModule, WebReaderModule],
  providers: [RagService, MistralService],
  exports: [RagService],
})
export class RagModule {}
