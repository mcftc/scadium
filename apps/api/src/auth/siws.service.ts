import { Injectable, BadRequestException } from '@nestjs/common';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { randomBytes } from 'node:crypto';

interface NonceEntry {
  nonce: string;
  issuedAt: string;
  expiresAt: number;
}

/**
 * Sign-In With Solana (SIWS) — the user signs a server-issued nonce message
 * with their wallet's private key. We verify the ed25519 signature against
 * the public key encoded in their wallet address.
 *
 * Reference: https://docs.phantom.app/solana/signing-a-message
 */
@Injectable()
export class SiwsService {
  /**
   * Nonce store — in prod this lives in Redis with a short TTL. For now
   * an in-memory map is sufficient to prove out the flow in phase 0/2.
   *
   * Each entry stores the exact `issuedAt` timestamp baked into the signed
   * message so re-derivation on verify produces an identical string.
   */
  private readonly nonceStore = new Map<string, NonceEntry>();
  private readonly NONCE_TTL_MS = 5 * 60 * 1000;

  /**
   * Generate a fresh nonce for a wallet to sign.
   */
  issueNonce(walletAddress: string): { nonce: string; message: string } {
    this.sweepExpired();
    const nonce = randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    this.nonceStore.set(walletAddress, {
      nonce,
      issuedAt,
      expiresAt: Date.now() + this.NONCE_TTL_MS,
    });
    const message = this.buildMessage(walletAddress, nonce, issuedAt);
    return { nonce, message };
  }

  /**
   * Canonical SIWS message format. Must match exactly what the frontend
   * displays to the user before they sign — any change invalidates existing
   * nonces. The `issuedAt` parameter is stored with the nonce at issue time
   * so verify can re-derive the identical message.
   */
  buildMessage(walletAddress: string, nonce: string, issuedAt: string): string {
    return [
      'Scadium wants you to sign in with your Solana account:',
      walletAddress,
      '',
      'Sign this message to authenticate. This will not trigger a transaction or cost any fees.',
      '',
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt}`,
    ].join('\n');
  }

  /**
   * Verify an ed25519 signature over the SIWS message. Returns true iff the
   * signature was produced by the private key corresponding to walletAddress.
   */
  verifySignature(params: {
    walletAddress: string;
    message: string;
    signature: string; // base58 encoded
    nonce: string;
  }): boolean {
    const stored = this.nonceStore.get(params.walletAddress);
    if (!stored || stored.nonce !== params.nonce) {
      throw new BadRequestException('Invalid or expired nonce');
    }
    if (Date.now() > stored.expiresAt) {
      this.nonceStore.delete(params.walletAddress);
      throw new BadRequestException('Nonce expired');
    }

    // Re-derive the canonical message using the stored issuedAt so the
    // comparison is deterministic regardless of verify-time clock drift.
    const expectedMessage = this.buildMessage(
      params.walletAddress,
      params.nonce,
      stored.issuedAt,
    );
    if (params.message !== expectedMessage) {
      throw new BadRequestException('Message mismatch');
    }

    try {
      const publicKey = bs58.decode(params.walletAddress);
      const signatureBytes = bs58.decode(params.signature);
      const messageBytes = new TextEncoder().encode(params.message);

      const ok = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
      if (ok) {
        // Consume the nonce — one-time use only
        this.nonceStore.delete(params.walletAddress);
      }
      return ok;
    } catch {
      return false;
    }
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [wallet, entry] of this.nonceStore.entries()) {
      if (entry.expiresAt < now) this.nonceStore.delete(wallet);
    }
  }
}
