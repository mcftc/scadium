import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, makeUser, makeCrashEngine } from './engine-harness';

/**
 * H3 — a crash auto-cashout whose target is below the committed bust point must
 * pay at that target, deterministically, regardless of tick granularity.
 *
 * The 20 Hz tick can sample a multiplier that has already jumped PAST the bust
 * point (e.g. target 2.02, bust 2.03, a tick lands at 2.61). runAutoCashouts is
 * called with that sampled `m` BEFORE the bust check, so it must still cash the
 * winning bet out at its committed target — the old code re-derived the live
 * multiplier inside cashOut, saw it >= bust, and threw, voiding the win.
 */
describe('crash auto-cashout pays the committed target below bust (H3)', () => {
  it('a target below bust is paid at the target even when the sampled multiplier is past bust', async () => {
    const uniq = randomUUID();
    const seed = await prisma.seed.create({
      data: { serverSeed: `srv-${uniq}`, serverSeedHash: `hash-${uniq}`, clientSeed: `cli-${uniq}`, nonce: 0 },
    });
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'running' },
    });
    const user = await makeUser(0n);
    // Durable bet row (cashOut persists the partial/settled state onto it).
    await prisma.crashBet.create({
      data: {
        roundId: round.id,
        userId: user.id,
        amountLamports: 1_000n,
        remainingLamports: 1_000n,
        payoutLamports: 0n,
        autoCashoutMultiplier: 2.02,
      },
    });

    const engine = makeCrashEngine();
    (engine as unknown as { current: unknown }).current = {
      id: round.id,
      seedId: seed.id,
      serverSeed: `srv-${uniq}`,
      serverSeedHash: `hash-${uniq}`,
      clientSeed: `cli-${uniq}`,
      nonce: 0,
      bustPoint: 2.03, // target 2.02 < bust 2.03 → the player WINS at 2.02
      phase: 'running',
      // Far enough in the past that currentMultiplier() is already well ABOVE
      // the bust point — i.e. a tick that jumped straight past bust.
      startedAt: Date.now() - 4_000,
      bets: new Map([
        [
          user.id,
          {
            userId: user.id,
            username: null,
            walletAddress: 'w1',
            amountLamports: 1_000n,
            originalAmountLamports: 1_000n,
            payoutLamports: 0n,
            autoCashout: 2.02,
            cashedOutAt: null,
          },
        ],
      ]),
    };

    const sampledPastBust = (engine as unknown as { currentMultiplier(): number }).currentMultiplier();
    expect(sampledPastBust).toBeGreaterThanOrEqual(2.03); // the tick overshot bust

    await (engine as unknown as { runAutoCashouts(m: number): Promise<void> }).runAutoCashouts(
      sampledPastBust,
    );

    // In-memory bet settled at the TARGET, not voided.
    const bet = (
      engine as unknown as { current: { bets: Map<string, { payoutLamports: bigint; cashedOutAt: number | null }> } }
    ).current.bets.get(user.id)!;
    expect(bet.cashedOutAt).toBe(2.02);
    expect(bet.payoutLamports).toBe(2_020n); // 1000 * 2.02

    // Durable row reflects the target payout too.
    const row = await prisma.crashBet.findUniqueOrThrow({
      where: { roundId_userId: { roundId: round.id, userId: user.id } },
    });
    expect(row.payoutLamports).toBe(2_020n);
    expect(row.cashoutMultiplier).toBe(2.02);
  });
});
