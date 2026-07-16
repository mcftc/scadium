import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from './engine-harness';
import { LeaderboardService } from '../src/leaderboard/leaderboard.service';
import { racePrizeLamports } from '@scadium/shared';

const SOL = 1_000_000_000n;
const lb = new LeaderboardService(prisma as never);

const mkUser = (over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      walletAddress: `race-${randomUUID()}`,
      refCode: `race-${randomUUID().slice(0, 12)}`,
      playBalanceLamports: 0n,
      ...over,
    },
  });

const seedBet = (userId: string, amount: bigint, at: Date, status: 'won' | 'lost' = 'lost') =>
  prisma.bet.create({
    data: { userId, gameType: 'dice', amountLamports: amount, payoutLamports: 0n, status, createdAt: at },
  });

const balanceOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id } })).playBalanceLamports;

// A fixed PAST UTC day no "now"-seeding test touches → deterministic, no pollution.
const RACE_DAY = '20250115';
const DAY_START = Date.UTC(2025, 0, 15);
const DAY_END = DAY_START + 86_400_000;

describe('daily race + windowed leaderboard (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    // Reset the fixed race day so the suite is idempotent across re-runs (the
    // test DB is not wiped between runs — leftover RaceResult/Bet rows would make
    // settleRace no-op or shuffle the standings).
    await prisma.raceResult.deleteMany({ where: { raceDay: RACE_DAY } });
    await prisma.bet.deleteMany({
      where: { createdAt: { gte: new Date(DAY_START), lt: new Date(DAY_END) } },
    });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('settleRace pays the top wagerers their prize once, excludes banned, and is idempotent', async () => {
    const dayStart = new Date(DAY_START + 8 * 3_600_000); // mid-day, inside the window

    const a = await mkUser();
    const b = await mkUser();
    const c = await mkUser();
    const banned = await mkUser({ banned: true });

    await seedBet(a.id, 10n * SOL, dayStart);
    await seedBet(b.id, 6n * SOL, dayStart);
    await seedBet(c.id, 2n * SOL, dayStart);
    await seedBet(banned.id, 100n * SOL, dayStart); // biggest volume, but banned → excluded

    const res = await lb.settleRace(RACE_DAY);
    expect(res.paid).toBe(3);

    // Prizes follow the fixed pool curve by rank.
    expect(await balanceOf(a.id)).toBe(racePrizeLamports(0)); // 30% of 50 SOL = 15 SOL
    expect(await balanceOf(b.id)).toBe(racePrizeLamports(1)); // 20% = 10 SOL
    expect(await balanceOf(c.id)).toBe(racePrizeLamports(2)); // 14% = 7 SOL
    expect(await balanceOf(banned.id)).toBe(0n); // excluded

    // Ledgered, one RaceResult per winner, banned absent.
    expect(await prisma.balanceLedger.count({ where: { userId: a.id, reason: 'race_prize' } })).toBe(1);
    expect(await prisma.raceResult.count({ where: { raceDay: RACE_DAY } })).toBe(3);
    expect(await prisma.raceResult.findUnique({ where: { raceDay_userId: { raceDay: RACE_DAY, userId: banned.id } } })).toBeNull();
    const rankA = await prisma.raceResult.findUniqueOrThrow({ where: { raceDay_userId: { raceDay: RACE_DAY, userId: a.id } } });
    expect(rankA.rank).toBe(1);
    expect(rankA.prizeLamports).toBe(racePrizeLamports(0));

    // Idempotent: a re-run pays nobody again and leaves balances untouched.
    const again = await lb.settleRace(RACE_DAY);
    expect(again.paid).toBe(0);
    expect(await balanceOf(a.id)).toBe(racePrizeLamports(0));
    expect(await prisma.raceResult.count({ where: { raceDay: RACE_DAY } })).toBe(3);
  });

  it('windowedTop(daily) ranks by TODAY volume and ignores out-of-window bets', async () => {
    const now = Date.now();
    const today = new Date(now);
    const longAgo = new Date(Date.UTC(2024, 5, 1, 12, 0, 0)); // last year — out of the daily window

    // Huge stakes so these fresh users sit above other suites' small "now" bets.
    const x = await mkUser();
    const y = await mkUser();
    await seedBet(x.id, 1000n * SOL, today);
    await seedBet(x.id, 500n * SOL, longAgo); // must NOT count toward today
    await seedBet(y.id, 500n * SOL, today);

    const board = await lb.windowedTop('daily', 100);
    const ex = board.find((e) => e.userId === x.id);
    const ey = board.find((e) => e.userId === y.id);
    expect(ex).toBeDefined();
    expect(ey).toBeDefined();
    // Today-only volume (the last-year bet is excluded).
    expect(ex!.volumeLamports).toBe((1000n * SOL).toString());
    expect(ey!.volumeLamports).toBe((500n * SOL).toString());
    // Higher volume ranks ahead.
    expect(ex!.rank).toBeLessThan(ey!.rank);
  });
});
