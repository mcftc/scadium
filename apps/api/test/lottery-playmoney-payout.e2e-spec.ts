import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomInt, randomUUID } from 'node:crypto';
import { lotteryDraw, padClientSeed32, syntheticSlotHash } from '@scadium/fair';
import { ticketPriceScadBase } from '@scadium/shared';
import { prisma, makeUser, makeLotteryEngine } from './engine-harness';

/**
 * H4 — in the default chain-disabled (play-money) mode the lottery historically
 * debited the SOL play balance for a ticket but NEVER credited winners (every
 * prize path no-op'd unless chain.lotteryEnabled). This drives a settle with a
 * guaranteed-jackpot ticket and asserts the winner's play balance is credited.
 */
describe('lottery play-money payout (H4, integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('credits a winning ticket to the play balance when the chain is disabled', async () => {
    const serverSeed = `srv-${randomUUID()}`;
    const clientSeed = `cli-${randomUUID()}`;
    // Reproduce the exact winning digits the play-money draw will derive.
    const synthetic = syntheticSlotHash(serverSeed, clientSeed);
    const winning = lotteryDraw(serverSeed, padClientSeed32(clientSeed), synthetic, 0).digits;

    const seed = await prisma.seed.create({
      data: { serverSeed, serverSeedHash: `hash-${randomUUID()}`, clientSeed, nonce: 0 },
    });
    const drawIndex = BigInt(randomInt(1, 2_000_000_000));
    const draw = await prisma.lotteryDraw.create({
      data: {
        seedId: seed.id,
        nonce: 0,
        status: 'open',
        drawIndex,
        drawAt: new Date(Date.now() - 60_000),
      },
    });

    const cost = 100_000n;
    const winner = await makeUser(0n);
    // A ticket matching all 6 winning digits → jackpot bracket.
    await prisma.lotteryTicket.create({
      data: {
        drawId: draw.id,
        userId: winner.id,
        digits: winning,
        costLamports: cost,
        costScadBase: ticketPriceScadBase(),
      },
    });

    const engine = makeLotteryEngine();
    const e = engine as unknown as { recovering: boolean; current: unknown };
    e.recovering = true;
    e.current = {
      id: draw.id,
      drawIndex,
      seedId: seed.id,
      serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed,
      nonce: 0,
      drawAt: Date.now(),
      status: 'open',
      ticketCount: 1,
      ticketPriceScadBase: ticketPriceScadBase(),
      injectionScadBase: 0n,
      rolloverScadBase: 0n,
      salesScadBase: cost,
      potLamports: cost,
      commitTxSignature: null,
    };

    await (engine as unknown as { drawAndSettle: () => Promise<void> }).drawAndSettle();

    // The ticket is a jackpot winner and its prize is credited to the play balance.
    const ticket = await prisma.lotteryTicket.findFirstOrThrow({
      where: { drawId: draw.id, userId: winner.id },
    });
    expect(ticket.won).toBe(true);
    expect(ticket.payoutLamports).toBeGreaterThan(0n);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: winner.id } });
    expect(after.playBalanceLamports).toBe(ticket.payoutLamports);
  });
});
