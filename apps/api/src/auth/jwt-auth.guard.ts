import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  walletAddress: string;
}

/**
 * Request-bound JWT verification. Extracts a bearer token from the
 * Authorization header, verifies its signature, and attaches an AuthContext
 * to the request object for downstream access via @CurrentUser().
 *
 * Keeps a single source of truth for JWT parsing so guards and decorators
 * can't drift.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        walletAddress?: string;
        userId?: string;
      }>(token);

      req.auth = {
        userId: payload.userId ?? payload.sub,
        walletAddress: payload.walletAddress ?? payload.sub,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return token;
  }
}
