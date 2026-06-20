import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  crashPoint,
  generateServerSeed,
  generateClientSeed,
  commitServerSeed,
} from '@scadium/fair';
import { prisma, makeUser, makeCrashEngine } from './engine-harness';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';

/**
 * #190 — a WINNING crash round must leave the User win-aggregates with ZERO
 * reconciliation drift. `ReconciliationService.reconcileAll()` derives, per user,
 * from the `Bet` table:
 *   totalWagered = Σ amount
 *   totalWon     = Σ GREATEST(payout − amount, 0)   (NET win)
 *   totalLost    = Σ GREATEST(amount − payout, 0)   (NET loss)
 *   biggestWin   = GREATEST(MAX(payout − amount), 0)
 * so the crash settle must move `totalWon` by the NET win and
 * `biggestWin = max(biggestWin, payout − amount)`, or reconcile flags it
 * (the class of bug #187 fixed for lottery). This is the regression guard that
 * pins the corrected crash aggregate update.
 *
 * Drives a winning cashout (payout > stake) AND, on the same user, a second
 * losing bet (payout 0) so totalLost is exercised too; asserts the Bet row has
 * payout > amount and that all four aggregates reconcile with zero drift.
 */
const reconciliation = new ReconciliationService(
  prisma as never,
  { enabled: false, lotteryEnabled: false } as never,
);

const settleRound = (engine: unknown) =>
  (engine as { settleRound: () => Promise<unknown> }).settleRound();

/** Inject a fully-busted in-RAM round with the given bets, then settle it. */
async function runRound(
  bets: Array<{
    userId: string;
    walletAddress: string;
    stake: bigint;
    payout: bigint;
    cashedOutAt: number | null;
  }>,
) {
  const serverSeed = generateServerSeed();
  const clientSeed = generateClientSeed();
  const nonce = 0;
  const bustPoint = crashPoint(serverSeed, clientSeed, nonce);

  const seed = await prisma.seed.create({
    data: { serverSeed, serverSeedHash: commitServerSeed(serverSeed), clientSeed, nonce },
  });
  const round = await prisma.crashRound.create({
    data: { seedId: seed.id, nonce, status: 'running' },
  });

  const engine = makeCrashEngine();
  (engine as unknown as { current: unknown }).current = {
    id: round.id,
    seedId: seed.id,
    serverSeed,
    serverSeedHash: seed.serverSeedHash,
    clientSeed,
    nonce,
    bustPoint,
    phase: 'busted',
    startedAt: Date.now(),
    bets: new Map(
      bets.map((b) => [
        b.userId,
        {
          userId: b.userId,
          username: null,
          walletAddress: b.walletAddress,
          amountLamports: BigInt(0), // nothing still riding (fully exited or lost)
          originalAmountLamports: b.stake,
          payoutLamports: b.payout,
          autoCashout: null,
          cashedOutAt: b.cashedOutAt,
        },
      ]),
    ),
    targetSlot: null,
    exposure: null,
  };

  await settleRound(engine);
  return round.id;
}

/** Reconcile and return how many drift rows landed for this user. */
async function driftRows(userId: string): Promise<number> {
  await prisma.reconciliationDrift.deleteMany({ where: { userId } });
  await reconciliation.reconcileAll();
  return prisma.reconciliationDrift.count({ where: { userId } });
}

describe('#190 — a winning crash round leaves win-aggregates with zero drift', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a 2.5× cashout nets a positive win; aggregates reconcile (zero drift)', async () => {
    const u = await makeUser(0n);
    const stake = 100_000_000n; // 0.1 SOL
    const payout = 250_000_000n; // cashed out at 2.5× → net win 150_000_000
    await runRound([
      { userId: u.id, walletAddress: u.walletAddress, stake, payout, cashedOutAt: 2.5 },
    ]);

    const bet = await prisma.bet.findFirstOrThrow({
      where: { userId: u.id, gameType: 'crash' },
    });
    expect(bet.payoutLamports).toBeGreaterThan(bet.amountLamports); // a real net win
    expect(bet.payoutLamports).toBe(payout);
    expect(bet.amountLamports).toBe(stake);
    expect(bet.status).toBe('won');

    // The denormalized User aggregates exactly equal the reconciler's derivation.
    const netWin = payout - stake;
    const u2 = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(u2.totalWagered).toBe(stake);
    expect(u2.totalWon).toBe(netWin);
    expect(u2.totalLost).toBe(0n);
    expect(u2.biggestWin).toBe(netWin);

    expect(await driftRows(u.id)).toBe(0);
  });

  it('a win plus a later loss on the same user exercises totalWon + totalLost; zero drift', async () => {
    const u = await makeUser(0n);

    // Round 1: a win (3×).
    const winStake = 50_000_000n;
    const winPayout = 150_000_000n; // net +100_000_000
    await runRound([
      {
        userId: u.id,
        walletAddress: u.walletAddress,
        stake: winStake,
        payout: winPayout,
        cashedOutAt: 3,
      },
    ]);

    // Round 2: a total loss (rode through the bust → payout 0).
    const lossStake = 30_000_000n;
    await runRound([
      {
        userId: u.id,
        walletAddress: u.walletAddress,
        stake: lossStake,
        payout: 0n,
        cashedOutAt: null,
      },
    ]);

    const bets = await prisma.bet.findMany({
      where: { userId: u.id, gameType: 'crash' },
      orderBy: { createdAt: 'asc' },
    });
    expect(bets).toHaveLength(2);
    const won = bets.find((b) => b.payoutLamports > b.amountLamports)!;
    const lost = bets.find((b) => b.payoutLamports === 0n)!;
    expect(won.status).toBe('won');
    expect(lost.status).toBe('lost');

    const netWin = winPayout - winStake;
    const u2 = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(u2.totalWagered).toBe(winStake + lossStake);
    expect(u2.totalWon).toBe(netWin);
    expect(u2.totalLost).toBe(lossStake);
    expect(u2.biggestWin).toBe(netWin);
    expect(u2.gamesPlayed).toBe(2);

    expect(await driftRows(u.id)).toBe(0);
  });
});
