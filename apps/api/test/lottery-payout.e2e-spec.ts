import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomInt } from 'node:crypto';
import { prisma, makeUser, makeSeed } from './engine-harness';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import type { ChainService } from '../src/solana/chain.service';

/**
 * #29 — unpaid lottery prizes must heal, never silently drop. Real Postgres;
 * the chain seam is stubbed (on-chain pay_prize movement + the underfunded
 * revert are proven by tests/scadium_lottery.ts on the localnet CI job).
 */
describe('lottery payout sweep + solvency (integration, real Postgres)', () => {

  const reconWith = (opts: {
    treasury: bigint;
    paySig?: string | null;
    payCalls?: { walletAddress: string; amountScadBase: bigint }[];
  }) =>
    new ReconciliationService(prisma as never, {
      enabled: true,
      lotteryEnabled: true,
      lotteryTreasuryBalance: async () => opts.treasury,
      lotteryPayPrize: async (p: { walletAddress: string; amountScadBase: bigint }) => {
        opts.payCalls?.push(p);
        return opts.paySig ?? null;
      },
    } as unknown as ChainService);

  /** A drawn draw + winning tickets (unpaid) for `wallets`, prize each. */
  async function seedDrawnDraw(prizes: { user: { id: string }; amount: bigint; tickets?: number }[]) {
    const seed = await makeSeed();
    const draw = await prisma.lotteryDraw.create({
      data: {
        seedId: seed.id,
        nonce: 0,
        status: 'drawn',
        drawIndex: BigInt(randomInt(1, 2_000_000_000)),
        drawAt: new Date(Date.now() - 60_000),
        drawnAt: new Date(),
      },
    });
    for (const p of prizes) {
      for (let i = 0; i < (p.tickets ?? 1); i++) {
        await prisma.lotteryTicket.create({
          data: {
            drawId: draw.id,
            userId: p.user.id,
            digits: [1, 2, 3, 4, 5, 6],
            costLamports: 0n,
            costScadBase: 0n,
            payoutScadBase: p.amount,
            matchLen: 6,
            bracket: 5,
            won: true,
          },
        });
      }
    }
    return draw;
  }

  beforeAll(async () => {
    await prisma.$connect();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('sweep pays an unpaid winner ONCE per (draw,winner) — multiple tickets aggregated', async () => {
    const u = await makeUser(0n);
    const draw = await seedDrawnDraw([{ user: u, amount: 100n, tickets: 3 }]); // 3 winning tickets
    const payCalls: { walletAddress: string; amountScadBase: bigint }[] = [];
    const recon = reconWith({ treasury: 10n ** 18n, paySig: 'sig-paid', payCalls });

    await recon.sweepLotteryPrizes();
    // The shared test DB carries other suites' draws — scope to OUR winner:
    const ours = payCalls.filter((c) => c.walletAddress === u.walletAddress);
    expect(ours).toHaveLength(1); // ONE aggregated pay_prize, not 3
    expect(ours[0]!.amountScadBase).toBe(300n); // Σ of the 3 tickets

    const tickets = await prisma.lotteryTicket.findMany({ where: { drawId: draw.id } });
    expect(tickets.every((t: { prizeTxSignature: string | null }) => t.prizeTxSignature === 'sig-paid')).toBe(true);
  });

  it('solvency: an underfunded treasury defers payouts (nothing marked paid)', async () => {
    const u = await makeUser(0n);
    const draw = await seedDrawnDraw([{ user: u, amount: 5_000n }]);
    const recon = reconWith({ treasury: 100n, paySig: 'sig-should-not-fire' });

    await recon.sweepLotteryPrizes();
    const t = await prisma.lotteryTicket.findFirstOrThrow({ where: { drawId: draw.id } });
    expect(t.prizeTxSignature).toBeNull(); // unpaid but tracked — heals when funded

    // ...and the drift check flags the draw meanwhile.
    expect(await recon.lotteryPayoutDrift()).toBeGreaterThanOrEqual(1);

    // Treasury funded later → the same sweep heals it.
    const healed = reconWith({ treasury: 10n ** 18n, paySig: 'sig-healed' });
    await healed.sweepLotteryPrizes();
    const t2 = await prisma.lotteryTicket.findFirstOrThrow({ where: { drawId: draw.id } });
    expect(t2.prizeTxSignature).toBe('sig-healed');
  });

  it('a transient pay failure leaves tickets unpaid for the next sweep (no false paid-marking)', async () => {
    const u = await makeUser(0n);
    const draw = await seedDrawnDraw([{ user: u, amount: 50n }]);
    const payCalls: { walletAddress: string; amountScadBase: bigint }[] = [];
    const recon = reconWith({ treasury: 10n ** 18n, paySig: null, payCalls }); // RPC failure → null

    await recon.sweepLotteryPrizes();
    expect(payCalls.some((c) => c.walletAddress === u.walletAddress)).toBe(true); // attempted
    const t = await prisma.lotteryTicket.findFirstOrThrow({ where: { drawId: draw.id } });
    expect(t.prizeTxSignature).toBeNull(); // NOT marked paid on failure
  });
});
