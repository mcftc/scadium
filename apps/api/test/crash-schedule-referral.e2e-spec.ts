import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma, gw, realPow } from './engine-harness';
import { CrashService } from '../src/games/crash/crash.service';
import { CrashEngine } from '../src/games/crash/crash.engine';
import { AffiliatesService } from '../src/affiliates/affiliates.service';

const SOL = 1_000_000_000n;
const STAKE = SOL / 10n; // 0.1 SOL

const mkUser = (over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      walletAddress: `csr-${randomUUID()}`,
      refCode: `csr-${randomUUID().slice(0, 12)}`,
      ...over,
    },
  });

/**
 * Money-integrity regression for the crash scheduled-bet ↔ affiliate-claim mint
 * (found by the pre-merge adversarial audit). Crash used to credit referral
 * commission at SCHEDULE time, but a scheduled bet is refundable via
 * cancelScheduled — so a schedule→cancel loop accrued commission at zero net
 * cost, and #H18 `claim()` turned that stranded commission into spendable
 * balance (money minted from nothing). The fix credits the referrer only when
 * the scheduled stake DRAINS into a live round (irrevocable), so a cancelled
 * schedule earns nothing.
 */
describe('crash schedule→cancel must not mint affiliate commission (integration)', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('a scheduled-then-cancelled crash bet accrues NO commission and claim() mints nothing', async () => {
    const referrer = await mkUser({ signupIpHash: 'ip-ref-A' });
    const referee = await mkUser({
      referredById: referrer.id,
      signupIpHash: 'ip-ee-B',
      playBalanceLamports: SOL,
    });

    const affiliates = new AffiliatesService(prisma as never);
    const engineStub = {
      scheduleBet: () => undefined,
      cancelScheduled: () => ({ amountLamports: STAKE }),
    } as never;
    const rg = { assertCanWager: async () => undefined } as never;
    const svc = new CrashService(prisma as never, engineStub, rg, affiliates);

    await svc.scheduleBet({ userId: referee.id, amountLamports: STAKE, autoCashout: null });
    // Scheduling alone must NOT credit the referrer — the bet is still refundable.
    expect(await prisma.referral.findUnique({ where: { refereeId: referee.id } })).toBeNull();

    await svc.cancelScheduled(referee.id);
    // Still nothing accrued, and the stake is fully refunded (net-zero loop).
    expect(await prisma.referral.findUnique({ where: { refereeId: referee.id } })).toBeNull();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: referee.id } })).playBalanceLamports,
    ).toBe(SOL);

    // The exploit's payout leg: claim() must find nothing to mint.
    await expect(affiliates.claim(referrer.id)).rejects.toThrow(/No commission/);
  });

  it('the referrer IS credited once the scheduled bet drains into a live round', async () => {
    const referrer = await mkUser({ signupIpHash: 'ip-ref-C' });
    const referee = await mkUser({
      referredById: referrer.id,
      signupIpHash: 'ip-ee-D',
      playBalanceLamports: SOL,
    });

    const affiliates = new AffiliatesService(prisma as never);
    const chain = { enabled: false } as never;
    // Constructor order: prisma, gateway, chain, proofOfWager, redis?, onchainRng?, liveFeed?, affiliates?
    const engine = new CrashEngine(
      prisma as never,
      gw(),
      chain,
      realPow(),
      undefined,
      undefined,
      undefined,
      affiliates,
    );

    // Mimic scheduleBet's committed state: queue it in-memory + persist the row +
    // debit the stake (exactly what CrashService.scheduleBet does, minus the credit).
    engine.scheduleBet({
      userId: referee.id,
      username: referee.username,
      walletAddress: referee.walletAddress,
      amountLamports: STAKE,
      autoCashout: null,
    });
    await prisma.scheduledCrashBet.create({
      data: { userId: referee.id, amountLamports: STAKE, autoCashoutMultiplier: null },
    });
    await prisma.user.update({
      where: { id: referee.id },
      data: { playBalanceLamports: { decrement: STAKE } },
    });

    // Open a round (drains the scheduled bet). Fake timers suppress the trailing
    // 15s beginRun scheduling; the drain's DB tx still runs against real Postgres.
    vi.useFakeTimers();
    try {
      await (engine as unknown as { startNewRound: () => Promise<void> }).startNewRound();
    } finally {
      vi.useRealTimers();
    }

    // Drained → committed → referrer credited (tier-0 = 5%); the scheduled row is gone.
    const ref = await prisma.referral.findUniqueOrThrow({ where: { refereeId: referee.id } });
    expect(ref.referrerId).toBe(referrer.id);
    expect(ref.volumeLamports).toBe(STAKE);
    // STAKE × crash's 5% edge × tier-0 5% — a share of the house take (B1).
    expect(ref.commissionLamports).toBe((STAKE * 5n * 5n) / 10_000n);
    expect(ref.flagged).toBe(false);
    expect(await prisma.scheduledCrashBet.findUnique({ where: { userId: referee.id } })).toBeNull();
  });
});
