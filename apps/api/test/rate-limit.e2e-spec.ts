import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Shrink the per-route caps BEFORE bootstrapApp() lazily imports AppModule (the
// throttle constants read env at import time). The forks pool isolates this
// process from every other spec file, so nothing leaks.
process.env.THROTTLE_AUTH_LIMIT = '5';
process.env.THROTTLE_BET_LIMIT = '8';

import { bootstrapApp, seedUser, getPrisma, type BootstrapResult } from './setup';

/**
 * #34 — rate limiting over the real HTTP stack (Redis-backed storage). Unique
 * fake client IPs / fresh users per run keep the (shared, TTL'd) Redis buckets
 * from colliding across runs.
 */
describe('rate limiting (integration, real Redis storage)', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();
  const RUN = Date.now() % 200; // 2 distinct /24 octets per run

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
    await prisma.$disconnect();
  });

  it('429s /auth/nonce past the auth cap — per client IP, not globally', async () => {
    const wallet = '7'.repeat(40);
    const ipA = `198.51.${RUN}.10`;
    const ipB = `198.51.${RUN}.11`;
    const nonce = (ip: string) =>
      request(harness.server)
        .post('/api/v1/auth/nonce')
        .set('X-Forwarded-For', ip)
        .send({ walletAddress: wallet });

    for (let i = 0; i < 5; i++) {
      expect((await nonce(ipA)).status).toBe(201);
    }
    const blocked = await nonce(ipA);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();

    // A different client IP is its own bucket — still served.
    expect((await nonce(ipB)).status).toBe(201);
  });

  it('429s an authed user past the bet cap even while ROTATING IPs; another user is unaffected', async () => {
    const { token: tokenA } = await seedUser(0n, harness.signToken, prisma);
    const { token: tokenB } = await seedUser(0n, harness.signToken, prisma);
    const bet = (token: string, ip: string) =>
      request(harness.server)
        .post('/api/v1/crash/bet')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', ip)
        .send({ amountLamports: 'not-a-number' }); // guard counts BEFORE validation; body never reaches the engine

    // User A: 8 allowed hits, each from a DIFFERENT IP — the user-id tracker
    // must keep them in one bucket (IP rotation does not reset the cap).
    for (let i = 0; i < 8; i++) {
      const res = await bet(tokenA, `203.0.${RUN}.${i + 1}`);
      expect(res.status).not.toBe(429);
    }
    const blocked = await bet(tokenA, `203.0.${RUN}.99`);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();

    // User B (same real socket IP) has an independent bucket.
    expect((await bet(tokenB, `203.0.${RUN}.99`)).status).not.toBe(429);
  });
});
