import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { bootstrapApp, getPrisma, type BootstrapResult } from './setup';
import { siwsSignIn } from './siws-signin';

/**
 * #37 — banned users must not authenticate or grow their wallet surface. A
 * valid SIWS signature proves key ownership, not standing: verify must 403
 * BEFORE any token/session is minted, and wallet-link/set-primary must 403 for
 * a user banned after sign-in (their live session notwithstanding).
 */
describe('banned-user enforcement (integration, real Postgres)', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();
  const RUN = Date.now().toString(36);

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
    await prisma.$disconnect();
  });

  it('a banned user with a VALID signature gets 403 from /auth/verify and no token', async () => {
    const kp = nacl.sign.keyPair();
    const walletAddress = bs58.encode(kp.publicKey);
    await prisma.user.create({
      data: { walletAddress, refCode: `ban-${RUN}-1`, banned: true },
    });

    const nonceRes = await request(harness.server)
      .post('/api/v1/auth/nonce')
      .send({ walletAddress })
      .expect(201);
    const { nonce, message } = nonceRes.body as { nonce: string; message: string };
    const signature = bs58.encode(
      nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey),
    );

    const res = await request(harness.server)
      .post('/api/v1/auth/verify')
      .send({ walletAddress, nonce, signature, message });
    expect(res.status).toBe(403);
    expect(res.body.accessToken).toBeUndefined();
    expect(res.body.refreshToken).toBeUndefined();

    // No session row was minted for the banned user.
    const user = await prisma.user.findUniqueOrThrow({ where: { walletAddress } });
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('a user banned AFTER sign-in cannot link a wallet or set a primary (403)', async () => {
    const signIn = await siwsSignIn(harness.server);
    const me = await prisma.user.findUniqueOrThrow({
      where: { walletAddress: signIn.walletAddress },
    });
    await prisma.user.update({ where: { id: me.id }, data: { banned: true } });

    // linkWallet — sign a real link nonce for a fresh wallet, then expect 403.
    const linkKp = nacl.sign.keyPair();
    const linkAddress = bs58.encode(linkKp.publicKey);
    const nonceRes = await request(harness.server)
      .post('/api/v1/me/wallets/nonce')
      .set('Authorization', `Bearer ${signIn.accessToken}`)
      .send({ address: linkAddress })
      .expect(201);
    const { nonce, message } = nonceRes.body as { nonce: string; message: string };
    const signature = bs58.encode(
      nacl.sign.detached(new TextEncoder().encode(message), linkKp.secretKey),
    );
    await request(harness.server)
      .post('/api/v1/me/wallets/link')
      .set('Authorization', `Bearer ${signIn.accessToken}`)
      .send({ address: linkAddress, nonce, signature, message })
      .expect(403);

    // setPrimaryWallet — also 403, before any ownership logic runs.
    await request(harness.server)
      .post('/api/v1/me/wallets/primary')
      .set('Authorization', `Bearer ${signIn.accessToken}`)
      .send({ address: linkAddress })
      .expect(403);
  });
});
