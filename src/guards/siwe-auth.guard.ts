import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { validateSiweMessage, verifySiweSignature } from 'w3pk';
import { SIWE_CONFIG } from '../config/siwe.config';

export interface SiweRequest extends Request {
  siweAddress?: string;
}

/**
 * Verifies that the request carries a valid, fresh SIWE (EIP-4361) signature
 * scoped to this exact request. It only proves who signed — callers still
 * need to check `request.siweAddress` against whatever it should own (e.g. a
 * context's creatorAddress) before allowing the action.
 */
@Injectable()
export class SiweAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SiweRequest>();
    const rawMessage = request.headers['x-siwe-message'];
    const signature = request.headers['x-siwe-signature'];

    if (typeof rawMessage !== 'string' || !rawMessage) {
      throw new BadRequestException('x-siwe-message header is required');
    }
    if (typeof signature !== 'string' || !signature) {
      throw new BadRequestException('x-siwe-signature header is required');
    }

    // Header values can't carry raw newlines; the client percent-encodes
    // the (multi-line) SIWE message before sending it.
    let message: string;
    try {
      message = decodeURIComponent(rawMessage);
    } catch {
      throw new BadRequestException('x-siwe-message header is not valid');
    }

    const validation = validateSiweMessage(message, {
      checkExpiration: true,
      chainId: SIWE_CONFIG.CHAIN_ID,
    });

    if (!validation.valid || !validation.parsed) {
      throw new UnauthorizedException(
        `Invalid SIWE message: ${validation.errors.join(', ')}`,
      );
    }

    const parsed = validation.parsed;

    if (
      SIWE_CONFIG.ALLOWED_DOMAINS &&
      !SIWE_CONFIG.ALLOWED_DOMAINS.includes(parsed.domain)
    ) {
      throw new UnauthorizedException('Unrecognized SIWE domain');
    }

    if (!parsed.expirationTime) {
      throw new UnauthorizedException(
        'SIWE message must include an expiration time',
      );
    }

    const issuedAtMs = Date.parse(parsed.issuedAt);
    const expiresAtMs = Date.parse(parsed.expirationTime);
    const nowMs = Date.now();

    if (Number.isNaN(issuedAtMs) || Number.isNaN(expiresAtMs)) {
      throw new UnauthorizedException(
        'SIWE message has invalid issuedAt or expirationTime',
      );
    }

    if (issuedAtMs > nowMs + SIWE_CONFIG.CLOCK_SKEW_SECONDS * 1000) {
      throw new UnauthorizedException('SIWE message issued in the future');
    }

    if (
      expiresAtMs - issuedAtMs >
      SIWE_CONFIG.MAX_AGE_SECONDS * 1000 + SIWE_CONFIG.CLOCK_SKEW_SECONDS * 1000
    ) {
      throw new UnauthorizedException('SIWE message validity window too long');
    }

    const expectedStatement = `Authorize ${request.method.toUpperCase()} ${request.path}`;
    if (parsed.statement !== expectedStatement) {
      throw new UnauthorizedException(
        'SIWE message does not authorize this action',
      );
    }

    const result = await verifySiweSignature(message, signature);
    if (!result.valid || !result.address) {
      throw new UnauthorizedException(result.error || 'Invalid SIWE signature');
    }

    request.siweAddress = result.address.toLowerCase();
    return true;
  }
}
