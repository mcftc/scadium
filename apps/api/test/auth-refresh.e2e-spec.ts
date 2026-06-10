import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { bootstrapApp, getPrisma, type BootstrapResult } from './setup';
import { siwsSignIn } from './siws-signin';

/**
 * #35 — refresh-token rotation, reuse detection, logout revocation, and the
 * access/refresh separation, over the real HTTP stack.
 */
describe('auth refresh + logout (integration, real Postgres)', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
    await prisma.$disconnect();
  });

  const refresh = (token: string) =>
    request(harness.server).post('/api/v1/auth/refresh').send({ refreshToken: token });
  const me = (accessToken: string) =>
    request(harness.server).get('/api/v1/me').set('Authorization', `Bearer ${accessToken}`);

  it('rotates the refresh token; the OLD one is rejected on next use', async () => {
    const s = await siwsSignIn(harness.server);

    const rotated = await refresh(s.refreshToken).expect(201);
    expect(rotated.body.accessToken).toBeTruthy();
    expect(rotated.body.refreshToken).toBeTruthy();
    expect(rotated.body.refreshToken).not.toBe(s.refreshToken);

    // The new access token works; the old refresh token no longer rotates.
    await me(rotated.body.accessToken).expect(200);
    await refresh(s.refreshToken).expect(401);
  });

  it('replaying an already-rotated refresh token revokes the whole session chain', async () => {
    const s = await siwsSignIn(harness.server);
    const rotated = await refresh(s.refreshToken).expect(201); // r0 → r1 (r0 is now "previous")

    // Replay r0 → reuse detected → session deleted.
    await refresh(s.refreshToken).expect(401);

    // The live token r1 is now dead too (the chain was revoked).
    await refresh(rotated.body.refreshToken).expect(401);
    await me(rotated.body.accessToken).expect(401);
  });

  it('logout revokes the current access token even though its signature is valid', async () => {
    const s = await siwsSignIn(harness.server);
    await me(s.accessToken).expect(200);

    await request(harness.server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .expect(201);

    await me(s.accessToken).expect(401);
  });

  it('a refresh token cannot authenticate an access route, and an access token cannot refresh', async () => {
    const s = await siwsSignIn(harness.server);

    // The opaque refresh token is not a valid bearer JWT → 401 on a guarded route.
    await me(s.refreshToken).expect(401);
    // The access JWT is not a stored refresh token → /auth/refresh 401.
    await refresh(s.accessToken).expect(401);

    // And a JWT explicitly minted with typ:'refresh' is rejected by the guard.
    const jwt = harness.app.get(JwtService);
    const fakeRefreshJwt = await jwt.signAsync({ sub: 'x', userId: 'x', walletAddress: 'x', typ: 'refresh', jti: 'x' });
    const res = await me(fakeRefreshJwt);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid token type');
  });
});
