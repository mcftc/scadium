import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Card } from '@scadium/shared';
import { prisma, makeBlackjackEngine } from './engine-harness';
import { buildBusyRound, register, settle } from './blackjack-busy-round';
// The EXACT browser verifier code shipped to /fairness. Self-contained
// (WebCrypto only), so it runs here under Node's global crypto.subtle — this is
// the api+web verifier flow proven end-to-end without a browser harness.
import { reproduceRound, type DealLogEntry } from '../../web/src/lib/fair-browser';

/**
 * #21 — blackjack verifier flow (integration). Settle a real busy-table round
 * (>10 cards), then drive the BROWSER verifier engine over the revealed seed +
 * the round's deal log and assert it reproduces each seat's and the dealer's
 * hand. Proves the shipped client no longer truncates the deck at 10 cards.
 */
describe('blackjack verifier flow (browser engine, integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('the /fairness verifier reproduces a busy round seat-by-seat from the seed', async () => {
    const { t, built } = await buildBusyRound();
    const engine = makeBlackjackEngine();
    register(engine, t as { id: string });
    await settle(engine, t);
    if (t.timer) clearTimeout(t.timer as NodeJS.Timeout);

    const { serverSeed, clientSeed } = built.seedRow;

    // Pull the round's revealed deal log (as the verifier UI would).
    const roundAfter = await prisma.blackjackRound.findUniqueOrThrow({
      where: { id: built.roundId },
    });
    const dealLog = (roundAfter.stateJson as unknown as { dealLog: DealLogEntry[] | null }).dealLog;
    expect(dealLog).not.toBeNull();
    expect(dealLog!.length).toBeGreaterThan(10); // busy table — more than a flat 10-card deal

    // Browser engine reproduces every hand from the revealed seed.
    const hands = await reproduceRound(serverSeed, clientSeed, 0, dealLog!);
    const byKey = new Map(hands.map((h) => [`${h.dealtTo}`, h]));

    const bets = await prisma.bet.findMany({
      where: { gameType: 'blackjack', userId: { in: built.users.map((u) => u.id) } },
    });
    expect(bets).toHaveLength(4);
    for (const bet of bets) {
      const rj = bet.resultJson as unknown as { seatIndex: number; playerCards: Card[] };
      const seatHand = byKey.get(`${rj.seatIndex}`);
      expect(seatHand, `seat ${rj.seatIndex} reproduced`).toBeDefined();
      expect(seatHand!.cards).toEqual(rj.playerCards);
    }

    // Dealer hand reproduced too (3 cards: deal pass + one hit).
    expect(byKey.get('dealer')!.cards).toHaveLength(3);
    expect(byKey.get('dealer')!.cards).toEqual(t.dealerCards);
  });
});
