import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { MistralModule } from '../mistral/mistral.module';
import { ContextModule } from '../context/context.module';
import { WebReaderModule } from '../web/web-reader.module';

@Module({
  imports: [ContextModule, WebReaderModule, MistralModule],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
