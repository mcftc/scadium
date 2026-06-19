import { Injectable, BadRequestException } from '@nestjs/common';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';
import { resolveNetworkConfig } from '@scadium/shared';
import { RedisService } from '../redis/redis.service';

/**
 * Sign-In With Solana (SIWS) — the user signs a server-issued nonce message
 * with their wallet's private key. We verify the ed25519 signature against
 * the public key encoded in their wallet address.
 *
 * Nonces live in REDIS (#12), keyed `siws:nonce:<walletAddress>` with a TTL, so
 * sign-in works across ≥2 API replicas: a nonce issued on pod A verifies on pod
 * B, and Redis's TTL replaces the old in-memory sweep. One-time use is enforced
 * by an atomic delete on a successful signature (first concurrent verify wins).
 *
 * Reference: https://docs.phantom.app/solana/signing-a-message
 */
@Injectable()
export class SiwsService {
  private readonly NONCE_TTL_MS = 5 * 60 * 1000;

  constructor(private readonly redis: RedisService) {}

  private nonceKey(walletAddress: string): string {
    return `siws:nonce:${walletAddress}`;
  }

  /** Generate a fresh nonce for a wallet to sign (stored in Redis with a TTL). */
  async issueNonce(walletAddress: string): Promise<{ nonce: string; message: string }> {
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    await this.redis.client.set(
      this.nonceKey(walletAddress),
      JSON.stringify({ nonce, issuedAt }),
      'EX',
      Math.ceil(this.NONCE_TTL_MS / 1000),
    );
    return { nonce, message: this.buildMessage(walletAddress, nonce, issuedAt) };
  }

  /** Environment binding (#37): a signature is only valid for THIS deployment.
   * The chainId is derived from the SAME network resolver as the RPC (#185), so a
   * signature is bound to the cluster the app actually talks to — fail-closed in
   * production for an unset/invalid network rather than silently `solana:devnet`. */
  static binding(env = process.env): { domain: string; uri: string; chainId: string } {
    const { network } = resolveNetworkConfig(
      env.SOLANA_NETWORK,
      env.SOLANA_RPC_URL,
      env.NODE_ENV === 'production',
    );
    return {
      domain: env.SIWS_DOMAIN ?? 'localhost:3000',
      uri: env.SIWS_URI ?? 'http://localhost:3000',
      chainId: `solana:${network}`,
    };
  }

  /**
   * Canonical SIWS message format. Must match exactly what the frontend
   * displays to the user before they sign — any change invalidates existing
   * nonces. The `issuedAt` parameter is stored with the nonce at issue time
   * so verify can re-derive the identical message.
   *
   * Bound to domain / URI / chain (#37): verify re-derives this string from the
   * SERVER's configured values, so a signature captured on another origin or
   * cluster (dev vs prod, devnet vs mainnet) can never authenticate here —
   * the re-derived message differs byte-for-byte and the signature won't match.
   */
  buildMessage(walletAddress: string, nonce: string, issuedAt: string): string {
    const { domain, uri, chainId } = SiwsService.binding();
    return [
      `${domain} wants you to sign in with your Solana account:`,
      walletAddress,
      '',
      'Sign this message to authenticate. This will not trigger a transaction or cost any fees.',
      '',
      `URI: ${uri}`,
      'Version: 1',
      `Chain ID: ${chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
    ].join('\n');
  }

  /**
   * Verify an ed25519 signature over the SIWS message. Returns true iff the
   * signature was produced by the private key for walletAddress. The nonce is
   * consumed (one-time use) only on a valid signature; a bad signature leaves
   * the nonce intact so an attacker can't burn someone else's nonce.
   */
  async verifySignature(params: {
    walletAddress: string;
    message: string;
    signature: string; // base58 encoded
    nonce: string;
  }): Promise<boolean> {
    const key = this.nonceKey(params.walletAddress);
    const raw = await this.redis.client.get(key);
    if (!raw) throw new BadRequestException('Invalid or expired nonce');

    let stored: { nonce: string; issuedAt: string };
    try {
      stored = JSON.parse(raw) as { nonce: string; issuedAt: string };
    } catch {
      throw new BadRequestException('Invalid or expired nonce');
    }
    if (stored.nonce !== params.nonce) {
      throw new BadRequestException('Invalid or expired nonce');
    }

    // Re-derive the canonical message using the stored issuedAt so the
    // comparison is deterministic regardless of verify-time clock drift.
    const expectedMessage = this.buildMessage(params.walletAddress, params.nonce, stored.issuedAt);
    if (params.message !== expectedMessage) {
      throw new BadRequestException('Message mismatch');
    }

    let ok = false;
    try {
      const publicKey = bs58.decode(params.walletAddress);
      const signatureBytes = bs58.decode(params.signature);
      const messageBytes = new TextEncoder().encode(params.message);
      ok = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
    } catch {
      return false;
    }
    if (!ok) return false; // bad signature → do NOT consume the nonce

    // Consume atomically: the first verify to delete the key wins, so a replay
    // (or a concurrent second verify) of the same nonce is rejected.
    const deleted = await this.redis.client.del(key);
    if (deleted === 0) throw new BadRequestException('Invalid or expired nonce');
    return true;
  }
}
