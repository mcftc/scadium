import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthContext {
  userId: string;
  walletAddress: string;
  /** jti of the presented access token — its live Session (#35). */
  jti: string;
}

/**
 * Request-bound JWT verification. Extracts a bearer token, verifies its
 * signature, enforces `typ:'access'` (#33), and confirms the token's `jti` still
 * maps to a live (unexpired) Session (#35) — so logout / logout-all / refresh
 * rotation invalidate outstanding access tokens even though their signatures
 * remain valid. Attaches an AuthContext for @CurrentUser().
 *
 * Single source of truth for JWT parsing so guards and decorators can't drift.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let payload: { sub: string; walletAddress?: string; userId?: string; typ?: string; jti?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Only ACCESS tokens authenticate protected routes (#33). A refresh token —
    // signed with the same secret — must NOT be accepted here. Checked OUTSIDE
    // the verify try/catch so the precise reason isn't masked as "expired".
    if (payload.typ !== 'access') throw new UnauthorizedException('Invalid token type');

    // Revocation (#35): the jti must still map to a live session. logout /
    // logout-all delete the row; refresh rotation moves jwtId to a new jti — so
    // a revoked or rotated-out access token is rejected despite a valid signature.
    if (!payload.jti) throw new UnauthorizedException('Token is not bound to a session');
    const session = await this.prisma.session.findUnique({
      where: { jwtId: payload.jti },
      select: { expiresAt: true },
    });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Session revoked or expired');
    }

    req.auth = {
      userId: payload.userId ?? payload.sub,
      walletAddress: payload.walletAddress ?? payload.sub,
      jti: payload.jti,
    };
    return true;
  }

  private extractToken(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return token;
  }
}
