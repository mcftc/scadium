import { describe, it, expect, vi } from 'vitest';
import { scadBaseToLamports } from '@scadium/shared';
import { LotteryService } from './lottery.service';

/**
 * H20 — off-chain a lottery ticket is debited from the SOL play balance, so the
 * RG gate must see the ticket's lamport cost (not 0n) — otherwise a self-limited
 * user buys unlimited tickets and bypasses their daily wager/loss limit.
 * assertCanWager short-circuits on `amount <= 0`, so passing 0n skips the check.
 */
describe('LotteryService.buyTicket — RG gate sees the ticket cost (unit, H20)', () => {
  it('calls assertCanWager with the ticket lamport price, not 0n', async () => {
    const priceScad = 100_000_000n;
    const expectedLamports = scadBaseToLamports(priceScad);
    const assertCanWager = vi.fn().mockResolvedValue(undefined);

    const engine = {
      ticketPriceScadBase: () => priceScad,
      getOpenDraw: () => null, // buyTicket rejects here — after the RG pre-check
    } as never;
    const chain = { lotteryEnabled: false } as never;
    const rg = { assertCanWager } as never;
    const prisma = {} as never;

    const svc = new LotteryService(prisma, engine, chain, rg);

    await expect(svc.buyTicket({ userId: 'u', digits: [1, 2, 3, 4, 5, 6] })).rejects.toThrow();
    expect(assertCanWager).toHaveBeenCalledWith('u', expectedLamports);
    expect(expectedLamports).toBeGreaterThan(0n); // guards against a 0n regression
  });
});
