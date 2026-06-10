import { describe, it, expect } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, type AuthContext } from './jwt-auth.guard';

type ReqLike = { headers: Record<string, string>; auth?: AuthContext };

const ctxWith = (req: ReqLike): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

const bearer = (token = 'tok'): ReqLike => ({ headers: { authorization: `Bearer ${token}` } });

/** A guard whose JwtService resolves `verifyAsync` to a fixed payload. */
const guardResolving = (payload: unknown) =>
  new JwtAuthGuard({ verifyAsync: async () => payload } as unknown as JwtService);

describe('JwtAuthGuard — typ:access enforcement (#33)', () => {
  it('rejects a token with no typ claim', async () => {
    const guard = guardResolving({ sub: 'u1' });
    await expect(guard.canActivate(ctxWith(bearer()))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a refresh token (typ !== access)', async () => {
    const guard = guardResolving({ sub: 'u1', typ: 'refresh' });
    await expect(guard.canActivate(ctxWith(bearer()))).rejects.toThrowError('Invalid token type');
  });

  it('accepts an access token and sets req.auth (userId/walletAddress mapping)', async () => {
    const guard = guardResolving({ sub: 'u1', userId: 'u1', walletAddress: 'w1', typ: 'access' });
    const req = bearer();
    await expect(guard.canActivate(ctxWith(req))).resolves.toBe(true);
    expect(req.auth).toEqual({ userId: 'u1', walletAddress: 'w1' });
  });

  it('falls back to sub when userId/walletAddress are absent', async () => {
    const guard = guardResolving({ sub: 'u1', typ: 'access' });
    const req = bearer();
    await guard.canActivate(ctxWith(req));
    expect(req.auth).toEqual({ userId: 'u1', walletAddress: 'u1' });
  });

  it('rejects a missing bearer token before verifying', async () => {
    const guard = guardResolving({ sub: 'u1', typ: 'access' });
    await expect(guard.canActivate(ctxWith({ headers: {} }))).rejects.toThrow(UnauthorizedException);
  });
});
