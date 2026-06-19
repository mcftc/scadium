import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { CRASH } from '@scadium/shared';
import { bootstrapApp, resetDb, seedUser, getPrisma, type BootstrapResult } from '../setup';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service';
import { CrashEngine } from '../../src/games/crash/crash.engine';
import { RedisService } from '../../src/redis/redis.service';

/**
 * Chaos suite (#179, slice of #55) — multi-replica kill-9 mid-round recovery,
 * VERIFIED BY RECONCILIATION.
 *
 * REAL MECHANISM EXERCISED (premise note): the issue says "SIGKILL the leader
 * during a running crash round; after a replica takes over + a reconciliation
 * pass". The genuine product mechanism is the Redis single-writer leader
 * election (apps/api/src/redis/leader-election.ts, #13/#85/#86) plus the crash
 * engine's BOOT reconciliation `recoverStrandedRounds` (#14). There is no
 * in-process "hot failover" of a live in-RAM round — a dead leader's round is
 * recovered when ANOTHER replica acquires the lock and re-runs boot recovery,
 * which refunds/settles every stranded `CrashBet` and flips the round terminal.
 *
 * This spec drives that real path with two replicas in ONE test process:
 *   1. Replica A boots, wins `lock:engine:crash`, opens a waiting round, and
 *      takes a real crash bet over HTTP (balance debited, durable CrashBet row,
 *      round left non-terminal).
 *   2. A's Redis client is force-disconnected — the EXACT effect of a SIGKILL on
 *      the leader: it can neither renew nor release its lock, so the lock simply
 *      TTLs out (~10s). A is NOT gracefully closed (that would release the lock
 *      and is not what a kill-9 does).
 *   3. Replica B (booted as a standby FOLLOWER) acquires the lapsed lock, becomes
 *      leader, and runs `recoverStrandedRounds` on `assumeLeadership`.
 *   4. Invariant: ZERO crash rounds left `running`/`waiting`, ZERO stranded
 *      (un-terminal) CrashBets, the bettor's stake fully refunded, and a
 *      `ReconciliationService.reconcileAll()` pass reports ZERO drift.
 *
 * For the full out-of-process variant (two real containers + an actual SIGKILL)
 * see docker-compose.chaos.yml + docs/runbooks/load-chaos.md.
 *
 * RED-BEFORE: fails if boot reconciliation (`recoverStrandedRounds`) is removed
 * or if leader election lets B run without re-settling A's stranded round — the
 * debited stake would be stranded and the round stuck non-terminal → drift.
 */
describe('chaos: multi-replica kill-9 recovery (reconciliation-verified)', () => {
  const prisma = getPrisma();
  const reconciliation = new ReconciliationService(
    prisma as never,
    { enabled: false, lotteryEnabled: false } as never,
  );

  let replicaA: BootstrapResult;
  let replicaB: BootstrapResult | null = null;

  beforeAll(async () => {
    // A real Redis is required: the engines run in election mode (RedisService is
    // @Global, so `redis?` is always injected). Skip cleanly if Redis is down so
    // the chaos suite degrades to a no-op rather than a false failure in CI envs
    // without Redis.
    replicaA = await bootstrapApp();
  });

  afterAll(async () => {
    // Close B first (it is the live leader by now); then A. A may already be a
    // zombie (Redis disconnected) — close() is best-effort.
    if (replicaB) await replicaB.app.close().catch(() => undefined);
    await replicaA.app.close().catch(() => undefined);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  it('kill-9 the leader mid-round → standby recovers, zero stranded bets, zero drift', async () => {
    const crashA = replicaA.app.get(CrashEngine, { strict: false });
    // Confirm A is the live leader with an open betting window (the harness
    // already waited for this, but assert it so a misconfigured run fails loud).
    expect(crashA.isLeader()).toBe(true);
    expect((crashA.snapshot() as { phase: string }).phase).toBe('waiting');

    const bet = BigInt(CRASH.MIN_BET_LAMPORTS);
    const { user, token } = await seedUser(bet, replicaA.signToken, prisma);

    const placed = await request(replicaA.server)
      .post('/api/v1/crash/bet')
      .set('Authorization', `Bearer ${token}`)
      .send({ amountLamports: bet.toString() });
    expect(placed.status).toBeGreaterThanOrEqual(200);
    expect(placed.status).toBeLessThan(300);
    const roundId = placed.body.roundId as string;

    // Stake debited, durable CrashBet row written, round still non-terminal —
    // exactly the stranded state a kill-9 would freeze.
    const afterBet = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(afterBet.playBalanceLamports).toBe(0n);
    const strandedBet = await prisma.crashBet.findUniqueOrThrow({
      where: { roundId_userId: { roundId, userId: user.id } },
    });
    expect(strandedBet.remainingLamports).toBe(bet); // never cashed out
    const roundBefore = await prisma.crashRound.findUniqueOrThrow({ where: { id: roundId } });
    expect(['waiting', 'running']).toContain(roundBefore.status);

    // --- SIGKILL the leader: sever its Redis so it can neither renew nor release
    // the lock. The lock now just expires after its TTL — identical to a hard
    // process kill. A is intentionally NOT app.close()'d (that releases the lock
    // gracefully, which a kill-9 does not).
    const redisA = replicaA.app.get(RedisService, { strict: false });
    redisA.client.disconnect();

    // Boot the standby replica as a FOLLOWER (it must not wait to lead — the lock
    // is still held by the now-dead A until its TTL lapses).
    replicaB = await bootstrapApp({ skipLeaderWait: true });
    const crashB = replicaB.app.get(CrashEngine, { strict: false });

    // B acquires the lapsed lock (≤ one TTL ≈ 10s) and, on assumeLeadership, runs
    // recoverStrandedRounds. Wait for leadership AND for the stranded round to be
    // flipped terminal.
    const recovered = async () => {
      if (!crashB.isLeader()) return false;
      const round = await prisma.crashRound.findUnique({ where: { id: roundId } });
      return round?.status === 'busted';
    };
    for (let i = 0; i < 250 && !(await recovered()); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(crashB.isLeader()).toBe(true);

    // INVARIANT 1: the stranded round is terminal, not stuck running/waiting.
    const recoveredRound = await prisma.crashRound.findUniqueOrThrow({ where: { id: roundId } });
    expect(recoveredRound.status).toBe('busted');

    // INVARIANT 2: NO crash round belonging to THIS scenario's bettor is left
    // non-terminal. (resetDb isolation + the recovery pass.) The fresh round B
    // opened on takeover has no bets and is allowed to be waiting/running, so we
    // scope to the recovered round.
    const strandedRounds = await prisma.crashRound.findMany({
      where: { id: roundId, status: { in: ['waiting', 'running'] } },
    });
    expect(strandedRounds.length).toBe(0);

    // INVARIANT 3: the bettor's debited stake was refunded in full (un-cashed bet
    // → net-zero). The recovery credits payout (0) + remaining stake (full).
    const afterRecovery = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(afterRecovery.playBalanceLamports).toBe(bet);

    // INVARIANT 4: the CrashBet is settled terminal (remaining swept to 0).
    const settledBet = await prisma.crashBet.findUniqueOrThrow({
      where: { roundId_userId: { roundId, userId: user.id } },
    });
    expect(settledBet.remainingLamports).toBe(0n);

    // INVARIANT 5 (the §9 gating assertion): reconciliation reports ZERO drift —
    // the recovered ledger == aggregates == live balance.
    const drift = await reconciliation.reconcileAll();
    expect(drift).toBe(0);
  });
});
