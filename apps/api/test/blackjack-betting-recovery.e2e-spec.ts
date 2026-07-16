import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, makeUser, makeBlackjackEngine } from './engine-harness';

/**
 * H1 — a restart during the blackjack betting window must refund accepted
 * stakes. Bets are debited at bet time but historically lived only in engine
 * RAM until deal() persisted stateJson, so a crash mid-window left an empty
 * `{}` and boot recovery refunded nothing — the stake was confiscated.
 *
 * The fix persists accepted betting-window bets to stateJson as they are
 * placed (persistBettingStakes), so recoverStrandedRounds finds and refunds
 * them. This spec drives a real placeBet through the engine, asserts the bet
 * is durable on the round row, then runs recovery and asserts the refund.
 */
const recover = (engine: unknown) =>
  (engine as { recoverStrandedRounds: () => Promise<void> }).recoverStrandedRounds();
const register = (engine: unknown, t: { id: string }) =>
  (engine as { tables: Map<string, unknown> }).tables.set(t.id, t);

describe('blackjack betting-window restart refunds accepted stakes (H1)', () => {
  it('a bet placed during betting is persisted and refunded by recovery', async () => {
    const table = await prisma.blackjackTable.create({
      data: {
        name: `bj-${randomUUID()}`,
        status: 'waiting',
        minBetLamports: 1_000n,
        maxBetLamports: 1_000_000_000n,
      },
    });
    const user = await makeUser(0n);

    const engine = makeBlackjackEngine();
    // Minimal idle table with the seated player (mirrors takeSeat's seat shape).
    const t = {
      id: table.id,
      name: 't',
      isPrivate: false,
      ownerId: null,
      maxSeats: 5,
      phase: 'idle',
      closeAt: null,
      activeSeat: null,
      seats: new Map([
        [
          0,
          {
            index: 0,
            userId: user.id,
            username: null,
            walletAddress: user.walletAddress,
            idleRounds: 0,
            bet: null,
            cards: [],
            status: 'playing',
            doubled: false,
            side21p3Outcome: null,
            sidePerfectPairsOutcome: null,
            result: null,
            payoutLamports: 0n,
          },
        ],
      ]),
      dealerCards: [],
      dealerHidden: true,
      deckIndex: 0,
      dealLog: [],
      roundDbId: null,
      seedId: null,
      serverSeed: null,
      serverSeedHash: null,
      clientSeed: null,
      nonce: 0,
      timer: null as NodeJS.Timeout | null,
      lastActivityAt: Date.now(),
      exposure: null,
    };
    register(engine, t);

    // Place a bet — opens the betting window, creates the round, and must
    // durably record the stake onto the round's stateJson.
    await (
      engine as unknown as {
        placeBet(p: {
          tableId: string;
          userId: string;
          bet: { mainLamports: bigint; side21p3Lamports: bigint; sidePerfectPairsLamports: bigint };
        }): Promise<unknown>;
      }
    ).placeBet({
      tableId: table.id,
      userId: user.id,
      bet: { mainLamports: 5_000n, side21p3Lamports: 1_000n, sidePerfectPairsLamports: 0n },
    });
    if (t.timer) clearTimeout(t.timer); // don't let the deal timer fire

    // The round row exists and its stateJson carries the accepted stake.
    expect(t.roundDbId).not.toBeNull();
    const round = await prisma.blackjackRound.findUniqueOrThrow({ where: { id: t.roundDbId! } });
    const seats = (round.stateJson as { seats?: Array<{ userId: string }> }).seats ?? [];
    expect(seats.some((s) => s.userId === user.id)).toBe(true);

    // Simulate a restart: a FRESH engine recovers the stranded (un-ended) round.
    const fresh = makeBlackjackEngine();
    await recover(fresh);

    // The 6_000 total stake (5_000 main + 1_000 side) is refunded.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(6_000n);
    const roundAfter = await prisma.blackjackRound.findUniqueOrThrow({ where: { id: t.roundDbId! } });
    expect(roundAfter.endedAt).not.toBeNull(); // round closed by recovery
  });
});
