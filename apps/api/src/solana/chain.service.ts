import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';

/**
 * Thin Solana layer for the scadium_vault program (Phase A).
 *
 * Deliberately IDL-free: the program's instruction data is Anchor-encoded
 * (8-byte discriminator = sha256("global:<name>")[0..8] + borsh args), which
 * we assemble by hand here. This keeps the API decoupled from the anchor
 * build pipeline — the IDL is only needed by tests and (optionally) the web.
 *
 * The cosigner hot key signs ONLY settle_bet/claim_reward — the program
 * constrains what it can do (see programs/scadium_vault/src/lib.rs).
 */
@Injectable()
export class ChainService implements OnModuleInit {
  private readonly logger = new Logger(ChainService.name);
  private connection!: Connection;
  private cosigner: Keypair | null = null;
  private programId: PublicKey | null = null;
  enabled = false;

  get programIdBase58(): string | null {
    return this.programId?.toBase58() ?? null;
  }

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const rpcUrl = this.config.get<string>('SOLANA_RPC_URL') ?? 'https://api.devnet.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');

    const programId = this.config.get<string>('VAULT_PROGRAM_ID');
    const cosignerPath = this.config.get<string>('COSIGNER_KEYPAIR_PATH');
    if (!programId || !cosignerPath) {
      this.logger.warn(
        'VAULT_PROGRAM_ID / COSIGNER_KEYPAIR_PATH not set — on-chain settlement disabled (play-money mode)',
      );
      return;
    }
    try {
      this.programId = new PublicKey(programId);
      const raw = JSON.parse(readFileSync(cosignerPath, 'utf8')) as number[];
      this.cosigner = Keypair.fromSecretKey(Uint8Array.from(raw));
      this.enabled = true;
      this.logger.log(
        `On-chain settlement enabled — program ${programId}, cosigner ${this.cosigner.publicKey.toBase58()}`,
      );
    } catch (e) {
      this.logger.error(`Failed to init chain service: ${(e as Error).message}`);
    }
  }

  // ---------------------------------------------------------------- PDAs

  housePda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('house')], this.programId!)[0];
  }

  houseVaultPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('house_vault')], this.programId!)[0];
  }

  userVaultPda(user: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('user_vault'), user.toBuffer()],
      this.programId!,
    )[0];
  }

  // ------------------------------------------------------------- queries

  /** Lamports sitting in a user's vault PDA (0 if the PDA doesn't exist). */
  async vaultBalance(walletAddress: string): Promise<bigint> {
    if (!this.enabled) return 0n;
    const pda = this.userVaultPda(new PublicKey(walletAddress));
    const info = await this.connection.getAccountInfo(pda);
    return info ? BigInt(info.lamports) : 0n;
  }

  // ------------------------------------------------------------ settle

  /**
   * Fire the on-chain settlement receipt for a resolved bet.
   * Returns the tx signature (for Bet.txSignature) or null when disabled
   * or on failure — settlement must never block the game loop.
   */
  async settleBet(params: {
    betId: string; // uuid — packed into 16 bytes
    walletAddress: string;
    game: 'crash' | 'coinflip' | 'blackjack' | 'lottery' | 'jackpot';
    stakeLamports: bigint;
    payoutLamports: bigint;
    multiplier: number | null;
  }): Promise<string | null> {
    if (!this.enabled || !this.cosigner) return null;
    try {
      const user = new PublicKey(params.walletAddress);
      const data = Buffer.concat([
        anchorDiscriminator('settle_bet'),
        uuidToBytes(params.betId),
        Buffer.from([GAME_INDEX[params.game]]),
        u64le(params.stakeLamports),
        u64le(params.payoutLamports),
        u32le(Math.round((params.multiplier ?? 0) * 10_000)),
      ]);
      const ix = new TransactionInstruction({
        programId: this.programId!,
        keys: [
          { pubkey: this.housePda(), isSigner: false, isWritable: false },
          { pubkey: this.houseVaultPda(), isSigner: false, isWritable: true },
          { pubkey: this.userVaultPda(user), isSigner: false, isWritable: true },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: false },
        ],
        data,
      });
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(this.connection, tx, [this.cosigner], {
        commitment: 'confirmed',
        maxRetries: 3,
      });
      return sig;
    } catch (e) {
      this.logger.error(`settle_bet failed for bet ${params.betId}: ${(e as Error).message}`);
      return null;
    }
  }
}

// ------------------------------------------------------------------ utils

const GAME_INDEX: Record<string, number> = {
  crash: 0,
  coinflip: 1,
  blackjack: 2,
  lottery: 3,
  jackpot: 4,
};

/** Anchor global instruction discriminator: sha256("global:<snake_name>")[0..8]. */
function anchorDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex'); // 16 bytes
}

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

function u32le(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0);
  return b;
}

// SystemProgram import kept for upcoming deposit/withdraw tx builders (web-side
// signing happens in the browser; the API only ever signs with the cosigner).
void SystemProgram;
