import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma, makeUser, makeSeed, makeCrashEngineWithPow } from './engine-harness';

/**
 * #182 — crash crash-recovery (`recoverStrandedRounds`) must run the same
 * `proofOfWager.accrue()` the live-settle path runs, so a restart between bet
 * and bust doesn't drop the player out of the engine. Under Engine v2 (E3)
 * accrue no longer MINTS $SCAD per bet — it records wager VOLUME into the
 * leaderboard buckets (the play-rate source the hourly block worker splits by) —
 * so this proves a recovered stranded crash bet (a) settles the round, (b)
 * writes the Bet row, and (c) records the wager into the leaderboard.
 */
const recover = (engine: unknown) =>
  (engine as Record<string, () => Promise<unknown>>).recoverStrandedRounds!();

describe('#182 — crash recovery records wager volume (Engine v2)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a recovered stranded crash bet settles and records its wager into the leaderboard', async () => {
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

    // The Bet row was written (history + the play-rate source the block reads).
    const bet = await prisma.bet.findFirstOrThrow({
      where: { userId: u.id, gameType: 'crash' },
    });
    expect(bet.amountLamports).toBe(stake);

    // accrue() recorded the wager into the leaderboard buckets (no per-bet $SCAD
    // mint anymore — the hourly block worker mints from this volume).
    const buckets = await prisma.wagerLeaderboard.findMany({ where: { userId: u.id } });
    expect(buckets.length).toBeGreaterThanOrEqual(1);
    for (const b of buckets) expect(b.wageredLamports).toBe(stake);

    // No per-bet $SCAD was credited.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(after.scadiumBalance).toBe(0n);
  });
});
