import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
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

  private scadMint: PublicKey | null = null;

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
      const scadMint = this.config.get<string>('SCAD_MINT');
      this.scadMint = scadMint ? new PublicKey(scadMint) : null;
      const lotteryProgramId = this.config.get<string>('LOTTERY_PROGRAM_ID');
      this.lotteryProgramId = lotteryProgramId ? new PublicKey(lotteryProgramId) : null;
      const usdtMint = this.config.get<string>('USDT_MINT');
      this.usdtMint = usdtMint ? new PublicKey(usdtMint) : null;
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
          { pubkey: user, isSigner: false, isWritable: false },
          // Cosigner pays rent when init_if_needed creates a fresh vault.
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
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

  // ------------------------------------------------------------ lottery

  private lotteryProgramId: PublicKey | null = null;
  private usdtMint: PublicKey | null = null;

  get lotteryEnabled(): boolean {
    return this.enabled && !!this.lotteryProgramId && !!this.usdtMint;
  }
  get lotteryProgramIdBase58(): string | null {
    return this.lotteryProgramId?.toBase58() ?? null;
  }
  get usdtMintBase58(): string | null {
    return this.usdtMint?.toBase58() ?? null;
  }

  lotteryConfigPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('lottery')], this.lotteryProgramId!)[0];
  }
  lotteryDrawPda(index: bigint): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('draw'), u64le(index)],
      this.lotteryProgramId!,
    )[0];
  }

  /** Publish the seed commitment on-chain before sales open. */
  async lotteryCommitDraw(params: {
    drawIndex: bigint;
    serverSeedHashHex: string; // 64-char hex
    clientSeedHex: string; // 32-char hex (16 bytes) — padded to 32 bytes
    drawAtMs: number;
  }): Promise<string | null> {
    if (!this.lotteryEnabled || !this.cosigner) return null;
    try {
      const clientSeed = Buffer.alloc(32);
      Buffer.from(params.clientSeedHex, 'utf8').copy(clientSeed); // utf8, zero-padded
      const data = Buffer.concat([
        anchorDiscriminator('commit_draw'),
        u64le(params.drawIndex),
        Buffer.from(params.serverSeedHashHex, 'hex'),
        clientSeed,
        i64le(BigInt(Math.floor(params.drawAtMs / 1000))),
      ]);
      const ix = new TransactionInstruction({
        programId: this.lotteryProgramId!,
        keys: [
          { pubkey: this.lotteryConfigPda(), isSigner: false, isWritable: false },
          { pubkey: this.lotteryDrawPda(params.drawIndex), isSigner: false, isWritable: true },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });
      return await this.send(ix);
    } catch (e) {
      this.logger.error(`commit_draw ${params.drawIndex} failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Reveal the seed. The PROGRAM asserts sha256(seed)==commitment, mixes in
   * the newest SlotHashes entry, and derives the winning numbers itself —
   * we read them back from the Draw account afterwards (chain is the source
   * of truth; the API no longer dictates the numbers).
   */
  async lotteryRevealDraw(params: {
    drawIndex: bigint;
    serverSeedHex: string; // 64-char hex → 64 utf8 bytes on-chain
  }): Promise<{
    signature: string;
    main: number[];
    bonus: number;
    slotHashHex: string;
    finalEntropyHex: string;
  } | null> {
    if (!this.lotteryEnabled || !this.cosigner) return null;
    try {
      const data = Buffer.concat([
        anchorDiscriminator('reveal_draw'),
        u64le(params.drawIndex),
        Buffer.from(params.serverSeedHex, 'utf8'),
      ]);
      const drawPda = this.lotteryDrawPda(params.drawIndex);
      const ix = new TransactionInstruction({
        programId: this.lotteryProgramId!,
        keys: [
          { pubkey: this.lotteryConfigPda(), isSigner: false, isWritable: false },
          { pubkey: drawPda, isSigner: false, isWritable: true },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: false },
          { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
        ],
        data,
      });
      const signature = await this.send(ix);

      // Draw layout after the 8-byte discriminator (programs/scadium_lottery):
      // index u64 | seed_hash 32 | client_seed 32 | revealed_seed 64 |
      // slot u64 | slot_hash 32 | final_entropy 32 | main 5 | bonus 1 | …
      const info = await this.connection.getAccountInfo(drawPda, 'confirmed');
      if (!info) throw new Error('Draw account missing after reveal');
      const buf = info.data;
      const slotHashHex = buf.subarray(152, 184).toString('hex');
      const finalEntropyHex = buf.subarray(184, 216).toString('hex');
      const main = Array.from(buf.subarray(216, 221));
      const bonus = buf[221]!;
      return { signature, main, bonus, slotHashHex, finalEntropyHex };
    } catch (e) {
      this.logger.error(`reveal_draw ${params.drawIndex} failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Pay a fixed-tier USDT prize from the lottery treasury. */
  async lotteryPayPrize(params: {
    drawIndex: bigint;
    walletAddress: string;
    amountUsdtBase: bigint;
    tier: number;
  }): Promise<string | null> {
    if (!this.lotteryEnabled || !this.cosigner) return null;
    try {
      const winner = new PublicKey(params.walletAddress);
      const config = this.lotteryConfigPda();
      const data = Buffer.concat([
        anchorDiscriminator('pay_prize'),
        u64le(params.drawIndex),
        u64le(params.amountUsdtBase),
        Buffer.from([params.tier]),
      ]);
      const ix = new TransactionInstruction({
        programId: this.lotteryProgramId!,
        keys: [
          { pubkey: config, isSigner: false, isWritable: false },
          { pubkey: this.lotteryDrawPda(params.drawIndex), isSigner: false, isWritable: false },
          { pubkey: winner, isSigner: false, isWritable: false },
          { pubkey: ata(this.usdtMint!, config), isSigner: false, isWritable: true },
          { pubkey: ata(this.usdtMint!, winner), isSigner: false, isWritable: true },
          { pubkey: this.usdtMint!, isSigner: false, isWritable: false },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });
      return await this.send(ix);
    } catch (e) {
      this.logger.error(`pay_prize ${params.drawIndex} failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Devnet faucet: cosigner transfers demo USDT to a user. */
  async usdtFaucet(walletAddress: string, amountBase: bigint): Promise<string | null> {
    if (!this.lotteryEnabled || !this.cosigner) return null;
    try {
      const to = new PublicKey(walletAddress);
      const fromAta = ata(this.usdtMint!, this.cosigner.publicKey);
      const toAta = ata(this.usdtMint!, to);
      const ixs: TransactionInstruction[] = [];
      const exists = await this.connection.getAccountInfo(toAta);
      if (!exists) {
        // Create the recipient ATA (payer = cosigner).
        ixs.push(
          new TransactionInstruction({
            programId: ASSOCIATED_TOKEN_PROGRAM_ID,
            keys: [
              { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
              { pubkey: toAta, isSigner: false, isWritable: true },
              { pubkey: to, isSigner: false, isWritable: false },
              { pubkey: this.usdtMint!, isSigner: false, isWritable: false },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
              { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            ],
            data: Buffer.from([0]), // Create
          }),
        );
      }
      // SPL Token Transfer (ix index 3): [3, amount u64le]
      ixs.push(
        new TransactionInstruction({
          programId: TOKEN_PROGRAM_ID,
          keys: [
            { pubkey: fromAta, isSigner: false, isWritable: true },
            { pubkey: toAta, isSigner: false, isWritable: true },
            { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: false },
          ],
          data: Buffer.concat([Buffer.from([3]), u64le(amountBase)]),
        }),
      );
      const tx = new Transaction().add(...ixs);
      return await sendAndConfirmTransaction(this.connection, tx, [this.cosigner], {
        commitment: 'confirmed',
        maxRetries: 3,
      });
    } catch (e) {
      this.logger.error(`usdt faucet failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Fetch + verify a buy_ticket tx: returns the TicketBought event fields. */
  /**
   * All TicketBought events in a purchase tx — `buy_ticket` emits one,
   * `buy_tickets` (bulk) one per pick. Order matches the on-chain batch.
   */
  async verifyTicketTx(signature: string): Promise<
    {
      drawIndex: bigint;
      buyer: string;
      main: number[];
      bonus: number;
    }[]
  > {
    if (!this.lotteryEnabled) return [];
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta || tx.meta.err) return [];
      const disc = createHash('sha256').update('event:TicketBought').digest().subarray(0, 8);
      const events: { drawIndex: bigint; buyer: string; main: number[]; bonus: number }[] = [];
      for (const log of tx.meta.logMessages ?? []) {
        if (!log.startsWith('Program data: ')) continue;
        const buf = Buffer.from(log.slice('Program data: '.length), 'base64');
        if (buf.length < 8 + 8 + 32 + 5 + 1 || !buf.subarray(0, 8).equals(disc)) continue;
        events.push({
          drawIndex: buf.readBigUInt64LE(8),
          buyer: new PublicKey(buf.subarray(16, 48)).toBase58(),
          main: Array.from(buf.subarray(48, 53)),
          bonus: buf[53]!,
        });
      }
      return events;
    } catch (e) {
      this.logger.error(`verifyTicketTx failed: ${(e as Error).message}`);
      return [];
    }
  }

  private async send(ix: TransactionInstruction): Promise<string> {
    const tx = new Transaction().add(ix);
    return sendAndConfirmTransaction(this.connection, tx, [this.cosigner!], {
      commitment: 'confirmed',
      maxRetries: 3,
    });
  }

  // ------------------------------------------------------------ rewards

  /**
   * Cosigner-signed $SCAD claim from the rewards treasury. `period` must be
   * unique per (user, kind) — it seeds the on-chain ClaimRecord PDA that
   * blocks double-claims. Returns the tx signature or null (disabled/error).
   */
  async claimReward(params: {
    walletAddress: string;
    kind: 'wagerReward' | 'cashback' | 'dailyCase' | 'airdrop';
    period: bigint;
    amountScadBase: bigint;
  }): Promise<string | null> {
    if (!this.enabled || !this.cosigner || !this.scadMint) return null;
    try {
      const user = new PublicKey(params.walletAddress);
      const kindIndex = REWARD_KIND_INDEX[params.kind];
      const periodLe = u64le(params.period);

      const house = this.housePda();
      const claimRecord = PublicKey.findProgramAddressSync(
        [Buffer.from('claim'), user.toBuffer(), Buffer.from([kindIndex]), periodLe],
        this.programId!,
      )[0];
      const treasuryAta = ata(this.scadMint, house);
      const userAta = ata(this.scadMint, user);

      const data = Buffer.concat([
        anchorDiscriminator('claim_reward'),
        Buffer.from([kindIndex]),
        periodLe,
        u64le(params.amountScadBase),
      ]);
      const ix = new TransactionInstruction({
        programId: this.programId!,
        keys: [
          { pubkey: house, isSigner: false, isWritable: false },
          { pubkey: claimRecord, isSigner: false, isWritable: true },
          { pubkey: user, isSigner: false, isWritable: false },
          { pubkey: treasuryAta, isSigner: false, isWritable: true },
          { pubkey: userAta, isSigner: false, isWritable: true },
          { pubkey: this.scadMint, isSigner: false, isWritable: false },
          { pubkey: this.cosigner.publicKey, isSigner: true, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
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
      this.logger.error(
        `claim_reward failed for ${params.walletAddress} ${params.kind}/${params.period}: ${(e as Error).message}`,
      );
      return null;
    }
  }
}

// ------------------------------------------------------------------ utils

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/** Associated token account address for (mint, owner). */
function ata(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

const REWARD_KIND_INDEX: Record<string, number> = {
  wagerReward: 0,
  cashback: 1,
  dailyCase: 2,
  airdrop: 3,
};

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

function i64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64LE(v);
  return b;
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
