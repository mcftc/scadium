import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kenoPaytable } from '@scadium/shared';
import { kenoHits } from '@scadium/fair';
import { KenoService } from '../src/games/keno/keno.service';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import { prisma, makeUser } from './engine-harness';

/** Keno settles like every instant game: one debit, the paytable payout, a Bet row, verifiable. */
describe('keno (integration, real Postgres)', () => {
  const svc = new KenoService(
    prisma as never,
    new SeedManagerService(prisma as never),
    { assertCanWager: async () => undefined } as never,
    { accrue: async () => 0n } as never,
    { creditReferral: async () => undefined } as never,
  );
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('pays the paytable multiplier for the drawn hits, with one debit and a Bet row', async () => {
    const stake = 100_000_000n;
    for (const risk of ['low', 'medium', 'high'] as const) {
      const u = await makeUser(10n * stake);
      const picks = [2, 4, 8, 16, 23, 31, 40];
      const r = await svc.play({ userId: u.id, amountLamports: stake, picks, risk });
      const drawn = r.result.drawn as number[];
      expect(new Set(drawn).size).toBe(10);
      expect(await prisma.bet.count({ where: { id: r.betId, gameType: 'keno' } })).toBe(1);
      const mult = kenoPaytable(risk, picks.length)[kenoHits(picks, drawn)]!;
      expect(r.multiplier).toBe(mult);
      const payout = (stake * BigInt(Math.round(mult * 100))) / 100n;
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).playBalanceLamports,
      ).toBe(10n * stake - stake + BigInt(r.payoutLamports));
      expect(BigInt(r.payoutLamports)).toBeLessThanOrEqual(payout + 1n);
    }
  });

  it('rejects bad picks and risks', async () => {
    const u = await makeUser(10n ** 9n);
    await expect(
      svc.play({ userId: u.id, amountLamports: 10n ** 7n, picks: [], risk: 'low' }),
    ).rejects.toThrow();
    await expect(
      svc.play({ userId: u.id, amountLamports: 10n ** 7n, picks: [41], risk: 'low' }),
    ).rejects.toThrow();
    await expect(
      svc.play({ userId: u.id, amountLamports: 10n ** 7n, picks: [1], risk: 'wild' as never }),
    ).rejects.toThrow();
  });
});
