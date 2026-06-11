import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { applyBalanceDelta } from '../prisma/apply-balance-delta';
import { ChainService } from './chain.service';

/**
 * Vault ↔ spendable-balance bridge (#27): converts VERIFIED on-chain custody
 * movements into the single Postgres spendable balance the games debit.
 *
 * - Crediting is keyed on the deposit tx signature (VaultTransfer.txSignature
 *   @unique): a replayed signature inserts nothing and credits nothing.
 * - Amounts come from the PROGRAM's own Deposited/Withdrawn events
 *   (ChainService.verifyVaultTransfer) — client-reported numbers are ignored.
 * - The FIRST verified deposit converts the account to custody-backed: the
 *   non-withdrawable 10 SOL play seed is forfeited and the spendable balance
 *   becomes exactly the deposited lamports (User.vaultAddress records the
 *   conversion). From then on the balance is a cache of vault custody ±
 *   settled-but-unswept play, reconciled by `fundedDrift`.
 * - Withdraw is user-signed on chain (non-custodial); the API only LEARNS of
 *   it and debits the mirror. If the user withdrew more than the mirror held
 *   (possible: they can sign withdraws without telling us), we clamp the debit
 *   to the available balance and flag the shortfall as drift.
 */
@Injectable()
export class VaultBridgeService {
  private readonly logger = new Logger(VaultBridgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chain: ChainService,
  ) {}

  async confirmDeposit(userId: string, walletAddress: string, signature: string) {
    this.assertEnabled();
    const event = await this.chain.verifyVaultTransfer(signature, walletAddress, 'deposit');
    if (!event) throw new BadRequestException('Deposit not found, failed, or not yours');

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.vaultTransfer.create({
          data: { userId, txSignature: signature, kind: 'deposit', amountLamports: event.amount },
        });
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { vaultAddress: true, playBalanceLamports: true },
        });
        if (!user.vaultAddress) {
          // First deposit — convert to custody-backed: forfeit the play seed so
          // the spendable balance equals real vault lamports from here on.
          await applyBalanceDelta(tx, userId, -user.playBalanceLamports, {
            reason: 'vault_funded_conversion',
            refType: 'VaultTransfer',
            refId: signature,
          });
          await tx.user.update({
            where: { id: userId },
            data: { vaultAddress: this.chain.userVaultPdaBase58(walletAddress) },
          });
        }
        await applyBalanceDelta(tx, userId, event.amount, {
          reason: 'vault_deposit',
          refType: 'VaultTransfer',
          refId: signature,
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Replayed signature — already credited exactly once. Idempotent no-op.
        return this.snapshot(userId);
      }
      throw e;
    }
    return this.snapshot(userId);
  }

  async confirmWithdraw(userId: string, walletAddress: string, signature: string) {
    this.assertEnabled();
    const event = await this.chain.verifyVaultTransfer(signature, walletAddress, 'withdraw');
    if (!event) throw new BadRequestException('Withdrawal not found, failed, or not yours');

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.vaultTransfer.create({
          data: { userId, txSignature: signature, kind: 'withdraw', amountLamports: event.amount },
        });
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { playBalanceLamports: true },
        });
        // Non-custodial reality: the lamports are already gone on chain. Debit
        // what the mirror holds; a shortfall is drift, not a reason to block.
        const debit =
          user.playBalanceLamports >= event.amount ? event.amount : user.playBalanceLamports;
        if (debit < event.amount) {
          this.logger.error(
            `vault drift: user ${userId} withdrew ${event.amount} on-chain but the mirror held ${user.playBalanceLamports}`,
          );
        }
        if (debit > 0n) {
          await applyBalanceDelta(tx, userId, -debit, {
            reason: 'vault_withdraw',
            refType: 'VaultTransfer',
            refId: signature,
          });
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return this.snapshot(userId); // replay — already debited
      }
      throw e;
    }
    return this.snapshot(userId);
  }

  private async snapshot(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { playBalanceLamports: true, vaultAddress: true },
    });
    return {
      spendableLamports: user.playBalanceLamports.toString(),
      funded: user.vaultAddress !== null,
    };
  }

  private assertEnabled() {
    if (!this.chain.enabled) {
      throw new ServiceUnavailableException('On-chain custody is not enabled');
    }
  }
}
