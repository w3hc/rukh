import { Module } from '@nestjs/common';
import { SponsorshipService } from './sponsorship.service';

export function isSponsorshipEnabled(
  get: (key: string) => string | undefined,
): boolean {
  return !!get('SPONSOR_GITHUB_LOGIN');
}

@Module({
  providers: [SponsorshipService],
  exports: [SponsorshipService],
})
export class SponsorshipModule {}
