import { describe, it, expect } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard, type AuthContext } from './jwt-auth.guard';

type ReqLike = { headers: Record<string, string>; auth?: AuthContext };

const ctxWith = (req: ReqLike): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

const bearer = (token = 'tok'): ReqLike => ({ headers: { authorization: `Bearer ${token}` } });

/** Guard whose JwtService resolves to `payload` and whose Prisma returns
 * `session` for `session.findUnique` (null = revoked / no live session). */
const guardWith = (
  payload: unknown,
  session: { expiresAt: Date } | null = { expiresAt: new Date(Date.now() + 60_000) },
) =>
  new JwtAuthGuard(
    { verifyAsync: async () => payload } as unknown as JwtService,
    { session: { findUnique: async () => session } } as unknown as PrismaService,
  );

const ACCESS = { sub: 'u1', userId: 'u1', walletAddress: 'w1', typ: 'access', jti: 'jti-1' };

describe('JwtAuthGuard — typ:access + session revocation (#33/#35)', () => {
  it('rejects a token with no typ claim', async () => {
    await expect(guardWith({ sub: 'u1', jti: 'x' }).canActivate(ctxWith(bearer()))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a refresh token (typ !== access) before any session lookup', async () => {
    await expect(
      guardWith({ sub: 'u1', typ: 'refresh', jti: 'x' }).canActivate(ctxWith(bearer())),
    ).rejects.toThrowError('Invalid token type');
  });

  it('rejects an access token with no jti', async () => {
    await expect(
      guardWith({ sub: 'u1', userId: 'u1', walletAddress: 'w1', typ: 'access' }).canActivate(
        ctxWith(bearer()),
      ),
    ).rejects.toThrowError('Token is not bound to a session');
  });

  it('rejects an access token whose session was revoked (no row)', async () => {
    await expect(guardWith(ACCESS, null).canActivate(ctxWith(bearer()))).rejects.toThrowError(
      'Session revoked or expired',
    );
  });

  it('rejects an access token whose session has expired', async () => {
    await expect(
      guardWith(ACCESS, { expiresAt: new Date(Date.now() - 1000) }).canActivate(ctxWith(bearer())),
    ).rejects.toThrowError('Session revoked or expired');
  });

  it('accepts a live access token and sets req.auth (incl. jti)', async () => {
    const req = bearer();
    await expect(guardWith(ACCESS).canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.auth).toEqual({ userId: 'u1', walletAddress: 'w1', jti: 'jti-1' });
  });

  it('falls back to sub when userId/walletAddress are absent', async () => {
    const req = bearer();
    await guardWith({ sub: 'u1', typ: 'access', jti: 'jti-1' }).canActivate(ctxWith(req));
    expect(req.auth).toEqual({ userId: 'u1', walletAddress: 'u1', jti: 'jti-1' });
  });

  it('rejects a missing bearer token before verifying', async () => {
    await expect(guardWith(ACCESS).canActivate(ctxWith({ headers: {} }))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
