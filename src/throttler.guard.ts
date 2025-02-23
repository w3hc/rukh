import { ThrottlerGuard, ThrottlerException } from '@nestjs/throttler';
import { Injectable, ExecutionContext } from '@nestjs/common';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.ips.length ? req.ips[0] : req.ip;
  }

  protected async throwThrottlingException(
    context: ExecutionContext,
    { timeToExpire }: { timeToExpire: number },
  ): Promise<void> {
    const minutesRemaining = Math.ceil(timeToExpire / (1000 * 60));
    throw new ThrottlerException(
      `Rate limit exceeded. Maximum 50 requests allowed per hour. Please try again in ${minutesRemaining} ${
        minutesRemaining === 1 ? 'minute' : 'minutes'
      }.`,
    );
  }
}
