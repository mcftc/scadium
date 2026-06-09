import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { debitPlayBalance } from './wallet.util';

describe('debitPlayBalance (unit)', () => {
  it('issues a single guarded updateMany (gte amount), not a read-then-decrement', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const client = { user: { updateMany } } as never;

    await debitPlayBalance(client, 'u1', 100n);

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', banned: false, playBalanceLamports: { gte: 100n } },
      data: { playBalanceLamports: { decrement: 100n } },
    });
  });

  it('rejects with BadRequestException when the guard matches no row (underfunded / lost race)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const client = { user: { updateMany } } as never;

    await expect(debitPlayBalance(client, 'u1', 100n)).rejects.toBeInstanceOf(BadRequestException);
  });
});
