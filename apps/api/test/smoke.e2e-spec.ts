import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { DICE } from '@scadium/shared';
import { bootstrapApp, getPrisma, type BootstrapResult } from './setup';
import { siwsSignIn } from './siws-signin';

/**
 * End-to-end SMOKE test over the real HTTP stack + Postgres.
 *
 * The existing Playwright e2e stubs the API, so it can't catch the failure class
 * that actually broke production: the stack (or its CORS / auth wiring) being
 * down so the wallet's first call fails and sign-in is impossible. This walks the
 * exact critical path a real visitor hits — the one that was throwing
 * "Failed to fetch" on https://scadium.com:
 *
 *   1. GET  /health                         → the app is up
 *   2. POST /api/v1/auth/nonce              → the FIRST wallet-flow call returns a
 *                                             nonce + canonical message to sign
 *   3. SIWS nonce → ed25519 sign → verify   → a real JWT pair is issued
 *   4. GET  /api/v1/me  (Bearer)            → the JWT authenticates
 *   5. POST /api/v1/dice/play (Bearer)      → a real bet settles end-to-end
 *      (balance moves + a Bet row is written = the engine actually ran)
 *
 * If any link is broken the suite fails loudly — exactly the signal the prior
 * "stack is fine" assumption was missing.
 */
describe('smoke: wallet sign-in + game settlement (integration, real Postgres)', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
    await prisma.$disconnect();
  });

  it('GET /health → 200 (the app is actually up)', async () => {
    await request(harness.server).get('/health').expect(200);
  });

  it('POST /auth/nonce returns a nonce + message (the call that 500/CORS-failed in prod)', async () => {
    const kp = nacl.sign.keyPair();
    const walletAddress = bs58.encode(kp.publicKey);
    const res = await request(harness.server)
      .post('/api/v1/auth/nonce')
      .send({ walletAddress })
      .expect(201);
    expect(typeof res.body.nonce).toBe('string');
    expect(res.body.nonce.length).toBeGreaterThan(0);
    expect(typeof res.body.message).toBe('string');
    // The canonical SIWS message must embed the wallet so the client shows what it signs.
    expect(res.body.message).toContain(walletAddress);
  });

  it('full SIWS sign-in (nonce → sign → verify) issues a working JWT', async () => {
    const s = await siwsSignIn(harness.server);
    expect(s.accessToken).toBeTruthy();
    expect(s.refreshToken).toBeTruthy();

    // The access token authenticates the canonical authed read.
    const me = await request(harness.server)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .expect(200);
    expect(me.body.walletAddress).toBe(s.walletAddress);
  });

  it('a signed-in user can place a dice bet that settles end-to-end', async () => {
    const s = await siwsSignIn(harness.server);
    const user = await prisma.user.findUniqueOrThrow({ where: { walletAddress: s.walletAddress } });
    const before = user.playBalanceLamports;

    const amount = 100_000_000n; // 0.1 SOL — well under the seeded 10 SOL balance
    const target = Math.round((DICE.MIN_TARGET + DICE.MAX_TARGET) / 2);

    const res = await request(harness.server)
      .post('/api/v1/dice/play')
      .set('Authorization', `Bearer ${s.accessToken}`)
      .send({ amountLamports: amount.toString(), target })
      .expect(201);

    // The settlement returned a concrete result (won/lost + a payout figure).
    expect(res.body).toBeTypeOf('object');
    expect(typeof res.body.won).toBe('boolean');

    // The engine actually ran: a Bet row exists and the balance moved by exactly
    // the settlement delta (lost → −stake, won → −stake + payout).
    const bet = await prisma.bet.findFirst({
      where: { userId: user.id, gameType: 'dice' },
      orderBy: { createdAt: 'desc' },
    });
    expect(bet).not.toBeNull();
    expect(bet!.amountLamports).toBe(amount);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const expected = before - amount + (bet!.payoutLamports ?? 0n);
    expect(after.playBalanceLamports).toBe(expected);
  });
});
