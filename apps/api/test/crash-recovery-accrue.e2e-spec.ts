import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SCAD } from '@scadium/shared';
import { prisma, makeUser, makeSeed, makeCrashEngineWithPow } from './engine-harness';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/**
 * #182 — crash crash-recovery (`recoverStrandedRounds`) must mint the
 * wager-mining $SCAD the live-settle path credits. Before the fix recovery
 * credited the play balance + wrote the Bet row but SKIPPED
 * `proofOfWager.accrue()`, so a restart between bet and bust silently dropped
 * the $SCAD the player earned. The Engine coverage contract requires every
 * settlement to accrue.
 *
 * Proves: a recovered stranded crash bet (a) credits $SCAD = stake × rate, (b)
 * writes a `scad` BalanceLedger row, and (c) leaves `scadLedgerDrift()` at ZERO.
 */
const reconciliation = new ReconciliationService(
  prisma as never,
  { enabled: false, lotteryEnabled: false } as never,
);

const recover = (engine: unknown) =>
  (engine as Record<string, () => Promise<unknown>>).recoverStrandedRounds!();

describe('#182 — crash recovery mints wager-mining $SCAD', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a recovered stranded crash bet accrues $SCAD with a scad ledger row, zero drift', async () => {
    const seed = await makeSeed();
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'running' },
    });
    const u = await makeUser(0n);
    const stake = 100_000_000n; // 0.1 SOL — partially cashed so it WON
    await prisma.crashBet.create({
      data: {
        roundId: round.id,
        userId: u.id,
        amountLamports: stake,
        remainingLamports: 0n,
        payoutLamports: 250_000_000n, // locked-in cashout 2.5×
        cashoutMultiplier: 2.5,
        won: true,
      },
    });

    await recover(makeCrashEngineWithPow());

    // Round settled.
    expect((await prisma.crashRound.findUniqueOrThrow({ where: { id: round.id } })).status).toBe(
      'busted',
    );

    // $SCAD was minted (the #182 fix) — tier 0, no campaign → stake × base rate.
    const expectedScad = stake * BigInt(SCAD.WAGER_REWARD_PER_LAMPORT);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.scadiumBalance).toBe(expectedScad);

    // A `scad` BalanceLedger row was written by accrue → applyBalanceDelta.
    const ledger = await prisma.balanceLedger.findFirst({
      where: { userId: u.id, currency: 'scad', reason: 'wager_reward' },
      orderBy: { createdAt: 'desc' },
    });
    expect(ledger).not.toBeNull();
    expect(ledger!.delta).toBe(expectedScad);
    expect(ledger!.balanceAfter).toBe(after.scadiumBalance);
    // refId references the recovered Bet row.
    const bet = await prisma.bet.findFirstOrThrow({
      where: { userId: u.id, gameType: 'crash' },
    });
    expect(ledger!.refId).toBe(bet.id);

    // scad ledger reconciles cleanly.
    await prisma.reconciliationDrift.deleteMany({ where: { userId: u.id } });
    await reconciliation.scadLedgerDrift();
    expect(
      await prisma.reconciliationDrift.count({
        where: { userId: u.id, field: 'scadiumBalance' },
      }),
    ).toBe(0);
  });
});
