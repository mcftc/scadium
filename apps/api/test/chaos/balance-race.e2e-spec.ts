import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { CRASH } from '@scadium/shared';
import { bootstrapApp, resetDb, seedUser, getPrisma, type BootstrapResult } from '../setup';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service';

/**
 * Chaos suite (#178, slice of #55) — balance race under high concurrency,
 * VERIFIED BY RECONCILIATION.
 *
 * 50 parallel crash bets hit a balance funded for exactly one. The Phase G
 * conditional debit (`applyBalanceDelta`'s guarded `updateMany`) must accept
 * exactly one and never drive the balance negative — and a full
 * `ReconciliationService.reconcileAll()` pass must then report ZERO drift
 * (ledger == aggregates == balance). This is the §9 gating invariant the load/
 * chaos task must prove. FAILS against a pre-Phase-G read-then-decrement debit
 * (multiple bets would win and the balance would go negative / drift).
 *
 * resetDb runs before each case, so the global reconcile pass only sees this
 * scenario's user(s). Chain is disabled (play-money), so reconcileAll touches
 * only Postgres.
 */
describe('chaos: balance race (reconciliation-verified)', () => {
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

  it('50 concurrent bets on a one-bet balance → exactly one wins, balance ≥ 0, zero drift', async () => {
    const bet = BigInt(CRASH.MIN_BET_LAMPORTS);
    const { user, token } = await seedUser(bet, harness.signToken, prisma); // funded for exactly one

    const N = 50;
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        request(harness.server)
          .post('/api/v1/crash/bet')
          .set('Authorization', `Bearer ${token}`)
          .send({ amountLamports: bet.toString() }),
      ),
    );

    const ok = responses.filter((r) => r.status >= 200 && r.status < 300);
    const rejected = responses.filter((r) => r.status >= 400 && r.status < 500);
    expect(ok.length).toBe(1);
    expect(rejected.length).toBe(N - 1);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(0n); // exactly one debit
    expect(after.playBalanceLamports >= 0n).toBe(true); // never negative

    // Reconciliation invariant: no drift after the race (ledger == aggregates == balance).
    const drift = await reconciliation.reconcileAll();
    expect(drift).toBe(0);
  });
});
