import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { CRASH } from '@scadium/shared';
import { bootstrapApp, resetDb, seedUser, getPrisma, type BootstrapResult } from './setup';
import { CrashEngine } from '../src/games/crash/crash.engine';

/**
 * Umbrella concurrency suite (#9). Proves the money-safety invariants that #5
 * (atomic conditional debit) and #4 (atomic settlement) fixed:
 *   - the harness itself boots real Postgres + serves HTTP,
 *   - no double-spend under 20 concurrent HTTP bets on a one-bet balance,
 *   - no double-settle (exactly one Bet/CrashBet per participant),
 *   - induced mid-settle failure leaves ZERO partial effects,
 *   - (todo) negative-tip mint is closed once #3 lands.
 *
 * DB-stateful tests reset between cases; the suite is serial (fileParallelism
 * off) and runs in a fork pool so the engines' raw round timers can't hang it.
 */
describe('concurrency / money-safety (integration, real Postgres)', () => {
  let harness: BootstrapResult;
  const prisma = getPrisma();

  beforeAll(async () => {
    harness = await bootstrapApp();
  });

  afterAll(async () => {
    // Graceful teardown so the round-loop timers/connections are released.
    await harness.app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  // ---------------------------------------------------------------- harness

  it('harness self-test: GET /health is 200 and resetDb empties User', async () => {
    const res = await request(harness.server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');

    await seedUser(1_000n, harness.signToken, prisma);
    expect(await prisma.user.count()).toBeGreaterThan(0);
    await resetDb(prisma);
    expect(await prisma.user.count()).toBe(0);
  });

  // -------------------------------------------------- no double-spend (HTTP)

  it('no double-spend: 20 concurrent crash bets on a one-bet balance → 1 wins, 19 rejected, balance 0', async () => {
    const bet = BigInt(CRASH.MIN_BET_LAMPORTS);
    const { user, token } = await seedUser(bet, harness.signToken, prisma); // funded for exactly one bet

    const N = 20;
    // Fire immediately — boot opens a 20s 'waiting' window, so bets are accepted.
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
    expect(after.playBalanceLamports).toBe(0n); // exactly one debit, never negative
    expect(after.playBalanceLamports >= 0n).toBe(true);
  });

  // ------------------------------------- no double-settle (direct engine, #4)

  it('no double-settle: settling a round with N participants writes exactly one Bet + one CrashBet each', async () => {
    const N = 4;
    const seed = await prisma.seed.create({
      data: {
        serverSeed: `srv-${randomUUID()}`,
        serverSeedHash: `hash-${randomUUID()}`,
        clientSeed: `cli-${randomUUID()}`,
        nonce: 0,
      },
    });
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'running' },
    });

    const participants = [];
    for (let i = 0; i < N; i += 1) {
      // Balance already debited at bet time → start at 0.
      const { user } = await seedUser(0n, harness.signToken, prisma);
      participants.push(user);
    }

    const engine = makeCrashEngine();
    const bets = new Map(
      participants.map((p, i) => [
        p.id,
        liveBet(p.id, p.walletAddress, 1_000n, i % 2 === 0 ? 2_000n : 0n),
      ]),
    );
    setCurrentRound(engine, round.id, seed, bets);

    const result = await settle(engine);
    expect(result).not.toBeNull();

    // Exactly one row per participant — no duplicates from a re-entrant settle.
    for (const p of participants) {
      expect(await prisma.bet.count({ where: { userId: p.id } })).toBe(1);
    }
    expect(await prisma.crashBet.count({ where: { roundId: round.id } })).toBe(N);
    expect(await prisma.bet.count()).toBe(N);

    const roundAfter = await prisma.crashRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(roundAfter.status).toBe('busted');
  });

  // ------------------------------------- negative balance / mint (todo: #3)

  // TipDto uses @IsNumberString() which accepts "-1000000000", and the
  // negative-tip fix (#3) is not merged yet, so this assertion would be RED
  // today. Unskip when #3 lands.
  it.todo('rejects negative airdrop tip — unskip when #3 lands');

  // -------------------------------- induced mid-settle failure (direct, #4)

  it('induced mid-settle failure: zero partial effects, round non-terminal, seed unrevealed, dead-letter written', async () => {
    const seed = await prisma.seed.create({
      data: {
        serverSeed: `srv-${randomUUID()}`,
        serverSeedHash: `hash-${randomUUID()}`,
        clientSeed: `cli-${randomUUID()}`,
        nonce: 0,
      },
    });
    const round = await prisma.crashRound.create({
      data: { seedId: seed.id, nonce: 0, status: 'running' },
    });

    const { user: valid } = await seedUser(0n, harness.signToken, prisma);
    const missingUserId = randomUUID(); // valid uuid, no row → tx.user.update throws P2025

    const engine = makeCrashEngine();
    const bets = new Map([
      [valid.id, liveBet(valid.id, valid.walletAddress, 1_000n, 2_000n)],
      [missingUserId, liveBet(missingUserId, 'w-missing', 1_000n, 0n)],
    ]);
    setCurrentRound(engine, round.id, seed, bets);

    const result = await settle(engine);
    expect(result).toBeNull(); // failure signalled → bust() won't advance the round

    // All-or-nothing: the valid user's balance is untouched, no ledger rows.
    const validAfter = await prisma.user.findUniqueOrThrow({ where: { id: valid.id } });
    expect(validAfter.playBalanceLamports).toBe(0n);
    expect(await prisma.bet.count()).toBe(0);
    expect(await prisma.crashBet.count({ where: { roundId: round.id } })).toBe(0);

    // Round NOT terminal, seed NOT revealed.
    const roundAfter = await prisma.crashRound.findUniqueOrThrow({ where: { id: round.id } });
    expect(roundAfter.status).not.toBe('busted');
    const seedAfter = await prisma.seed.findUniqueOrThrow({ where: { id: seed.id } });
    expect(seedAfter.revealedAt).toBeNull();

    // Dead-letter row persisted for the recovery worker.
    expect(
      await prisma.settlementFailure.count({ where: { gameType: 'crash', roundId: round.id } }),
    ).toBe(1);

    // #7: the BalanceLedger is part of the same rolled-back settlement tx, so
    // no orphan ledger entries survive for the would-be-credited user.
    expect(await prisma.balanceLedger.count({ where: { userId: valid.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------- helpers
// Direct-engine pattern reused from settlement-atomicity.e2e-spec.ts: a real
// CrashEngine over the harness Prisma with stubbed gateway/chain, its private
// `current` round set directly so settlement is deterministic (no timer race).

function makeCrashEngine(): CrashEngine {
  const gateway = { emitTick() {}, emitBust() {}, emitCreated() {}, emitRunning() {} } as never;
  const chain = { enabled: false } as never;
  return new CrashEngine(getPrisma() as never, gateway, chain);
}

function liveBet(userId: string, walletAddress: string, stake: bigint, payout: bigint) {
  return {
    userId,
    username: null,
    walletAddress,
    amountLamports: stake,
    originalAmountLamports: stake,
    payoutLamports: payout,
    autoCashout: null,
    cashedOutAt: payout > 0n ? 2 : null,
  };
}

function setCurrentRound(
  engine: CrashEngine,
  roundId: string,
  seed: { id: string; serverSeed: string; serverSeedHash: string; clientSeed: string },
  bets: Map<string, ReturnType<typeof liveBet>>,
): void {
  (engine as unknown as { current: unknown }).current = {
    id: roundId,
    seedId: seed.id,
    serverSeed: seed.serverSeed,
    serverSeedHash: seed.serverSeedHash,
    clientSeed: seed.clientSeed,
    nonce: 0,
    bustPoint: 2,
    phase: 'busted',
    startedAt: Date.now(),
    bets,
  };
}

function settle(engine: CrashEngine): Promise<unknown> {
  return (engine as unknown as { settleRound: () => Promise<unknown> }).settleRound();
}
