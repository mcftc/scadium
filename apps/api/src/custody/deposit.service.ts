import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type CustodyHoldReason, type CustodyTransfer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { withSerializable } from '../prisma/with-serializable';
import { RgService } from '../responsible-gambling/rg.service';
import { custodyConfig } from './custody.config';
import { CustodyRuntime } from './custody-runtime';
import { openPlayPositions } from './economy';
import type { TreasuryTx } from './custody-chain';

type Db = Prisma.TransactionClient | PrismaService;

/** The treasury history scanner's cursor row. */
const CURSOR_KEY = 'custody-treasury';
/** Held deposits retried per scan (oldest first). */
const HOLD_RETRY_BATCH = 100;

/**
 * Deposits (spec §6.1): a player sends SOL from their own wallet to the
 * treasury; this turns a VERIFIED transfer into balance, exactly once.
 *
 *  - Verification reads the treasury's balance change in the transaction, not
 *    its instructions, so any transfer shape counts and nothing client-reported
 *    is trusted. The sender is the signer that belongs to an account.
 *  - `txSignature` is unique: a replayed signature records nothing and credits
 *    nothing. Crediting runs Serializable and only from `held`.
 *  - A deposit that cannot be credited yet is HELD with a reason (the SOL has
 *    already arrived — there is nothing to refuse) and retried on every scan.
 *  - The first credit converts the account (economy.ts): the play-money
 *    seed and every play-era perk are forfeited in the same transaction.
 */
@Injectable()
export class DepositService {
  private readonly logger = new Logger(DepositService.name);
  /** The scan in progress in this process — concurrent callers share it. */
  private scanning: Promise<{ recorded: number; credited: number }> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: CustodyRuntime,
    private readonly rg: RgService,
  ) {}

  /** POST /custody/deposits — verify and credit one signature. `pending` = not visible yet. */
  async confirm(signature: string): Promise<CustodyTransfer | { status: 'pending' }> {
    const { treasury } = this.runtime.requireActive();
    const known = await this.prisma.custodyTransfer.findUnique({ where: { txSignature: signature } });
    if (known) {
      if (known.kind !== 'deposit') throw new BadRequestException('Not a deposit');
      return known.status === 'held' ? this.credit(known.id) : known;
    }
    const tx = await this.runtime.chain.treasuryTx(signature, treasury);
    if (tx.kind === 'missing') return { status: 'pending' };
    if (tx.kind !== 'inbound') throw new BadRequestException('Not a deposit to the treasury');
    const row = await this.record(signature, tx);
    if (!row) {
      throw new BadRequestException(
        'Below the minimum deposit, from a wallet that is not linked to any account',
      );
    }
    return row.status === 'held' ? this.credit(row.id) : row;
  }

  /**
   * Walk the treasury's history from the cursor, recording every inbound
   * transfer, then retry held deposits. Idempotent; safe to run from the job,
   * the cron and a user's "check now" at once.
   */
  scan(): Promise<{ recorded: number; credited: number }> {
    this.scanning ??= this.scanOnce().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  private async scanOnce(): Promise<{ recorded: number; credited: number }> {
    const { treasury } = this.runtime.requireActive();
    const cursor = await this.prisma.scanCursor.findUnique({ where: { key: CURSOR_KEY } });
    const signatures = await this.runtime.chain.signaturesSince(
      treasury,
      cursor?.signature ?? null,
      custodyConfig().scanPage,
    );
    let recorded = 0;
    for (const s of signatures) {
      const known = await this.prisma.custodyTransfer.findUnique({
        where: { txSignature: s.signature },
        select: { id: true },
      });
      if (!known) {
        const tx = await this.runtime.chain.treasuryTx(s.signature, treasury);
        // Listed at our commitment but not fetchable yet — stop here and resume next scan.
        if (tx.kind === 'missing') break;
        if (tx.kind === 'inbound' && (await this.record(s.signature, tx))) recorded += 1;
      }
      await this.prisma.scanCursor.upsert({
        where: { key: CURSOR_KEY },
        create: { key: CURSOR_KEY, signature: s.signature, slot: s.slot },
        update: { signature: s.signature, slot: s.slot },
      });
    }
    return { recorded, credited: await this.retryHeld() };
  }

  /** Try every held deposit again (a wallet got linked, bets settled, a new day began). */
  async retryHeld(): Promise<number> {
    const held = await this.prisma.custodyTransfer.findMany({
      where: { kind: 'deposit', status: 'held' },
      orderBy: { createdAt: 'asc' },
      take: HOLD_RETRY_BATCH,
      select: { id: true },
    });
    let credited = 0;
    for (const { id } of held) {
      try {
        if ((await this.credit(id)).status === 'credited') credited += 1;
      } catch (e) {
        this.logger.error(`deposit ${id}: credit failed: ${(e as Error).message}`);
      }
    }
    return credited;
  }

  /** Insert the deposit row once. Null for dust from an unknown wallet (no row at all). */
  private async record(
    signature: string,
    tx: Extract<TreasuryTx, { kind: 'inbound' }>,
  ): Promise<CustodyTransfer | null> {
    const owners = await this.owners(this.prisma, tx.signers);
    const owner = owners.size === 1 ? [...owners][0]! : null;
    if (owners.size === 0 && tx.amount < custodyConfig().minDepositLamports) return null;
    try {
      return await this.prisma.custodyTransfer.create({
        data: {
          kind: 'deposit',
          status: 'held',
          // Several accounts signed: the delta cannot say whose SOL it was.
          heldReason: owner ? null : owners.size > 1 ? 'ambiguous_sender' : 'unattributed',
          userId: owner?.[0] ?? null,
          // The account's wallet when known, else the fee payer.
          wallet: owner?.[1] ?? tx.signers[0] ?? '',
          amountLamports: tx.amount,
          txSignature: signature,
          slot: tx.slot,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.prisma.custodyTransfer.findUnique({ where: { txSignature: signature } });
      }
      throw e;
    }
  }

  /** Credit a held deposit, or re-hold it with the current reason. */
  private credit(id: string): Promise<CustodyTransfer> {
    return withSerializable(this.prisma, async (tx) => {
      const row = await tx.custodyTransfer.findUniqueOrThrow({ where: { id } });
      // Credited already, or signed by several accounts (resolved by hand only).
      if (row.status !== 'held' || row.heldReason === 'ambiguous_sender') return row;
      const hold = (heldReason: CustodyHoldReason, userId: string | null = row.userId) =>
        tx.custodyTransfer.update({ where: { id }, data: { heldReason, userId } });

      const found = row.userId ? null : await this.owners(tx, [row.wallet]);
      const userId = row.userId ?? (found?.size === 1 ? [...found.keys()][0]! : null);
      if (!userId) return hold('unattributed', null);
      if (row.amountLamports < custodyConfig().minDepositLamports) return hold('below_minimum', userId);
      const blocked = await this.rg.depositBlock(tx, userId, row.amountLamports);
      if (blocked) return hold(blocked, userId);

      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { fundedAt: true, playBalanceLamports: true },
      });
      if (!user.fundedAt) {
        if ((await openPlayPositions(tx, userId)).length > 0) {
          return hold('open_play_positions', userId);
        }
        await this.convert(tx, userId, user.playBalanceLamports, id);
      }
      await applyBalanceDelta(tx, userId, row.amountLamports, {
        reason: 'custody_deposit',
        refType: 'CustodyTransfer',
        refId: id,
      });
      return tx.custodyTransfer.update({
        where: { id },
        data: { status: 'credited', userId, heldReason: null, settledAt: new Date() },
      });
    });
  }

  /**
   * First deposit: the account becomes real money. Everything earned with play
   * money goes — the balance, unclaimed referral commission, earned free lottery
   * tickets — so none of it can be withdrawn.
   */
  private async convert(
    tx: Prisma.TransactionClient,
    userId: string,
    playBalance: bigint,
    transferId: string,
  ): Promise<void> {
    if (playBalance > 0n) {
      await applyBalanceDelta(tx, userId, -playBalance, {
        reason: 'custody_conversion',
        refType: 'CustodyTransfer',
        refId: transferId,
      });
    }
    await tx.$executeRaw`
      UPDATE "Referral" SET "commissionClaimedLamports" = "commissionLamports"
      WHERE "referrerId" = ${userId}::uuid AND "commissionClaimedLamports" < "commissionLamports"`;
    await tx.$executeRaw`
      UPDATE "User" SET "fundedAt" = NOW(), "freeTicketBaselineWagered" = "totalWagered"
      WHERE "id" = ${userId}::uuid`;
    this.logger.log(`user ${userId} converted to custody (play seed ${playBalance} forfeited)`);
  }

  /** Accounts owning any of `wallets` (primary or linked): userId → the matching wallet. */
  private async owners(db: Db, wallets: string[]): Promise<Map<string, string>> {
    const owners = new Map<string, string>();
    if (wallets.length === 0) return owners;
    const primary = await db.user.findMany({
      where: { walletAddress: { in: wallets } },
      select: { id: true, walletAddress: true },
    });
    const linked = await db.linkedWallet.findMany({
      where: { address: { in: wallets } },
      select: { userId: true, address: true },
    });
    for (const u of primary) owners.set(u.id, u.walletAddress);
    for (const l of linked) if (!owners.has(l.userId)) owners.set(l.userId, l.address);
    return owners;
  }
}
