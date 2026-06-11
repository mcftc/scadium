import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { BadRequestException } from '@nestjs/common';
import type { RedisService } from '../redis/redis.service';
import { SiwsService } from './siws.service';

/** SiwsService over an in-memory nonce store (no Redis needed). */
const makeService = () => {
  const store = new Map<string, string>();
  const redis = {
    client: {
      set: async (k: string, v: string) => void store.set(k, v),
      get: async (k: string) => store.get(k) ?? null,
      del: async (k: string) => (store.delete(k) ? 1 : 0),
    },
  } as unknown as RedisService;
  return new SiwsService(redis);
};

const sign = (message: string, secret: Uint8Array) =>
  bs58.encode(nacl.sign.detached(new TextEncoder().encode(message), secret));

describe('SIWS message binding (#37)', () => {
  it('the message carries domain, URI, version and chain id from config', async () => {
    const siws = makeService();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const { message } = await siws.issueNonce(wallet);

    const { domain, uri, chainId } = SiwsService.binding();
    expect(message.startsWith(`${domain} wants you to sign in`)).toBe(true);
    expect(message).toContain(`URI: ${uri}`);
    expect(message).toContain('Version: 1');
    expect(message).toContain(`Chain ID: ${chainId}`);
  });

  it('accepts a signature over the exact bound message', async () => {
    const siws = makeService();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const { nonce, message } = await siws.issueNonce(wallet);

    await expect(
      siws.verifySignature({ walletAddress: wallet, message, nonce, signature: sign(message, kp.secretKey) }),
    ).resolves.toBe(true);
  });

  it('rejects a validly-signed message whose binding differs (cross-env replay)', async () => {
    const siws = makeService();
    const kp = nacl.sign.keyPair();
    const wallet = bs58.encode(kp.publicKey);
    const { nonce, message } = await siws.issueNonce(wallet);

    // Simulate a message captured from ANOTHER deployment: same wallet/nonce
    // shape, different domain/URI/chain. The signature over it is VALID — but
    // the server re-derives its own bound message, so verification must fail.
    for (const [ours, theirs] of [
      [`${SiwsService.binding().domain} wants`, 'evil.example wants'],
      [`URI: ${SiwsService.binding().uri}`, 'URI: https://evil.example'],
      [`Chain ID: ${SiwsService.binding().chainId}`, 'Chain ID: solana:mainnet-beta-fake'],
    ] as const) {
      const tampered = message.replace(ours, theirs);
      expect(tampered).not.toBe(message);
      await expect(
        siws.verifySignature({
          walletAddress: wallet,
          message: tampered,
          nonce,
          signature: sign(tampered, kp.secretKey), // genuinely signed — binding is what fails
        }),
      ).rejects.toThrow(BadRequestException);
    }
  });
});
