import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JACKPOT } from '@scadium/shared';
import { jackpotWinningTicket } from '@scadium/fair';
import { prisma, makeUser, makeSeed, makeJackpotEngine } from './engine-harness';

/**
 * #23 — jackpot draw with a pot ABOVE 2^53 lamports (integration, real
 * Postgres). The legacy engine cast the pot to a JS `number` and reduced a
 * 52-bit roll, which loses precision and biases the winner toward low tickets
 * once the pot nears/exceeds 2^53. With the BigInt fix the draw must be exact
 * and reproducible: the winning ticket recomputed from the revealed seed
 * matches what was stored, and the selected winner's cumulative lamport range
 * actually contains that ticket.
 */

/** Reconstruct `this.current` (like recovery does) + suppress the chained openNewRound. */
function prime(
  engine: unknown,
  round: { id: string },
  seed: { id: string; serverSeed: string | null; serverSeedHash: string; clientSeed: string },
) {
  const e = engine as Record<string, unknown>;
  e.recovering = true;
  e.current = {
    id: round.id,
    seedId: seed.id,
    serverSeed: seed.serverSeed,
    serverSeedHash: seed.serverSeedHash,
    clientSeed: seed.clientSeed,
    nonce: 0,
    closeAt: Date.now(),
    status: 'open',
    totalLamports: 0n,
    players: new Set<string>(),
  };
}
const draw = (engine: unknown) =>
  (engine as { drawAndSettle: () => Promise<void> }).drawAndSettle();

/** Build an 'open' round with entries given EXPLICIT, strictly-increasing
 * createdAt so the engine's `orderBy: createdAt asc` walk is deterministic. */
async function setupRound(entries: { userId: string; amount: bigint }[]) {
  const seed = await makeSeed();
  const round = await prisma.jackpotRound.create({
    data: { seedId: seed.id, nonce: 0, status: 'open', closeAt: new Date(Date.now() - 60_000) },
  });
  const base = Date.now() - 10 * 60_000;
  for (let i = 0; i < entries.length; i++) {
    await prisma.jackpotEntry.create({
      data: {
        roundId: round.id,
        userId: entries[i]!.userId,
        amountLamports: entries[i]!.amount,
        createdAt: new Date(base + i * 1000),
      },
    });
  }
  return { seed, round };
}

describe('jackpot large-pot draw (> 2^53 lamports, integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('is exact and reproducible from the revealed seed; winner range contains the ticket', async () => {
    // Three distinct players (≥ MIN_PLAYERS) summing to a pot that is NOT an
    // exact JS number — the precise condition the old Number(total) cast broke.
    const amounts = [4_000_000_000_000_000n, 3_000_000_000_000_001n, 3_000_000_000_000_000n];
    const total = amounts.reduce((s, a) => s + a, 0n);
    expect(total).toBeGreaterThan(1n << 53n);
    expect(BigInt(Number(total))).not.toBe(total); // pot is unrepresentable as an exact number

    const users = await Promise.all(amounts.map(() => makeUser(0n)));
    expect(users.length).toBeGreaterThanOrEqual(JACKPOT.MIN_PLAYERS);
    const { seed, round } = await setupRound(
      users.map((u, i) => ({ userId: u.id, amount: amounts[i]! })),
    );

    const engine = makeJackpotEngine();
    prime(engine, round, seed);
    await draw(engine);

    const after = await prisma.jackpotRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(after.status).toBe('drawn');
    expect(after.winnerId).not.toBeNull();
    expect(after.totalLamports).toBe(total);

    // 1) Reproducibility: recompute the ticket from the REVEALED seed.
    const seedAfter = await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } });
    expect(seedAfter.revealedAt).not.toBeNull();
    const ticket = jackpotWinningTicket(seed.serverSeed!, seed.clientSeed, 0, total);
    expect(ticket).toBeGreaterThanOrEqual(0n);
    expect(ticket).toBeLessThan(total);
    expect(after.winningTicket).toBe(ticket); // stored value is BigInt and exact

    // 2) The selected winner's cumulative lamport range actually contains the
    //    ticket — walk entries in the same canonical (createdAt asc) order.
    const entries = await prisma.jackpotEntry.findMany({
      where: { roundId: round.id },
      orderBy: { createdAt: 'asc' },
    });
    let cumulative = 0n;
    let expectedWinner: string | null = null;
    for (const e of entries) {
      cumulative += e.amountLamports;
      if (ticket < cumulative) {
        expectedWinner = e.userId;
        break;
      }
    }
    expect(expectedWinner).not.toBeNull();
    expect(after.winnerId).toBe(expectedWinner);

    // 3) Winner credited the 95% payout; the per-bet resultJson echoes the
    //    exact ticket as a string (no precision loss in the ledger).
    const payout = (total * BigInt(Math.round((1 - JACKPOT.HOUSE_EDGE) * 1000))) / 1000n;
    expect(after.payoutLamports).toBe(payout);
    const winnerBet = await prisma.bet.findFirstOrThrow({
      where: { userId: after.winnerId!, gameType: 'jackpot' },
    });
    expect((winnerBet.resultJson as { winningTicket?: string }).winningTicket).toBe(ticket.toString());
  });
});
