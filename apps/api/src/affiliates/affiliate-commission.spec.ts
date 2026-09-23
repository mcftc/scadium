import { describe, it, expect, vi } from 'vitest';
import { AFFILIATE, COINFLIP, GAME_HOUSE_EDGE, type GameType } from '@scadium/shared';
import { AffiliatesService, referralCommission, tierCommission } from './affiliates.service';

const SOL = 1_000_000_000n;

type U = { referredById: string | null; signupIpHash: string | null };

function makeTx(referee: U, referrer: { signupIpHash: string | null }, priorVolume = 0n) {
  const upsert = vi.fn().mockResolvedValue({});
  const findUnique = vi
    .fn()
    .mockResolvedValueOnce(referee) // referee lookup
    .mockResolvedValueOnce(referrer); // referrer lookup
  const tx = {
    user: { findUnique },
    referral: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { volumeLamports: priorVolume } }),
      upsert,
    },
  };
  return { tx, upsert };
}

const svc = new AffiliatesService({} as never);

describe('affiliate commission (#47)', () => {
  it('tierCommission steps with the referrer cumulative volume', () => {
    expect(tierCommission(0n)).toBe(0.05);
    expect(tierCommission(10n * SOL)).toBe(0.08);
    expect(tierCommission(100n * SOL)).toBe(0.12);
    expect(tierCommission(1_000n * SOL)).toBe(0.15);
  });

  it('no-ops when the user has no referrer (self-referral never sets one)', async () => {
    const { tx, upsert } = makeTx({ referredById: null, signupIpHash: 'ipB' }, { signupIpHash: 'ipA' });
    await svc.creditReferral(tx as never, 'B', 5n * SOL, 'coinflip');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('accrues volume + tier-0 commission for a normal referral', async () => {
    const { tx, upsert } = makeTx({ referredById: 'A', signupIpHash: 'ipB' }, { signupIpHash: 'ipA' });
    await svc.creditReferral(tx as never, 'B', 5n * SOL, 'coinflip');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          referrerId: 'A',
          refereeId: 'B',
          volumeLamports: 5n * SOL,
          // 5 SOL × coinflip's 5% edge × tier-0 5% = 0.0125 SOL (was 5% of the stake)
          commissionLamports: (5n * SOL * 5n * 5n) / 10_000n,
          flagged: false,
        }),
      }),
    );
  });

  it('flags a same-IP referrer/referee pair and accrues NO commission', async () => {
    const { tx, upsert } = makeTx({ referredById: 'A', signupIpHash: 'same' }, { signupIpHash: 'same' });
    await svc.creditReferral(tx as never, 'B', 5n * SOL, 'coinflip');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          volumeLamports: 5n * SOL,
          commissionLamports: 0n,
          flagged: true,
        }),
      }),
    );
  });
});

describe('affiliate commission never exceeds the house take (B1)', () => {
  it('a referred pair flipping against each other at the top tier still pays the house', () => {
    // The exploit: A and B, both referred by R, flip S against each other. The
    // house keeps 2S − 1.9S = 0.1S; R was paid 2 × S × 15% = 0.3S — a riskless
    // profit for the ring. Commission is now a share of the edge, not the stake.
    const S = 10n * SOL;
    const topRate = AFFILIATE.TIER_COMMISSION[AFFILIATE.TIER_COMMISSION.length - 1]!;
    const houseTake = 2n * S - (S * BigInt(Math.round(COINFLIP.PAYOUT_MULTIPLIER * 100))) / 100n;
    const paidToReferrer = 2n * referralCommission(S, 'coinflip', topRate);
    expect(houseTake - paidToReferrer).toBeGreaterThan(0n);
  });

  it('for every game and every tier, commission ≤ stake × that game\'s edge', () => {
    const S = 7n * SOL + 123n;
    for (const game of Object.keys(GAME_HOUSE_EDGE) as GameType[]) {
      const edgeTake = BigInt(Math.floor(Number(S) * GAME_HOUSE_EDGE[game]));
      for (const rate of AFFILIATE.TIER_COMMISSION) {
        expect(referralCommission(S, game, rate)).toBeLessThanOrEqual(edgeTake);
      }
    }
  });
});
