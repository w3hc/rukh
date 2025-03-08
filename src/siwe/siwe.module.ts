import { Module } from '@nestjs/common';
import { SiweService } from './siwe.service';
import { SiweController } from './siwe.controller';

@Module({
  controllers: [SiweController],
  providers: [SiweService],
  exports: [SiweService],
})
export class SiweModule {}
