import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { AUTH_THROTTLE, BET_THROTTLE, DEFAULT_THROTTLE } from './throttle.constants';
import { HttpThrottlerGuard } from './http-throttler.guard';

/** Build a guard with a stubbed JwtService; expose the protected getTracker. */
const trackerOf = (verify: (token: string) => unknown) => {
  const guard = new HttpThrottlerGuard(
    { throttlers: [] } as never,
    { increment: async () => ({}) } as never,
    new Reflector(),
  );
  (guard as unknown as { jwtService: { verify: (t: string) => unknown } }).jwtService = { verify };
  return (req: Record<string, unknown>) =>
    (guard as unknown as { getTracker: (r: Record<string, unknown>) => Promise<string> }).getTracker(
      req,
    );
};

describe('throttle profiles + tracker (#34)', () => {
  it('the auth profile is stricter than the global default', () => {
    expect(AUTH_THROTTLE.limit).toBeLessThan(DEFAULT_THROTTLE.limit);
    expect(AUTH_THROTTLE.ttl).toBeLessThanOrEqual(DEFAULT_THROTTLE.ttl);
  });

  it('the bet profile is a short-window burst cap', () => {
    expect(BET_THROTTLE.ttl).toBeLessThan(DEFAULT_THROTTLE.ttl);
    expect(BET_THROTTLE.limit).toBeLessThan(DEFAULT_THROTTLE.limit);
  });

  it('tracks a signed-in caller by verified user id (survives IP rotation)', async () => {
    const getTracker = trackerOf(() => ({ typ: 'access', userId: 'u-1', sub: 'u-1' }));
    const a = await getTracker({ headers: { authorization: 'Bearer tok' }, ip: '1.1.1.1' });
    const b = await getTracker({ headers: { authorization: 'Bearer tok' }, ip: '2.2.2.2' });
    expect(a).toBe('user:u-1');
    expect(b).toBe('user:u-1'); // same bucket despite a different IP
  });

  it('falls back to the client IP for anonymous or invalid-token callers', async () => {
    const anon = trackerOf(() => {
      throw new Error('no token');
    });
    expect(await anon({ headers: {}, ip: '9.9.9.9' })).toBe('ip:9.9.9.9');
    expect(await anon({ headers: { authorization: 'Bearer junk' }, ip: '9.9.9.9' })).toBe(
      'ip:9.9.9.9',
    );
    // X-Forwarded-For chain (trust proxy): the left-most entry is the client.
    expect(await anon({ headers: {}, ips: ['7.7.7.7', '10.0.0.1'], ip: '10.0.0.1' })).toBe(
      'ip:7.7.7.7',
    );
  });

  it('a refresh-typ token does NOT claim a user bucket', async () => {
    const getTracker = trackerOf(() => ({ typ: 'refresh', userId: 'u-1' }));
    expect(await getTracker({ headers: { authorization: 'Bearer tok' }, ip: '3.3.3.3' })).toBe(
      'ip:3.3.3.3',
    );
  });
});
