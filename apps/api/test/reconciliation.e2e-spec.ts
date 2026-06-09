import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { applyBalanceDelta } from '../src/prisma/apply-balance-delta';
import { withSerializable } from '../src/prisma/with-serializable';

// TODO(harness #9): fold this bootstrap into the shared concurrency harness.
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://scadium:scadium@localhost:5432/scadium_test?schema=public';
const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
const svc = new ReconciliationService(prisma as never);

const RUN = `${Date.now().toString(36)}`;
let seq = 0;
interface Cols {
  totalWagered?: bigint;
  totalWon?: bigint;
  totalLost?: bigint;
  biggestWin?: bigint;
  gamesPlayed?: number;
  playBalanceLamports?: bigint;
}
async function makeUser(cols: Cols = {}) {
  seq += 1;
  return prisma.user.create({
    data: {
      walletAddress: `recon-${RUN}-${seq}`,
      refCode: `recon-ref-${RUN}-${seq}`,
      ...cols,
    },
  });
}
async function makeBet(userId: string, amount: bigint, payout: bigint) {
  return prisma.bet.create({
    data: { userId, gameType: 'crash', amountLamports: amount, payoutLamports: payout },
  });
}
// reconcileAll scans ALL users; isolate by asserting only on this user's rows.
async function driftFields(userId: string): Promise<string[]> {
  await svc.reconcileAll();
  const rows = await prisma.reconciliationDrift.findMany({ where: { userId } });
  return rows.map((r) => r.field).sort();
}

describe('reconciliation drift detection (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('flags a single corrupted aggregate (totalWagered) and nothing else', async () => {
    // Bet: wagered 1000, won 0, lost 1000, biggest 0, games 1.
    const user = await makeUser({
      totalWagered: 500n, // WRONG (should be 1000)
      totalWon: 0n,
      totalLost: 1000n,
      biggestWin: 0n,
      gamesPlayed: 1,
    });
    await makeBet(user.id, 1000n, 0n);

    expect(await driftFields(user.id)).toEqual(['totalWagered']);
    const row = await prisma.reconciliationDrift.findFirstOrThrow({
      where: { userId: user.id, field: 'totalWagered' },
    });
    expect(row.storedValue).toBe('500');
    expect(row.derivedValue).toBe('1000');
  });

  it("catches the known biggestWin understatement (the non-coinflip omission)", async () => {
    // Bet won 2000 over a 1000 stake → biggest should be 2000, stored 0.
    const user = await makeUser({
      totalWagered: 1000n,
      totalWon: 2000n,
      totalLost: 0n,
      biggestWin: 0n, // WRONG — never updated by non-coinflip settles
      gamesPlayed: 1,
    });
    await makeBet(user.id, 1000n, 3000n);

    expect(await driftFields(user.id)).toEqual(['biggestWin']);
  });

  it('no false positives: a user whose columns match its Bets is not flagged', async () => {
    const user = await makeUser({
      totalWagered: 1000n,
      totalWon: 2000n,
      totalLost: 0n,
      biggestWin: 2000n,
      gamesPlayed: 1,
    });
    await makeBet(user.id, 1000n, 3000n);

    expect(await driftFields(user.id)).toEqual([]);
  });

  it('playBalance: a normally-played default-funded user is NOT flagged; a tampered balance IS', async () => {
    // Fresh user: default 10 SOL, no ledger, no bets → no drift at all.
    const fresh = await makeUser();
    expect(await driftFields(fresh.id)).toEqual([]);

    // Plays normally through applyBalanceDelta (the real path): the opening
    // 10 SOL is un-ledgered, but the latest row's balanceAfter == live balance,
    // so NO playBalance drift. (This is the case the old artificial fixture
    // missed — see reviewer B1.)
    const played = await makeUser();
    await withSerializable(prisma, (tx) =>
      applyBalanceDelta(tx, played.id, -1_000_000_000n, { reason: 'crash_bet', refType: 'test' }),
    );
    expect(await driftFields(played.id)).toEqual([]);

    // A direct (non-ledgered) write to the balance breaks balanceAfter == live
    // → flagged as genuine drift.
    await prisma.user.update({ where: { id: played.id }, data: { playBalanceLamports: 123n } });
    expect(await driftFields(played.id)).toEqual(['playBalanceLamports']);
  });

  it('never mutates User — drift detection is flag-only', async () => {
    const user = await makeUser({ totalWagered: 7n, gamesPlayed: 0 });
    await makeBet(user.id, 1000n, 0n); // derived wagered 1000, lost 1000, games 1

    await svc.reconcileAll();

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.totalWagered).toBe(7n); // unchanged — NOT auto-healed
    expect(after.gamesPlayed).toBe(0);
  });
});
