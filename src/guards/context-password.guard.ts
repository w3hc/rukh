import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class ContextPasswordGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const password = request.headers['x-context-password'];

    if (!password) {
      throw new BadRequestException('x-context-password header is required');
    }

    return true;
  }
}
