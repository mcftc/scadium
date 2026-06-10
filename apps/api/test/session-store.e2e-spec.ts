import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootstrapApp, getPrisma, type BootstrapResult } from './setup';
import { siwsSignIn } from './siws-signin';
import { hashRefreshToken } from '../src/auth/session-tokens';

/**
 * #35 — a sign-in must persist a revocable Session (the model existed but was
 * never written). Verifies one row per sign-in with a HASHED refresh token + a
 * populated jti, and that logout-all clears every session for the user.
 */
describe('session store (integration, real Postgres)', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
    await prisma.$disconnect();
  });

  it('sign-in writes exactly one Session with a hashed refresh token + jti', async () => {
    const signIn = await siwsSignIn(harness.server);
    const user = await prisma.user.findUniqueOrThrow({
      where: { walletAddress: signIn.walletAddress },
    });

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    const session = sessions[0]!;
    expect(session.jwtId).toBeTruthy();
    // The stored token is the SHA-256 hash — never the raw refresh token.
    expect(session.refreshToken).not.toBe(signIn.refreshToken);
    expect(session.refreshToken).toBe(hashRefreshToken(signIn.refreshToken));
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('logout-all deletes every session for the user', async () => {
    const signIn = await siwsSignIn(harness.server);
    const user = await prisma.user.findUniqueOrThrow({
      where: { walletAddress: signIn.walletAddress },
    });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBeGreaterThanOrEqual(1);

    await request(harness.server)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${signIn.accessToken}`)
      .expect(201);

    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});
