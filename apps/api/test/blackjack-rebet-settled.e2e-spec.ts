import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, makeUser, makeSeed, makeBlackjackEngine } from './engine-harness';

/**
 * C1 + C2 — blackjack bet lifecycle at the settle/rebet boundary (money integrity).
 *
 * settle() credits payouts and flips phase → 'settled' but historically did NOT
 * clear seat.bet (only a 5s SETTLE_PAUSE timer did). placeBet() accepts the
 * 'settled' phase, so a rebet during the pause read the STALE settled bet as
 * `previousTotalLamports` — which the service credits back as a "refund",
 * printing money on every fast rebet (C1) — and any OTHER seat's settled bet
 * silently rode the next round with no fresh debit (C2).
 *
 * These specs pin the fix at the engine seam: after a settle, a rebet must
 * report previousTotalLamports === 0 (nothing to refund) and must clear every
 * seat's prior-round bet so none rides free.
 */
type SeatBet = { mainLamports: bigint; side21p3Lamports: bigint; sidePerfectPairsLamports: bigint };
const bet = (main: bigint): SeatBet => ({
  mainLamports: main,
  side21p3Lamports: 0n,
  sidePerfectPairsLamports: 0n,
});

/** A standing seat (10♥+9♠ = 19) that beats the dealer (10♦+8♣ = 18) → win 2×. */
function makeSeat(index: number, userId: string, walletAddress: string, main: bigint) {
  return {
    index,
    userId,
    username: null,
    walletAddress,
    idleRounds: 0,
    bet: bet(main),
    cards: [
      { rank: '10', suit: 'H' },
      { rank: '9', suit: 'S' },
    ],
    status: 'standing',
    doubled: false,
    side21p3Outcome: null,
    sidePerfectPairsOutcome: null,
    result: null,
    payoutLamports: 0n,
  };
}

function makeTableState(opts: {
  tableId: string;
  roundDbId: string;
  seedId: string;
  seats: Array<ReturnType<typeof makeSeat>>;
}) {
  return {
    id: opts.tableId,
    name: 'rebet-test',
    isPrivate: false,
    ownerId: null,
    maxSeats: 6,
    phase: 'dealer_turn',
    closeAt: null,
    activeSeat: null,
    seats: new Map(opts.seats.map((s) => [s.index, s])),
    dealerCards: [
      { rank: '10', suit: 'D' },
      { rank: '8', suit: 'C' },
    ],
    dealerHidden: false,
    deckIndex: 0,
    dealLog: [],
    roundDbId: opts.roundDbId,
    seedId: opts.seedId,
    serverSeed: 'srv-bj',
    serverSeedHash: 'hash-bj',
    clientSeed: 'cli-bj',
    nonce: 0,
    timer: null as NodeJS.Timeout | null,
    lastActivityAt: Date.now(),
  };
}

async function setupTable() {
  const table = await prisma.blackjackTable.create({
    data: {
      name: `bj-${randomUUID()}`,
      status: 'player_turns',
      minBetLamports: 1_000n,
      maxBetLamports: 1_000_000_000n,
    },
  });
  const seed = await makeSeed();
  const round = await prisma.blackjackRound.create({
    data: { tableId: table.id, seedId: seed.id, nonce: 0, endedAt: null, stateJson: {} },
  });
  return { table, seed, round };
}

const settle = (engine: unknown, t: unknown) =>
  (engine as { settle: (t: unknown) => Promise<void> }).settle(t);
const register = (engine: unknown, t: { id: string }) =>
  (engine as { tables: Map<string, unknown> }).tables.set(t.id, t);
const placeBet = (
  engine: unknown,
  params: { tableId: string; userId: string; bet: SeatBet },
) =>
  (engine as {
    placeBet: (p: { tableId: string; userId: string; bet: SeatBet }) => Promise<{
      previousTotalLamports: bigint;
    }>;
  }).placeBet(params);

describe('blackjack rebet-during-settled money integrity (C1/C2)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('C1: a rebet during the settled pause is NOT credited a refund of the already-settled stake', async () => {
    const u = await makeUser(0n);
    const { table, seed, round } = await setupTable();
    const t = makeTableState({
      tableId: table.id,
      roundDbId: round.id,
      seedId: seed.id,
      seats: [makeSeat(0, u.id, u.walletAddress, 1_000n)],
    });

    const engine = makeBlackjackEngine();
    register(engine, t);
    await settle(engine, t); // pays 2_000, phase → 'settled'
    expect(t.phase).toBe('settled');

    // The service already debited the new stake before calling placeBet; it
    // then refunds `previousTotalLamports`. For a rebet during 'settled' the
    // previous (settled) stake must NOT be refundable — else it's free money.
    const { previousTotalLamports } = await placeBet(engine, {
      tableId: table.id,
      userId: u.id,
      bet: bet(1_000n),
    });
    if (t.timer) clearTimeout(t.timer); // placeBet → openBetting scheduled a deal timer

    expect(previousTotalLamports).toBe(0n);
  });

  it('C2: opening a new round from settled clears every prior-round bet so none rides free', async () => {
    const u1 = await makeUser(0n);
    const u2 = await makeUser(0n);
    const { table, seed, round } = await setupTable();
    const t = makeTableState({
      tableId: table.id,
      roundDbId: round.id,
      seedId: seed.id,
      seats: [
        makeSeat(0, u1.id, u1.walletAddress, 1_000n),
        makeSeat(1, u2.id, u2.walletAddress, 1_000n),
      ],
    });

    const engine = makeBlackjackEngine();
    register(engine, t);
    await settle(engine, t); // both paid, phase → 'settled', both seat.bet stale
    expect(t.phase).toBe('settled');

    // u1 rebets → new round opens. u2 did NOT place a fresh (debited) bet, so
    // u2's stale settled bet must be cleared, not carried into the new round.
    await placeBet(engine, { tableId: table.id, userId: u1.id, bet: bet(1_000n) });
    if (t.timer) clearTimeout(t.timer);

    const seatU2 = [...t.seats.values()].find((s) => s.userId === u2.id)!;
    expect(seatU2.bet).toBeNull();
  });
});
