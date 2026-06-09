import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { applyBalanceDelta } from './apply-balance-delta';

/**
 * Mock transaction client whose post-mutation balance is configurable so we can
 * assert the ledger row records the correct `balanceAfter`.
 */
function makeTx(balanceAfter: bigint, debitCount = 1) {
  const create = vi.fn().mockResolvedValue({});
  return {
    tx: {
      user: {
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: debitCount }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ playBalanceLamports: balanceAfter }),
      },
      balanceLedger: { create },
    },
    create,
  };
}

describe('applyBalanceDelta (unit)', () => {
  it('credit: increments via update and writes a ledger row with balanceAfter', async () => {
    const { tx, create } = makeTx(1_500n);
    const after = await applyBalanceDelta(tx as never, 'u1', 500n, {
      reason: 'crash_settle',
      refType: 'Bet',
      refId: 'bet1',
    });

    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { playBalanceLamports: { increment: 500n } },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        delta: 500n,
        reason: 'crash_settle',
        refType: 'Bet',
        refId: 'bet1',
        balanceAfter: 1_500n,
      },
    });
    expect(after).toBe(1_500n);
  });

  it('debit: uses a guarded updateMany (gte) and records the post-debit balanceAfter', async () => {
    const { tx, create } = makeTx(0n, 1);
    await applyBalanceDelta(tx as never, 'u1', -1_000n, { reason: 'crash_bet', refType: 'CrashRound' });

    expect(tx.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', banned: false, playBalanceLamports: { gte: 1_000n } },
      data: { playBalanceLamports: { increment: -1_000n } },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        delta: -1_000n,
        reason: 'crash_bet',
        refType: 'CrashRound',
        refId: null,
        balanceAfter: 0n,
      },
    });
  });

  it('debit that would go negative: rejects and writes NO ledger row', async () => {
    const { tx, create } = makeTx(0n, 0); // guard matches 0 rows
    await expect(
      applyBalanceDelta(tx as never, 'u1', -1_000n, { reason: 'crash_bet', refType: 'CrashRound' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
