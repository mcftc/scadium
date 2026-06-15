import { describe, it, expect, vi } from 'vitest';
import { AffiliatesService, tierCommission } from './affiliates.service';

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
    await svc.creditReferral(tx as never, 'B', 5n * SOL);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('accrues volume + tier-0 commission for a normal referral', async () => {
    const { tx, upsert } = makeTx({ referredById: 'A', signupIpHash: 'ipB' }, { signupIpHash: 'ipA' });
    await svc.creditReferral(tx as never, 'B', 5n * SOL);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          referrerId: 'A',
          refereeId: 'B',
          volumeLamports: 5n * SOL,
          commissionLamports: (5n * SOL * 5n) / 100n, // 5 SOL * 0.05
          flagged: false,
        }),
      }),
    );
  });

  it('flags a same-IP referrer/referee pair and accrues NO commission', async () => {
    const { tx, upsert } = makeTx({ referredById: 'A', signupIpHash: 'same' }, { signupIpHash: 'same' });
    await svc.creditReferral(tx as never, 'B', 5n * SOL);
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
