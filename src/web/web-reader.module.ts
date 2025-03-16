import { Module } from '@nestjs/common';
import { WebReaderController } from './web-reader.controller';
import { WebReaderService } from './web-reader.service';

@Module({
  controllers: [WebReaderController],
  providers: [WebReaderService],
  exports: [WebReaderService],
})
export class WebReaderModule {}
