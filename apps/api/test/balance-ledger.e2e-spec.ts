import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { applyBalanceDelta, deriveBalance } from '../src/prisma/apply-balance-delta';
import { withSerializable } from '../src/prisma/with-serializable';
import { CrashEngine } from '../src/games/crash/crash.engine';

// TODO(harness #9): fold this bootstrap into the shared concurrency harness.
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

const RUN = `${Date.now().toString(36)}`;
let seq = 0;
async function makeUser(balance: bigint) {
  seq += 1;
  return prisma.user.create({
    data: {
      walletAddress: `ledger-${RUN}-${seq}`,
      refCode: `ledger-ref-${RUN}-${seq}`,
      playBalanceLamports: balance,
    },
  });
}
async function makeSeed() {
  const s = `${RUN}-${seq++}`;
  return prisma.seed.create({
    data: { serverSeed: `srv-${s}`, serverSeedHash: `hash-${s}`, clientSeed: `cli-${s}`, nonce: 0 },
  });
}
function apply(userId: string, delta: bigint, reason: string) {
  return withSerializable(prisma, (tx) => applyBalanceDelta(tx, userId, delta, { reason, refType: 'test' }));
}

describe('BalanceLedger projection (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('SUM(delta) == playBalanceLamports and balanceAfter is the running sum', async () => {
    const user = await makeUser(0n);

    await apply(user.id, 1_000n, 'airdrop_credit');
    await apply(user.id, -300n, 'crash_bet');
    await apply(user.id, 50n, 'refund');

    const col = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).playBalanceLamports;
    expect(col).toBe(750n);

    // Re-derivable projection: the ledger sum equals the live column.
    expect(await deriveBalance(prisma, user.id)).toBe(750n);

    const rows = await prisma.balanceLedger.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows.length).toBe(3);
    // Each row's balanceAfter is the running cumulative sum of deltas.
    let running = 0n;
    for (const r of rows) {
      running += r.delta;
      expect(r.balanceAfter).toBe(running);
    }
    expect(running).toBe(750n);
  });

  it('a debit that would go negative writes NO ledger row and leaves the balance untouched', async () => {
    const user = await makeUser(100n);
    await expect(apply(user.id, -101n, 'crash_bet')).rejects.toThrow();

    const col = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).playBalanceLamports;
    expect(col).toBe(100n);
    expect(await prisma.balanceLedger.count({ where: { userId: user.id } })).toBe(0);
  });

  it('settlement atomicity: a rolled-back crash settle leaves NO ledger rows', async () => {
    const seed = await makeSeed();
    const round = await prisma.crashRound.create({ data: { seedId: seed.id, nonce: 0, status: 'running' } });
    const valid = await makeUser(0n);
    const missing = randomUUID(); // no row → settle tx throws → full rollback

    const engine = new CrashEngine(
      prisma as never,
      { emitTick() {}, emitBust() {} } as never,
      { enabled: false } as never,
    );
    (engine as unknown as { current: unknown }).current = {
      id: round.id,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      bustPoint: 2,
      phase: 'busted',
      startedAt: Date.now(),
      bets: new Map([
        [valid.id, live(valid.id, 'w1', 1_000n, 2_000n)],
        [missing, live(missing, 'w2', 1_000n, 0n)],
      ]),
    };

    const result = await (engine as unknown as { settleRound: () => Promise<unknown> }).settleRound();
    expect(result).toBeNull();

    // The credit that would have been written for `valid` rolled back with the
    // tx — no orphan ledger rows, balance untouched.
    expect(await prisma.balanceLedger.count({ where: { userId: valid.id } })).toBe(0);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: valid.id } })).playBalanceLamports,
    ).toBe(0n);
  });

  it('happy crash settle: winner credit writes a crash_settle ledger row and derivation matches', async () => {
    const seed = await makeSeed();
    const round = await prisma.crashRound.create({ data: { seedId: seed.id, nonce: 0, status: 'running' } });
    const winner = await makeUser(0n);

    const engine = new CrashEngine(
      prisma as never,
      { emitTick() {}, emitBust() {} } as never,
      { enabled: false } as never,
    );
    (engine as unknown as { current: unknown }).current = {
      id: round.id,
      seedId: seed.id,
      serverSeed: seed.serverSeed,
      serverSeedHash: seed.serverSeedHash,
      clientSeed: seed.clientSeed,
      nonce: 0,
      bustPoint: 2,
      phase: 'busted',
      startedAt: Date.now(),
      bets: new Map([[winner.id, live(winner.id, 'w1', 1_000n, 2_000n)]]),
    };

    const result = await (engine as unknown as { settleRound: () => Promise<unknown> }).settleRound();
    expect(result).not.toBeNull();

    const col = (await prisma.user.findUniqueOrThrow({ where: { id: winner.id } })).playBalanceLamports;
    expect(col).toBe(2_000n);
    expect(await deriveBalance(prisma, winner.id)).toBe(2_000n);
    const rows = await prisma.balanceLedger.findMany({ where: { userId: winner.id } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.reason).toBe('crash_settle');
    expect(rows[0]!.delta).toBe(2_000n);
  });
});

function live(userId: string, walletAddress: string, stake: bigint, payout: bigint) {
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
