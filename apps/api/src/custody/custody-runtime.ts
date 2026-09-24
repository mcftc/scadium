import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Keypair } from '@solana/web3.js';
import { clusterForGenesisHash, resolveNetworkConfig, type SolanaNetwork } from '@scadium/shared';
import { custodyConfig } from './custody.config';
import { parseSecretKey, type CustodyChain } from './custody-chain';

export const CUSTODY_CHAIN = Symbol('CUSTODY_CHAIN');

/** How often an unproven cluster is re-checked (the RPC was unreachable at boot). */
const PROOF_RETRY_MS = 30_000;

export interface ActiveCustody {
  cluster: SolanaNetwork;
  treasury: string;
  keypair: Keypair;
}

/**
 * Whether deposits and withdrawals may run right now (spec §4.1). Enabled is a
 * setting; ACTIVE is a proof: the hot key parses, and the RPC's genesis hash
 * shows the cluster `SOLANA_NETWORK` names. Mainnet never activates in this
 * phase — it needs a managed signer and the real-money gate, neither of which
 * exists — so a mistyped RPC URL cannot move real money.
 */
@Injectable()
export class CustodyRuntime implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CustodyRuntime.name);
  private proven: ActiveCustody | null = null;
  private reason = 'custody is disabled (CUSTODY_ENABLED)';
  private retry: NodeJS.Timeout | null = null;

  constructor(@Inject(CUSTODY_CHAIN) readonly chain: CustodyChain) {}

  onModuleInit(): void {
    void this.prove();
  }

  onModuleDestroy(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
  }

  get active(): ActiveCustody | null {
    return this.proven;
  }

  get inactiveReason(): string | null {
    return this.proven ? null : this.reason;
  }

  /** The proven custody context, or 503 with the reason it is not active. */
  requireActive(): ActiveCustody {
    if (!this.proven) throw new ServiceUnavailableException(`Wallet deposits are offline: ${this.reason}`);
    return this.proven;
  }

  /** Establish (or re-establish) the proof. Public so tests can await it. */
  async prove(): Promise<ActiveCustody | null> {
    this.proven = null;
    const cfg = custodyConfig();
    if (!cfg.enabled) {
      this.reason = 'custody is disabled (CUSTODY_ENABLED)';
      return null;
    }
    if (!cfg.hotWalletSecret) {
      this.reason = 'no hot wallet key (CUSTODY_HOT_WALLET_SECRET_KEY)';
      this.logger.error(`custody enabled but inactive: ${this.reason}`);
      return null;
    }
    let keypair: Keypair;
    try {
      keypair = parseSecretKey(cfg.hotWalletSecret);
    } catch (e) {
      this.reason = 'the hot wallet key does not parse';
      this.logger.error(`custody inactive: ${this.reason} (${(e as Error).message})`);
      return null;
    }
    const expected = resolveNetworkConfig(process.env.SOLANA_NETWORK, process.env.SOLANA_RPC_URL).network;
    let cluster: SolanaNetwork;
    try {
      cluster = clusterForGenesisHash(await this.chain.genesisHash());
    } catch (e) {
      this.reason = 'the Solana RPC is unreachable';
      this.logger.warn(`custody not yet proven: ${this.reason} (${(e as Error).message}) — retrying`);
      this.retry = setTimeout(() => void this.prove(), PROOF_RETRY_MS);
      this.retry.unref();
      return null;
    }
    if (cluster !== expected) {
      this.reason = `the RPC serves ${cluster} but SOLANA_NETWORK is ${expected}`;
      this.logger.error(`custody inactive: ${this.reason}`);
      return null;
    }
    if (cluster === 'mainnet-beta') {
      this.reason = 'mainnet custody needs a managed signer and the real-money gate';
      this.logger.error(`custody inactive: ${this.reason}`);
      return null;
    }
    this.proven = { cluster, treasury: keypair.publicKey.toBase58(), keypair };
    this.logger.log(`custody active on ${cluster} — treasury ${this.proven.treasury}`);
    return this.proven;
  }
}
