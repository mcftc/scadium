import { ForbiddenException, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import { USD_PER_SOL } from '@scadium/shared';
import { SWAP, ENGINE, buybackBudgetLamports, resolveNetworkConfig } from '@scadium/shared';
import { expectedSwapOut, minOutWithSlippage } from './swap-math';
import { PrismaService } from '../prisma/prisma.service';
import {
  COSIGNER_PROVIDER,
  type CosignerKeyProvider,
} from '../solana/cosigner-key.provider';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

/** sha256("event:<Name>")[0..8] — Anchor event discriminator. */
function eventDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`event:${name}`).digest().subarray(0, 8);
}
function ixDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
function ata(mint: PublicKey, owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export interface SwapTradeRow {
  signature: string;
  user: string;
  side: 'buy' | 'sell'; // buy = SOL→SCAD
  scadAmount: string;
  solAmount: string;
  priceUsd: number;
  blockTime: number | null;
}

/**
 * SCAD/SOL pool read-model + buy-and-burn job (Phase D).
 *
 * Trades are read straight from the chain (signatures on the pool PDA →
 * Swapped events in the logs) so the DB never needs a write path for
 * user swaps — the chain is the trade ledger, exactly like solpump's
 * tx-hash trade tables.
 */
@Injectable()
export class SwapService implements OnModuleInit {
  private readonly logger = new Logger(SwapService.name);
  private connection!: Connection;
  private programId: PublicKey | null = null;
  private scadMint: PublicKey | null = null;
  private cosigner: Keypair | null = null;
  enabled = false;

  private tradesCache: { at: number; rows: SwapTradeRow[] } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Inject(COSIGNER_PROVIDER) private readonly cosignerProvider: CosignerKeyProvider,
  ) {}

  onModuleInit() {
    // RPC derived from SOLANA_NETWORK via the shared resolver (#185) — never a
    // fixed devnet URL independent of the cluster; selecting mainnet without an
    // explicit RPC fails closed. Unset → devnet (play-money default).
    const { rpcUrl: rpc } = resolveNetworkConfig(
      this.config.get<string>('SOLANA_NETWORK'),
      this.config.get<string>('SOLANA_RPC_URL'),
    );
    this.connection = new Connection(rpc, 'confirmed');
    const programId = this.config.get<string>('SWAP_PROGRAM_ID');
    const scadMint = this.config.get<string>('SCAD_MINT');
    if (!programId || !scadMint) {
      this.logger.warn('SWAP_PROGRAM_ID / SCAD_MINT not set — swap module disabled');
      return;
    }
    this.programId = new PublicKey(programId);
    this.scadMint = new PublicKey(scadMint);
    // Cosigner comes from the shared custody seam (#36), never a direct disk
    // read — so production fails closed (no plaintext key) and the burn job
    // is simply disabled when no local signer is available.
    this.cosigner = this.cosignerProvider.signer;
    this.enabled = true;
    this.logger.log(`Swap module enabled — pool program ${programId}`);
    // Buy-and-burn runs in @scadium/worker now (BullMQ, every 10 min, under a
    // Redis lock so overlapping runs don't double-spend the cosigner).
  }

  // ----------------------------------------------------------- PDAs

  poolPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('pool')], this.programId!)[0];
  }
  solVaultPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('sol_vault')], this.programId!)[0];
  }
  lpMintPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from('lp_mint')], this.programId!)[0];
  }

  // ----------------------------------------------------------- queries

  async poolInfo() {
    if (!this.enabled) return { enabled: false };
    const pool = this.poolPda();
    const poolScad = ata(this.scadMint!, pool);
    const [scadAcct, solRes, lpMintInfo] = await Promise.all([
      this.connection.getTokenAccountBalance(poolScad).catch(() => null),
      this.connection.getBalance(this.solVaultPda()),
      this.connection.getTokenSupply(this.lpMintPda()).catch(() => null),
    ]);
    const scadRes = BigInt(scadAcct?.value.amount ?? '0');
    const sol = BigInt(solRes);
    // price (USD per SCAD) = (solRes/scadRes) × USD_PER_SOL
    const priceUsd =
      scadRes > 0n ? (Number(sol) / Number(scadRes)) * USD_PER_SOL : 0;
    const tvlUsd = (Number(sol) / 1e9) * USD_PER_SOL * 2;
    return {
      enabled: true,
      programId: this.programId!.toBase58(),
      pool: pool.toBase58(),
      scadMint: this.scadMint!.toBase58(),
      scadReserve: scadRes.toString(),
      solReserve: sol.toString(),
      lpSupply: lpMintInfo?.value.amount ?? '0',
      feeBps: 100,
      priceUsd,
      tvlUsd,
    };
  }

  /** Recent swaps decoded from on-chain events (10s cache). */
  async recentTrades(limit = 25): Promise<SwapTradeRow[]> {
    if (!this.enabled) return [];
    if (this.tradesCache && Date.now() - this.tradesCache.at < 10_000) {
      return this.tradesCache.rows.slice(0, limit);
    }
    const pool = this.poolPda();
    const sigs = await this.connection.getSignaturesForAddress(pool, { limit: 50 });
    const txs = await this.connection.getTransactions(
      sigs.map((s) => s.signature),
      { commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    );
    const disc = eventDiscriminator('Swapped');
    const rows: SwapTradeRow[] = [];
    for (let i = 0; i < txs.length; i++) {
      const tx = txs[i];
      if (!tx?.meta?.logMessages) continue;
      for (const log of tx.meta.logMessages) {
        if (!log.startsWith('Program data: ')) continue;
        const buf = Buffer.from(log.slice('Program data: '.length), 'base64');
        if (buf.length < 8 + 32 + 1 + 8 + 8 || !buf.subarray(0, 8).equals(disc)) continue;
        const user = new PublicKey(buf.subarray(8, 40)).toBase58();
        const solToScad = buf[40] === 1;
        const amountIn = buf.readBigUInt64LE(41);
        const amountOut = buf.readBigUInt64LE(49);
        const scad = solToScad ? amountOut : amountIn;
        const sol = solToScad ? amountIn : amountOut;
        rows.push({
          signature: sigs[i]!.signature,
          user,
          side: solToScad ? 'buy' : 'sell',
          scadAmount: scad.toString(),
          solAmount: sol.toString(),
          priceUsd: scad > 0n ? (Number(sol) / Number(scad)) * USD_PER_SOL : 0,
          blockTime: tx.blockTime ?? null,
        });
      }
    }
    this.tradesCache = { at: Date.now(), rows };
    return rows.slice(0, limit);
  }

  async recentBurns(limit = 20) {
    const rows = await this.prisma.tokenBurn.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    const total = await this.prisma.tokenBurn.aggregate({ _sum: { scadBurned: true } });
    return {
      totalBurned: (total._sum.scadBurned ?? BigInt(0)).toString(),
      burns: rows.map((r) => ({
        id: r.id,
        scadBurned: r.scadBurned.toString(),
        solSpent: r.solSpent.toString(),
        swapSignature: r.swapSignature,
        burnSignature: r.burnSignature,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async assertAdmin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role !== 'admin') {
      throw new ForbiddenException('Admin access required');
    }
  }

  // ----------------------------------------------------- buy & burn job

  /**
   * Buy-and-burn is RETIRED: $SCAD is a pure Proof-of-Play mining token, not a
   * deflationary one, so `ENGINE.BUYBACK_NGR_BPS` is `0` and this job is an
   * explicit no-op. The slice that once funded buy-and-burn now flows entirely to
   * stakers as the USDS dividend (see DistributionService, 12% of NGR). The job +
   * queue are kept (not deleted) so re-enabling is a one-constant change and the
   * worker wiring stays stable.
   */
  async runBuyAndBurn(): Promise<void> {
    if (ENGINE.BUYBACK_NGR_BPS === 0) return; // retired — $SCAD has no protocol burn
    if (!this.enabled || !this.cosigner) return;
    try {
      const lastBurn = await this.prisma.tokenBurn.findFirst({
        orderBy: { createdAt: 'desc' },
      });
      const since = lastBurn?.createdAt ?? new Date(0);
      const agg = await this.prisma.bet.aggregate({
        where: { createdAt: { gt: since } },
        _sum: { amountLamports: true, payoutLamports: true },
      });
      const stakes = agg._sum.amountLamports ?? BigInt(0);
      const payouts = agg._sum.payoutLamports ?? BigInt(0);
      const ngr = stakes - payouts;
      if (ngr <= BigInt(0)) return;
      const burnBudget = buybackBudgetLamports(ngr); // 0 while BUYBACK_NGR_BPS=0
      if (burnBudget < BigInt(1_000_000)) return; // skip dust (<0.001 SOL)

      // 1) Swap SOL→SCAD as the cosigner (own wallet SOL funds the buy).
      const swapSig = await this.cosignerSwapSolToScad(burnBudget);
      if (!swapSig) return;
      // 2) Burn the received SCAD from the cosigner ATA.
      const scadAta = ata(this.scadMint!, this.cosigner.publicKey);
      const bal = await this.connection.getTokenAccountBalance(scadAta);
      const scadAmount = BigInt(bal.value.amount);
      if (scadAmount === BigInt(0)) return;
      const burnSig = await this.burnScad(scadAta, scadAmount);

      await this.prisma.tokenBurn.create({
        data: {
          scadBurned: scadAmount,
          solSpent: burnBudget,
          swapSignature: swapSig,
          burnSignature: burnSig,
        },
      });
      this.logger.log(
        `buy&burn: ${Number(burnBudget) / 1e9} SOL → ${Number(scadAmount) / 1e9} SCAD burned`,
      );
    } catch (e) {
      this.logger.error(`buy&burn failed: ${(e as Error).message}`);
    }
  }

  private async cosignerSwapSolToScad(lamports: bigint): Promise<string | null> {
    const user = this.cosigner!.publicKey;
    // #31: a 0 min_out makes every automated burn sandwichable. Compute the
    // expected output from CURRENT reserves and tolerate at most
    // SWAP.MAX_SLIPPAGE_BPS — if the pool moves further before we land, the
    // program reverts (SlippageExceeded) and this burn run simply aborts.
    const poolScadAta = ata(this.scadMint!, this.poolPda());
    const [scadAcct, solRes] = await Promise.all([
      this.connection.getTokenAccountBalance(poolScadAta).catch(() => null),
      this.connection.getBalance(this.solVaultPda()),
    ]);
    const scadReserve = BigInt(scadAcct?.value.amount ?? '0');
    const expected = expectedSwapOut(lamports, BigInt(solRes), scadReserve, BigInt(SWAP.FEE_BPS));
    if (expected <= 0n) {
      this.logger.warn('buy&burn: pool has no usable reserves — skipping');
      return null;
    }
    const minOut = minOutWithSlippage(expected);
    const data = Buffer.concat([
      ixDiscriminator('swap'),
      Buffer.from([1]), // sol_to_scad = true
      u64le(lamports),
      u64le(minOut),
    ]);
    const ix = new TransactionInstruction({
      programId: this.programId!,
      keys: [
        { pubkey: this.poolPda(), isSigner: false, isWritable: false },
        { pubkey: this.solVaultPda(), isSigner: false, isWritable: true },
        { pubkey: ata(this.scadMint!, this.poolPda()), isSigner: false, isWritable: true },
        { pubkey: ata(this.scadMint!, user), isSigner: false, isWritable: true },
        { pubkey: this.scadMint!, isSigner: false, isWritable: false },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });
    try {
      return await sendAndConfirmTransaction(
        this.connection,
        new Transaction().add(ix),
        [this.cosigner!],
        { commitment: 'confirmed' },
      );
    } catch (e) {
      this.logger.error(`burn swap failed: ${(e as Error).message}`);
      return null;
    }
  }

  private async burnScad(from: PublicKey, amount: bigint): Promise<string | null> {
    // SPL Token Burn instruction (index 8): [8, amount u64le]
    const data = Buffer.concat([Buffer.from([8]), u64le(amount)]);
    const ix = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: from, isSigner: false, isWritable: true },
        { pubkey: this.scadMint!, isSigner: false, isWritable: true },
        { pubkey: this.cosigner!.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });
    try {
      return await sendAndConfirmTransaction(
        this.connection,
        new Transaction().add(ix),
        [this.cosigner!],
        { commitment: 'confirmed' },
      );
    } catch (e) {
      this.logger.error(`scad burn failed: ${(e as Error).message}`);
      return null;
    }
  }
}

function u64le(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}
