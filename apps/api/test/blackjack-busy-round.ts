import { randomUUID } from 'node:crypto';
import { blackjackDeal, type DealLogEntry } from '@scadium/fair';
import type { Card } from '@scadium/shared';
import { prisma, makeUser, makeSeed } from './engine-harness';

/**
 * Shared builder for the #21 verifiability specs. Persists a faithful 4-seat
 * blackjack round that draws 13 cards (deal pass + seat 0 hits ×2 + a dealer
 * hit) off the REAL deterministic `blackjackDeal` stream, so reproducing the
 * deal log from the revealed seed is a genuine check rather than a tautology.
 * Not a `*.e2e-spec.ts` file, so the integration runner does not execute it.
 */
export interface BuiltRound {
  seedRow: { id: string; serverSeed: string; clientSeed: string };
  roundId: string;
  table: { id: string };
  users: { id: string; walletAddress: string }[];
  dealOrder: DealLogEntry[];
}

export const register = (engine: unknown, t: { id: string }) =>
  (engine as { tables: Map<string, unknown> }).tables.set(t.id, t);
export const settle = (engine: unknown, t: unknown) =>
  (engine as { settle: (t: unknown) => Promise<void> }).settle(t);

export async function buildBusyRound(): Promise<{ t: Record<string, unknown>; built: BuiltRound }> {
  const seedRow = await makeSeed(); // serverSeed `srv-…`, clientSeed `cli-…`, nonce 0
  const stream = blackjackDeal(seedRow.serverSeed!, seedRow.clientSeed, 0, 40);

  const seatHand = (i: number) => `seat-${i}-0`;
  const base: DealLogEntry[] = [
    { deckIndex: 0, dealtTo: 0, handId: seatHand(0) },
    { deckIndex: 1, dealtTo: 1, handId: seatHand(1) },
    { deckIndex: 2, dealtTo: 2, handId: seatHand(2) },
    { deckIndex: 3, dealtTo: 3, handId: seatHand(3) },
    { deckIndex: 4, dealtTo: 'dealer', handId: 'dealer' },
    { deckIndex: 5, dealtTo: 0, handId: seatHand(0) },
    { deckIndex: 6, dealtTo: 1, handId: seatHand(1) },
    { deckIndex: 7, dealtTo: 2, handId: seatHand(2) },
    { deckIndex: 8, dealtTo: 3, handId: seatHand(3) },
    { deckIndex: 9, dealtTo: 'dealer', handId: 'dealer' },
    { deckIndex: 10, dealtTo: 0, handId: seatHand(0) },
    { deckIndex: 11, dealtTo: 0, handId: seatHand(0) },
    { deckIndex: 12, dealtTo: 'dealer', handId: 'dealer' },
  ];
  const dealOrder: DealLogEntry[] = base.map((e) => ({ ...e, card: stream[e.deckIndex]! }));

  const cardsFor = (who: number | 'dealer'): Card[] =>
    dealOrder.filter((e) => e.dealtTo === who).map((e) => stream[e.deckIndex]!);

  const users = await Promise.all([0, 1, 2, 3].map(() => makeUser(0n)));

  const table = await prisma.blackjackTable.create({
    data: {
      name: `bj-${randomUUID()}`,
      status: 'dealer_turn',
      minBetLamports: 1_000n,
      maxBetLamports: 1_000_000_000n,
    },
  });
  const round = await prisma.blackjackRound.create({
    data: { tableId: table.id, seedId: seedRow.id, nonce: 0, endedAt: null, stateJson: {} },
  });

  const seats = new Map<number, unknown>();
  for (let i = 0; i < 4; i++) {
    seats.set(i, {
      index: i,
      userId: users[i]!.id,
      username: null,
      walletAddress: users[i]!.walletAddress,
      idleRounds: 0,
      bet: { mainLamports: 1_000n, side21p3Lamports: 0n, sidePerfectPairsLamports: 0n },
      cards: cardsFor(i),
      status: 'standing',
      doubled: false,
      side21p3Outcome: null,
      sidePerfectPairsOutcome: null,
      result: null,
      payoutLamports: 0n,
    });
  }

  const t: Record<string, unknown> = {
    id: table.id,
    name: 'verify-test',
    isPrivate: false,
    ownerId: null,
    maxSeats: 6,
    phase: 'dealer_turn',
    closeAt: null,
    activeSeat: null,
    seats,
    dealerCards: cardsFor('dealer'),
    dealerHidden: false,
    deckIndex: 13,
    dealLog: dealOrder,
    roundDbId: round.id,
    seedId: seedRow.id,
    serverSeed: seedRow.serverSeed,
    serverSeedHash: seedRow.serverSeedHash,
    clientSeed: seedRow.clientSeed,
    nonce: 0,
    timer: null,
    lastActivityAt: Date.now(),
  };

  return {
    t,
    built: {
      seedRow: { id: seedRow.id, serverSeed: seedRow.serverSeed!, clientSeed: seedRow.clientSeed },
      roundId: round.id,
      table,
      users,
      dealOrder,
    },
  };
}
