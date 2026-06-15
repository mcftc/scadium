import { Logger } from '@nestjs/common';
import { Keypair, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'fs';

/** DI token for the cosigner custody provider (#36). */
export const COSIGNER_PROVIDER = Symbol('COSIGNER_PROVIDER');

/**
 * Cosigner key custody seam (#36). The cosigner hot key signs every privileged
 * tx (settle_bet / claim_reward / commit_draw / reveal_draw / pay_prize / faucet).
 * ChainService depends on this abstraction instead of `readFileSync`-ing a
 * plaintext keypair, so:
 *   - production fails CLOSED — a plaintext file key is never loaded; a managed
 *     provider (KMS/HSM/Vault) must be configured, else the cosigner is disabled;
 *   - the key can be ROTATED via `reload()` without a redeploy;
 *   - the raw secret never needs to live in ChainService.
 *
 * The managed (KMS) implementation is a deferred seam — it needs cloud infra
 * (AWS KMS asymmetric ed25519 / Vault transit) that signs without exposing raw
 * bytes. Until it lands, configuring it leaves the cosigner DISABLED (fail-safe).
 */
export interface CosignerKeyProvider {
  /** Cosigner public key for PDA / account-meta derivation, or null. */
  readonly publicKey: PublicKey | null;
  /**
   * Local signing Keypair (file/dev path). null for a managed provider, which
   * signs via the program's own KMS call — callers must not assume a Keypair.
   */
  readonly signer: Keypair | null;
  /** Whether a usable cosigner key is available. */
  readonly available: boolean;
  /** Short label for logs (file | managed:<kind> | disabled). */
  readonly kind: string;
  /** Re-load the key (rotation) without a process restart. */
  reload(): void;
}

/** No cosigner — privileged on-chain actions are disabled (play-money / fail-closed). */
export class DisabledCosignerProvider implements CosignerKeyProvider {
  readonly kind = 'disabled';
  get publicKey(): null {
    return null;
  }
  get signer(): null {
    return null;
  }
  get available(): false {
    return false;
  }
  reload(): void {
    /* nothing to reload */
  }
}

/**
 * Dev-only provider: loads a plaintext JSON keypair from disk. NEVER selected in
 * production (the factory fails closed there). `reload()` re-reads the file so a
 * rotated key is picked up without a redeploy.
 */
export class FileCosignerProvider implements CosignerKeyProvider {
  readonly kind = 'file';
  private readonly logger = new Logger(FileCosignerProvider.name);
  private keypair: Keypair | null = null;

  constructor(private readonly keypairPath: string) {
    this.reload();
  }

  reload(): void {
    try {
      const raw = JSON.parse(readFileSync(this.keypairPath, 'utf8')) as number[];
      this.keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
    } catch (e) {
      this.keypair = null;
      this.logger.error(
        `Failed to load cosigner keypair from ${this.keypairPath}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  get signer(): Keypair | null {
    return this.keypair;
  }
  get publicKey(): PublicKey | null {
    return this.keypair?.publicKey ?? null;
  }
  get available(): boolean {
    return this.keypair !== null;
  }
}

export interface CosignerProviderOptions {
  keypairPath?: string;
  /** Managed key id (AWS KMS / Vault). Presence selects the managed path. */
  kmsKeyId?: string;
  isProduction: boolean;
  logger?: Logger;
}

/**
 * Select the cosigner provider for the environment (#36). Fail-closed:
 *   - managed key configured → managed provider (not yet implemented → disabled);
 *   - production without a managed provider → DISABLED (never load a disk key);
 *   - non-production with a keypair path → file provider (current dev behavior).
 */
export function createCosignerProvider(opts: CosignerProviderOptions): CosignerKeyProvider {
  const logger = opts.logger ?? new Logger('CosignerKeyProvider');

  if (opts.kmsKeyId?.trim()) {
    // Managed signing (KMS/HSM/Vault) is a deferred seam — it requires cloud
    // infra to sign without exposing raw key bytes. Until implemented, stay
    // disabled rather than fall back to a plaintext disk key.
    logger.error(
      'COSIGNER_KMS_KEY_ID is set but the managed cosigner provider is not implemented yet — on-chain settlement DISABLED. (Implement KmsCosignerProvider before real money.)',
    );
    return new DisabledCosignerProvider();
  }

  if (opts.isProduction) {
    logger.error(
      'No managed cosigner provider configured (COSIGNER_KMS_KEY_ID) — refusing to load a plaintext keypair from disk in production. On-chain settlement DISABLED. Provision KMS/HSM/Vault.',
    );
    return new DisabledCosignerProvider();
  }

  if (!opts.keypairPath?.trim()) {
    return new DisabledCosignerProvider();
  }
  return new FileCosignerProvider(opts.keypairPath);
}
