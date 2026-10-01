import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { validateSiweMessage, verifySiweSignature } from 'w3pk';

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
  // Clock skew tolerated between the signer's clock and this server's.
  private readonly CLOCK_SKEW_SECONDS = 60;
  private readonly chainId: number;
  // How long a signed message stays acceptable after being issued.
  private readonly maxAgeSeconds: number;
  // Allow-list of frontend domains. Unset = no domain check (the API itself
  // has no single fixed frontend, so this is opt-in).
  private readonly allowedDomains?: string[];

  constructor(configService: ConfigService) {
    this.chainId = configService.get<number>('SIWE_CHAIN_ID', 1);
    this.maxAgeSeconds = configService.get<number>('SIWE_MAX_AGE_SECONDS', 300);
    const domains = configService
      .get<string>('SIWE_ALLOWED_DOMAINS')
      ?.split(',')
      .map((d) => d.trim())
      .filter(Boolean);
    this.allowedDomains = domains?.length ? domains : undefined;
  }

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
      chainId: this.chainId,
    });

    if (!validation.valid || !validation.parsed) {
      throw new UnauthorizedException(
        `Invalid SIWE message: ${validation.errors.join(', ')}`,
      );
    }

    const parsed = validation.parsed;

    if (this.allowedDomains && !this.allowedDomains.includes(parsed.domain)) {
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

    if (issuedAtMs > nowMs + this.CLOCK_SKEW_SECONDS * 1000) {
      throw new UnauthorizedException('SIWE message issued in the future');
    }

    if (
      expiresAtMs - issuedAtMs >
      this.maxAgeSeconds * 1000 + this.CLOCK_SKEW_SECONDS * 1000
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
