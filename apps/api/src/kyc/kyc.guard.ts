import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { KycService } from './kyc.service';

/**
 * Blocks money movement (deposit/withdraw) unless the user is KYC-approved and
 * sanctions-cleared (#45). Fail-open when KYC is disabled (play-money demo).
 * Runs AFTER JwtAuthGuard (reads `req.auth`).
 */
@Injectable()
export class KycGuard implements CanActivate {
  constructor(private readonly kyc: KycService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (!this.kyc.enabled) return true; // play-money: identity not required
    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const userId = req.auth?.userId;
    // Fail CLOSED when KYC is enabled: if we somehow reach here without an authed
    // user (guard mis-order), block rather than silently allow money movement.
    if (!userId) throw new ForbiddenException('Identity verification required');
    if (await this.kyc.isCleared(userId)) return true;
    throw new ForbiddenException('Identity verification required');
  }
}
