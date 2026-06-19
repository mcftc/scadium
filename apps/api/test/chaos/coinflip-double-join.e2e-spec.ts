import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { COINFLIP } from '@scadium/shared';
import { bootstrapApp, resetDb, seedUser, getPrisma, type BootstrapResult } from '../setup';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service';

/**
 * Chaos suite (#178, slice of #55) — coinflip double-join race, VERIFIED BY
 * RECONCILIATION.
 *
 * Two joiners race to take one open flip over HTTP. The serializable resolve
 * (Phase G) must let exactly one win and pay the pot exactly once (no
 * double-pay), and a `reconcileAll()` pass must then report ZERO drift. FAILS if
 * the join/resolve path is not atomic (both joins would settle → double payout /
 * drift).
 *
 * Uses the booted HTTP app + resetDb isolation so the global reconcile pass only
 * sees this scenario's users.
 */
describe('chaos: coinflip double-join (reconciliation-verified)', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();
  const reconciliation = new ReconciliationService(
    prisma as never,
    { enabled: false, lotteryEnabled: false } as never,
  );

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('two joins on one open flip → exactly one resolves, one payout, zero drift', async () => {
    const stake = BigInt(COINFLIP.MIN_BET_LAMPORTS);
    const creator = await seedUser(stake, harness.signToken, prisma); // debited at create
    const a = await seedUser(stake, harness.signToken, prisma);
    const b = await seedUser(stake, harness.signToken, prisma);

    const created = await request(harness.server)
      .post('/api/v1/coinflip')
      .set('Authorization', `Bearer ${creator.token}`)
      .send({ side: 'heads', amountLamports: stake.toString() });
    expect(created.status).toBeGreaterThanOrEqual(200);
    expect(created.status).toBeLessThan(300);
    const gameId = created.body.id as string;

    const [ra, rb] = await Promise.all([
      request(harness.server)
        .post(`/api/v1/coinflip/${gameId}/join`)
        .set('Authorization', `Bearer ${a.token}`)
        .send({}),
      request(harness.server)
        .post(`/api/v1/coinflip/${gameId}/join`)
        .set('Authorization', `Bearer ${b.token}`)
        .send({}),
    ]);

    const ok = [ra, rb].filter((r) => r.status >= 200 && r.status < 300);
    const rejected = [ra, rb].filter((r) => r.status >= 400 && r.status < 500);
    expect(ok.length).toBe(1); // exactly one join wins the race
    expect(rejected.length).toBe(1);

    const game = await prisma.coinflipGame.findUniqueOrThrow({ where: { id: gameId } });
    expect(game.status).toBe('completed');

    // Exactly two Bet rows (one per side); exactly one is a win paid 1.9× stake.
    const bets = await prisma.bet.findMany({ where: { gameType: 'coinflip', seedId: game.seedId } });
    expect(bets.length).toBe(2);
    const won = bets.filter((bet) => bet.status === 'won');
    expect(won.length).toBe(1); // no double-pay
    expect(won[0]!.payoutLamports).toBe((stake * 19n) / 10n);

    // No negative balances; reconciliation reports zero drift after the race.
    for (const u of [creator, a, b]) {
      const row = await prisma.user.findUniqueOrThrow({ where: { id: u.user.id } });
      expect(row.playBalanceLamports >= 0n).toBe(true);
    }
    const drift = await reconciliation.reconcileAll();
    expect(drift).toBe(0);
  });
});
