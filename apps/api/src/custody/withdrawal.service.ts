import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CustodyTransfer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { withSerializable } from '../prisma/with-serializable';
import { claimIdempotency, storeIdempotency } from '../prisma/idempotency';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { treasuryPayoutBlockedTotal } from '../observability/metrics.registry';
import { custodyConfig } from './custody.config';
import { CustodyRuntime } from './custody-runtime';
import { transferView, type TransferView } from './transfer-view';

const IDEMPOTENCY_SCOPE = 'custody-withdraw';
/** How often an in-flight withdrawal is re-checked while its request is being driven. */
const POLL_MS = 2_000;
/** How long one drive keeps polling before leaving the rest to the job (> a blockhash's life). */
const DRIVE_MS = 150_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Withdrawals (spec §6.2): the hot wallet sends SOL to the player's own wallet.
 *
 * The one rule that makes it safe: a row never has two live signatures. The
 * transfer is signed, its signature and the blockhash's `lastValidBlockHeight`
 * are STORED (CAS pending → sent), and only then broadcast. A new signature is
 * made only once the stored one is provably dead — it failed at the commitment
 * (no value moved), or the FINALIZED block height passed its expiry (plus a
 * margin) without it appearing, after which it can never land. A refund happens only on that same
 * proof. There is no "the send threw, so restore" path (the C4 bug).
 */
@Injectable()
export class WithdrawalService implements OnModuleDestroy {
  private readonly logger = new Logger(WithdrawalService.name);
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: CustodyRuntime,
    private readonly maintenance: MaintenanceService,
  ) {}

  onModuleDestroy(): void {
    this.stopped = true;
  }

  /** POST /custody/withdrawals — debit and queue, then drive it in the background. */
  async request(
    userId: string,
    params: { amountLamports: bigint; wallet?: string },
    idempotencyKey?: string,
  ): Promise<TransferView> {
    this.runtime.requireActive();
    const cfg = custodyConfig();
    const amount = params.amountLamports;
    if (amount < cfg.minWithdrawLamports) {
      throw new BadRequestException(`The minimum withdrawal is ${cfg.minWithdrawLamports} lamports`);
    }
    if (amount > cfg.maxWithdrawLamports) {
      throw new BadRequestException(`The maximum withdrawal is ${cfg.maxWithdrawLamports} lamports`);
    }
    if (await this.maintenance.isPaused()) {
      throw new ServiceUnavailableException('Withdrawals are paused for maintenance');
    }

    const view = await withSerializable(this.prisma, async (tx) => {
      const replay = await claimIdempotency(tx, userId, IDEMPOTENCY_SCOPE, idempotencyKey);
      if (replay) return replay as TransferView;

      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          fundedAt: true,
          walletAddress: true,
          linkedWallets: { select: { address: true } },
        },
      });
      if (!user.fundedAt) {
        throw new ForbiddenException('Only deposited funds can be withdrawn — deposit first');
      }
      const wallet = params.wallet ?? user.walletAddress;
      const own = [user.walletAddress, ...user.linkedWallets.map((w) => w.address)];
      if (!own.includes(wallet)) {
        throw new BadRequestException('Withdrawals go only to a wallet linked to your account');
      }
      const inFlight = await tx.custodyTransfer.count({
        where: { userId, kind: 'withdraw', status: { in: ['pending', 'sent'] } },
      });
      if (inFlight > 0) throw new ConflictException('A withdrawal is already in progress');
      const today = await tx.custodyTransfer.aggregate({
        where: {
          userId,
          kind: 'withdraw',
          status: { in: ['pending', 'sent', 'confirmed'] },
          createdAt: { gte: startOfUtcDay() },
        },
        _sum: { amountLamports: true },
      });
      if ((today._sum.amountLamports ?? 0n) + amount > cfg.dailyWithdrawLamports) {
        throw new ForbiddenException('Daily withdrawal limit reached');
      }

      const row = await tx.custodyTransfer.create({
        data: { kind: 'withdraw', status: 'pending', userId, wallet, amountLamports: amount },
      });
      await applyBalanceDelta(tx, userId, -amount, {
        reason: 'custody_withdraw',
        refType: 'CustodyTransfer',
        refId: row.id,
      });
      const out = transferView(row);
      await storeIdempotency(tx, userId, IDEMPOTENCY_SCOPE, idempotencyKey, out);
      return out;
    });

    void this.drive(view.id).catch((e) =>
      this.logger.error(`withdrawal ${view.id}: ${(e as Error).message}`),
    );
    return view;
  }

  /** Resume every unfinished withdrawal (job, boot). */
  async resumeAll(): Promise<void> {
    if (!this.runtime.active) return;
    const open = await this.prisma.custodyTransfer.findMany({
      where: { kind: 'withdraw', status: { in: ['pending', 'sent'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    for (const { id } of open) {
      try {
        await this.step(id);
      } catch (e) {
        this.logger.error(`withdrawal ${id}: ${(e as Error).message}`);
      }
    }
  }

  /** Step a withdrawal until it settles or the drive window closes (the job picks up the rest). */
  async drive(id: string, windowMs = DRIVE_MS): Promise<CustodyTransfer> {
    const deadline = Date.now() + windowMs;
    let row = await this.step(id);
    while (!this.stopped && (row.status === 'pending' || row.status === 'sent') && Date.now() < deadline) {
      await sleep(POLL_MS);
      row = await this.step(id);
    }
    return row;
  }

  /**
   * One transition, decided from the stored state and the chain:
   *  - pending: sign, store the signature, broadcast (or wait for the hot wallet)
   *  - sent: confirmed / still in flight / dead → re-sign or refund
   */
  async step(id: string): Promise<CustodyTransfer> {
    const row = await this.prisma.custodyTransfer.findUniqueOrThrow({ where: { id } });
    if (row.kind !== 'withdraw') return row;
    if (row.status === 'pending') return this.send(row);
    if (row.status === 'sent') return this.check(row);
    return row;
  }

  private async send(row: CustodyTransfer): Promise<CustodyTransfer> {
    const cfg = custodyConfig();
    if (row.attempts >= cfg.withdrawMaxAttempts) return this.refund(row, 'no signature landed');
    // The global pause stops money leaving: nothing new is signed while it is on.
    // (A signature already broadcast is still followed to its outcome.)
    if (await this.maintenance.isPaused()) return row;
    const { keypair, treasury } = this.runtime.requireActive();
    const chain = this.runtime.chain;
    const hot = await chain.balance(treasury);
    if (hot < row.amountLamports + cfg.feeReserveLamports) {
      treasuryPayoutBlockedTotal.inc({ kind: 'custody_withdraw' });
      this.logger.error(
        `withdrawal ${row.id} waits: hot wallet ${hot} < ${row.amountLamports} + fee reserve — top it up`,
      );
      return row;
    }
    const signed = await chain.signTransfer(keypair, row.wallet, row.amountLamports, `scadium:w:${row.id}`);
    // The signature is durable BEFORE anything is broadcast. The attempt count in
    // the guard means a peer that signed concurrently cannot also claim the row.
    const { count } = await this.prisma.custodyTransfer.updateMany({
      where: { id: row.id, status: 'pending', attempts: row.attempts },
      data: {
        status: 'sent',
        txSignature: signed.signature,
        lastValidBlockHeight: signed.lastValidBlockHeight,
        attempts: row.attempts + 1,
        error: null,
      },
    });
    if (count === 0) return this.prisma.custodyTransfer.findUniqueOrThrow({ where: { id: row.id } });
    try {
      await chain.broadcast(signed.raw);
    } catch (e) {
      // Advisory only: the signature's fate is read from the chain, never assumed.
      this.logger.warn(`withdrawal ${row.id}: broadcast reported ${(e as Error).message}`);
    }
    return this.prisma.custodyTransfer.findUniqueOrThrow({ where: { id: row.id } });
  }

  private async check(row: CustodyTransfer): Promise<CustodyTransfer> {
    const chain = this.runtime.chain;
    const signature = row.txSignature!;
    // Height BEFORE status: "unseen" only counts if it was unseen after the
    // expiry height was already final.
    const finalized = await chain.finalizedBlockHeight();
    const state = await chain.signatureState(signature);
    if (state.found) {
      // Seen but not at the commitment yet — success or failure alike, a fork
      // could still change it.
      if (!state.settled) return row;
      if (!state.failed) {
        const { count } = await this.prisma.custodyTransfer.updateMany({
          where: { id: row.id, status: 'sent', txSignature: signature },
          data: { status: 'confirmed', slot: state.slot, settledAt: new Date() },
        });
        if (count === 1) this.logger.log(`withdrawal ${row.id} confirmed: ${signature}`);
        return this.prisma.custodyTransfer.findUniqueOrThrow({ where: { id: row.id } });
      }
    } else {
      // Unseen: it may still land until its blockhash expires — plus a margin,
      // so a lagging RPC node cannot make a live signature look dead.
      const margin = BigInt(custodyConfig().expiryMarginBlocks);
      if (finalized <= row.lastValidBlockHeight! + margin) return row;
    }
    // Dead: landed with an error (nothing moved) or expired unseen.
    const why = state.found ? `failed on chain: ${signature}` : `expired unseen: ${signature}`;
    if (row.attempts >= custodyConfig().withdrawMaxAttempts) return this.refund(row, why);
    await this.prisma.custodyTransfer.updateMany({
      where: { id: row.id, status: 'sent', txSignature: signature },
      data: { status: 'pending', txSignature: null, lastValidBlockHeight: null, error: why },
    });
    this.logger.warn(`withdrawal ${row.id}: ${why} — re-signing`);
    return this.prisma.custodyTransfer.findUniqueOrThrow({ where: { id: row.id } });
  }

  /** Give the stake back — only ever after the last signature is provably dead. */
  private async refund(row: CustodyTransfer, why: string): Promise<CustodyTransfer> {
    return withSerializable(this.prisma, async (tx) => {
      const { count } = await tx.custodyTransfer.updateMany({
        where: { id: row.id, status: row.status, txSignature: row.txSignature },
        data: { status: 'failed', error: why, settledAt: new Date() },
      });
      if (count === 1) {
        await applyBalanceDelta(tx, row.userId!, row.amountLamports, {
          reason: 'custody_withdraw_refund',
          refType: 'CustodyTransfer',
          refId: row.id,
        });
        this.logger.error(`withdrawal ${row.id} refunded: ${why}`);
      }
      return tx.custodyTransfer.findUniqueOrThrow({ where: { id: row.id } });
    });
  }
}
