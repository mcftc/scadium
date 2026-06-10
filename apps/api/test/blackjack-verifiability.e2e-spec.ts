import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { reproduceHand, reproduceRound, type DealLogEntry } from '@scadium/fair';
import type { Card } from '@scadium/shared';
import { prisma, makeBlackjackEngine } from './engine-harness';
import { buildBusyRound, register, settle } from './blackjack-busy-round';

/**
 * #21 — full-hand blackjack verifiability (integration, real Postgres). A busy
 * table draws MORE than 10 cards off one shared deck stream; each seat's
 * Bet.resultJson must carry the deck-index mapping so a player re-derives THEIR
 * exact cards from the revealed seed. We settle a faithful 4-seat round (cards
 * from the real stream) then reproduce every seat + the dealer via @scadium/fair
 * and assert byte-for-byte equality with the stored cards.
 */
describe('blackjack verifiability (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a >10-card multi-seat round reproduces every seat hand from the revealed seed', async () => {
    const { t, built } = await buildBusyRound();
    const engine = makeBlackjackEngine();
    register(engine, t as { id: string });
    await settle(engine, t);
    if (t.timer) clearTimeout(t.timer as NodeJS.Timeout); // settle schedules a pause timer on success

    // The round genuinely drew more than 10 cards.
    expect(built.dealOrder.length).toBeGreaterThan(10);

    // Seed revealed; one Bet per seat.
    const { serverSeed, clientSeed } = built.seedRow;
    expect(
      (await prisma.seed.findUniqueOrThrow({ where: { id: built.seedRow.id } })).revealedAt,
    ).not.toBeNull();
    const bets = await prisma.bet.findMany({
      where: { gameType: 'blackjack', userId: { in: built.users.map((u) => u.id) } },
    });
    expect(bets).toHaveLength(4);

    // 1) Each seat's stored deckIndices re-derive that seat's exact playerCards.
    for (const bet of bets) {
      const rj = bet.resultJson as unknown as {
        seatIndex: number;
        playerCards: Card[];
        dealerCards: Card[];
        deckIndices: number[];
        dealerDeckIndices: number[];
        handIds: string[];
      };
      expect(reproduceHand(serverSeed, clientSeed, 0, rj.deckIndices)).toEqual(rj.playerCards);
      // The dealer hand is reproducible from the same bet too (to verify outcome).
      expect(reproduceHand(serverSeed, clientSeed, 0, rj.dealerDeckIndices)).toEqual(rj.dealerCards);
      expect(rj.handIds).toEqual([`seat-${rj.seatIndex}-0`]);
    }

    // 2) BlackjackRound.stateJson carries the full ordered deal log.
    const roundAfter = await prisma.blackjackRound.findUniqueOrThrow({
      where: { id: built.roundId },
    });
    const stateJson = roundAfter.stateJson as unknown as { dealLog: DealLogEntry[] | null };
    expect(stateJson.dealLog).not.toBeNull();
    expect(stateJson.dealLog).toHaveLength(13);

    // 3) reproduceRound over the full log maps every seat + dealer correctly.
    const hands = reproduceRound(serverSeed, clientSeed, 0, stateJson.dealLog!);
    const byKey = new Map(hands.map((h) => [`${h.dealtTo}`, h]));
    for (const bet of bets) {
      const rj = bet.resultJson as unknown as { seatIndex: number; playerCards: Card[] };
      expect(byKey.get(`${rj.seatIndex}`)!.cards).toEqual(rj.playerCards);
    }
    expect(byKey.get('dealer')!.cards).toHaveLength(3);
  });
});
