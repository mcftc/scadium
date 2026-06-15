import { describe, it, expect, vi } from 'vitest';
import { RgService } from './rg.service';

const future = () => new Date(Date.now() + 3_600_000);

const makeSvc = (
  user: Record<string, unknown>,
  sum: { amountLamports: bigint; payoutLamports: bigint } = {
    amountLamports: 0n,
    payoutLamports: 0n,
  },
) =>
  new RgService(
    {
      user: { findUniqueOrThrow: vi.fn().mockResolvedValue(user) },
      bet: { aggregate: vi.fn().mockResolvedValue({ _sum: sum }) },
    } as never,
    { isPaused: async () => false } as never,
  );

const active = {
  selfExcludedUntil: null,
  coolOffUntil: null,
  dailyLossLimitLamports: null,
  dailyWagerLimitLamports: null,
};

describe('RgService.assertCanWager (#46)', () => {
  it('throws when self-excluded', async () => {
    const svc = makeSvc({ ...active, selfExcludedUntil: future() });
    await expect(svc.assertCanWager('u', 100n)).rejects.toThrow(/self-excluded/i);
  });

  it('throws when cooling-off', async () => {
    const svc = makeSvc({ ...active, coolOffUntil: future() });
    await expect(svc.assertCanWager('u', 100n)).rejects.toThrow(/cooling-off/i);
  });

  it('throws when today + stake exceeds the daily wager limit', async () => {
    const svc = makeSvc(
      { ...active, dailyWagerLimitLamports: 1_000_000_000n },
      { amountLamports: 900_000_000n, payoutLamports: 900_000_000n },
    );
    await expect(svc.assertCanWager('u', 200_000_000n)).rejects.toThrow(/wager limit/i);
  });

  it('throws when today net loss + stake exceeds the daily loss limit', async () => {
    const svc = makeSvc(
      { ...active, dailyLossLimitLamports: 1_000_000_000n },
      { amountLamports: 900_000_000n, payoutLamports: 0n },
    );
    await expect(svc.assertCanWager('u', 200_000_000n)).rejects.toThrow(/loss limit/i);
  });

  it('passes when within limits and active', async () => {
    const svc = makeSvc(
      { ...active, dailyWagerLimitLamports: 10_000_000_000n },
      { amountLamports: 0n, payoutLamports: 0n },
    );
    await expect(svc.assertCanWager('u', 100_000_000n)).resolves.toBeUndefined();
  });

  it('enforces only exclusion/cool-off for a 0n amount (lottery/tip path)', async () => {
    const svc = makeSvc({ ...active, dailyWagerLimitLamports: 1n });
    await expect(svc.assertCanWager('u', 0n)).resolves.toBeUndefined();
  });
});
