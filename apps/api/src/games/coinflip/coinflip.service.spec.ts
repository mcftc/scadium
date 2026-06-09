import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { CoinflipService } from './coinflip.service';

/**
 * Unit guard for the join() compare-and-swap. We mock the Prisma transaction
 * so the flip is found OPEN but the CAS (`coinflipGame.updateMany` open→
 * resolving) claims ZERO rows — i.e. a concurrent joiner already grabbed it.
 * join() must reject and pay nobody. Pre-fix (no CAS, just a status read) this
 * path proceeded to debit + payout, so the test is red before / green after.
 */
function makeService(tx: Record<string, unknown>) {
  const prisma = { $transaction: (cb: (t: unknown) => unknown) => cb(tx) } as never;
  const gateway = { emitCreated: vi.fn(), emitResolved: vi.fn(), emitCancelled: vi.fn() } as never;
  const chain = { enabled: false } as never;
  return new CoinflipService(prisma, gateway, chain);
}

describe('CoinflipService.join — status compare-and-swap (unit)', () => {
  it('rejects when the CAS claims 0 rows and pays nobody', async () => {
    const userUpdateMany = vi.fn();
    const userUpdate = vi.fn();
    const casUpdateMany = vi.fn().mockResolvedValue({ count: 0 }); // lost the race

    const tx = {
      coinflipGame: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'g1',
          creatorId: 'creator',
          creatorSide: 'heads',
          status: 'open',
          amountLamports: 1_000_000n,
          seedId: 'seed1',
          nonce: 0,
          seed: { serverSeed: 'srv', clientSeed: 'cli' },
        }),
        updateMany: casUpdateMany,
        update: vi.fn(),
      },
      user: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'joiner', banned: false, playBalanceLamports: 10_000_000n }),
        updateMany: userUpdateMany,
        update: userUpdate,
      },
      bet: { createMany: vi.fn() },
      seed: { update: vi.fn() },
    };

    const svc = makeService(tx);

    await expect(svc.join({ userId: 'joiner', gameId: 'g1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(casUpdateMany).toHaveBeenCalledWith({
      where: { id: 'g1', status: 'open' },
      data: { status: 'resolving' },
    });
    expect(userUpdateMany).not.toHaveBeenCalled(); // no debit
    expect(userUpdate).not.toHaveBeenCalled(); // no payout
  });
});
