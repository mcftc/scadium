import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { RedisService } from '../../src/redis/redis.service';
import { SiwsService } from '../../src/auth/siws.service';

/**
 * #12 — SIWS nonces in Redis must work CROSS-INSTANCE. Two SiwsService objects,
 * each with its own RedisService, both pointed at the same Redis (REDIS_URL ||
 * localhost:6379), simulate two API pods. Issue on A → verify on B; replay
 * fails (one-time use). FAILS on the old in-memory Map (B never saw the nonce).
 */
describe('SIWS nonce via Redis (cross-instance)', () => {
  let redisA: RedisService;
  let redisB: RedisService;
  let siwsA: SiwsService;
  let siwsB: SiwsService;

  beforeAll(() => {
    redisA = new RedisService();
    redisB = new RedisService();
    siwsA = new SiwsService(redisA);
    siwsB = new SiwsService(redisB);
  });
  afterAll(async () => {
    await redisA.onModuleDestroy();
    await redisB.onModuleDestroy();
  });

  const sign = (message: string, secret: Uint8Array) =>
    bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), secret));

  it('nonce issued on A verifies on B; a replay then fails (one-time use)', async () => {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);

    const { nonce, message } = await siwsA.issueNonce(wallet);
    const signature = sign(message, kp.secretKey);

    expect(await siwsB.verifySignature({ walletAddress: wallet, message, signature, nonce })).toBe(
      true,
    );
    await expect(
      siwsB.verifySignature({ walletAddress: wallet, message, signature, nonce }),
    ).rejects.toThrow(/Invalid or expired nonce/);
  });

  it('a bad signature does NOT consume the nonce', async () => {
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const { nonce, message } = await siwsA.issueNonce(wallet);

    const bad = await siwsB.verifySignature({
      walletAddress: wallet,
      message,
      signature: sign('a different message', kp.secretKey),
      nonce,
    });
    expect(bad).toBe(false);

    // The nonce survives a bad attempt, so a correct signature still succeeds.
    expect(
      await siwsB.verifySignature({ walletAddress: wallet, message, signature: sign(message, kp.secretKey), nonce }),
    ).toBe(true);
  });
});
