import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { JwtService } from '@nestjs/jwt';
import { bootstrapApp, getPrisma, type BootstrapResult } from './setup';

/**
 * #33 — JWT hardening over the real HTTP stack. Proves the two forgery vectors
 * are closed on a guarded admin route: (1) a token signed with the old public
 * `dev-secret-change-me` fallback is rejected (the app no longer trusts it), and
 * (2) a refresh token signed with the REAL secret is rejected because the guard
 * now requires `typ: 'access'`. A genuine admin access token still works.
 */
describe('JWT hardening (#33): fail-closed secret + typ:access enforcement', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
    await prisma.$disconnect();
  });

  const RUN = Date.now().toString(36);
  let seq = 0;
  const makeAdmin = () => {
    seq += 1;
    return prisma.user.create({
      data: { walletAddress: `jwt-${RUN}-${seq}`, refCode: `jwt-ref-${RUN}-${seq}`, role: 'admin' },
    });
  };
  const adminStats = (token: string) =>
    request(harness.server).get('/api/v1/admin/stats').set('Authorization', `Bearer ${token}`);

  it('rejects a token forged with the old public dev secret (signature no longer trusted)', async () => {
    const admin = await makeAdmin();
    // Even with typ:'access', a token signed by the public fallback must fail —
    // the app boots only with a real ≥32-byte secret, so the signature mismatches.
    const forged = new JwtService({ secret: 'dev-secret-change-me' }).sign({
      sub: admin.id,
      userId: admin.id,
      walletAddress: admin.walletAddress,
      typ: 'access',
    });
    const res = await adminStats(forged);
    expect(res.status).toBe(401);
  });

  it('rejects a refresh token signed with the REAL secret (typ !== access → 401)', async () => {
    const admin = await makeAdmin();
    const realJwt = harness.app.get(JwtService);
    const refresh = await realJwt.signAsync({
      sub: admin.id,
      userId: admin.id,
      walletAddress: admin.walletAddress,
      typ: 'refresh',
    });
    const res = await adminStats(refresh);
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid token type');
  });

  it('accepts a genuine access token for an admin user', async () => {
    const admin = await makeAdmin();
    const token = await harness.signToken(admin.id, admin.walletAddress); // mints typ:'access'
    const res = await adminStats(token);
    expect(res.status).toBe(200);
  });
});
