import { describe, it, expect } from 'vitest';
import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { KycGuard } from './kyc.guard';

const ctx = (userId?: string) =>
  ({
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ auth: userId ? { userId } : undefined }) }),
  }) as unknown as ExecutionContext;

const guard = (enabled: boolean, cleared: boolean) =>
  new KycGuard({ enabled, isCleared: async () => cleared } as never);

describe('KycGuard (#45)', () => {
  it('allows when KYC is disabled (play-money)', async () => {
    await expect(guard(false, false).canActivate(ctx('u'))).resolves.toBe(true);
  });

  it('blocks (403) when enabled and the user is not approved/cleared', async () => {
    const err = await guard(true, false)
      .canActivate(ctx('u'))
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(403);
  });

  it('allows when enabled and the user is approved + sanctions-cleared', async () => {
    await expect(guard(true, true).canActivate(ctx('u'))).resolves.toBe(true);
  });

  it('skips non-http (WebSocket) contexts', async () => {
    const wsCtx = { getType: () => 'ws' } as unknown as ExecutionContext;
    await expect(guard(true, false).canActivate(wsCtx)).resolves.toBe(true);
  });
});
