import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SiweRequest } from './siwe-auth.guard';

/**
 * The lowercased address recovered from the request's SIWE signature by
 * SiweAuthGuard. Only usable on routes guarded by SiweAuthGuard.
 */
export const SiweAddress = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<SiweRequest>();
    return request.siweAddress as string;
  },
);
