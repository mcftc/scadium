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
  const prisma = {
    // join()'s RG pre-read (H20) reads the flip's stake off the top-level client.
    coinflipGame: { findUnique: vi.fn().mockResolvedValue({ amountLamports: 1_000_000n }) },
    $transaction: (cb: (t: unknown) => unknown) => cb(tx),
  } as never;
  const gateway = { emitCreated: vi.fn(), emitResolved: vi.fn(), emitCancelled: vi.fn() } as never;
  const chain = { enabled: false } as never;
  const seeds = {} as never;
  const rg = { assertCanWager: vi.fn().mockResolvedValue(undefined) } as never;
  const affiliates = { creditReferral: vi.fn().mockResolvedValue(undefined) } as never;
  const proofOfWager = { accrue: vi.fn().mockResolvedValue(0n) } as never;
  return new CoinflipService(prisma, gateway, chain, seeds, rg, affiliates, proofOfWager);
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

/**
 * Unit guard for the cancel() compare-and-swap (H2). The flip is found OPEN
 * (a non-locking snapshot) but the guarded CAS (`coinflipGame.updateMany`
 * open→cancelled) claims ZERO rows — i.e. a concurrent join resolved the flip
 * between cancel's read and its write. cancel() must reject and refund NOBODY.
 * Pre-fix (unconditional `update` + refund before it) the creator was refunded
 * even though the flip had already settled — money duplication — so this is red
 * before / green after.
 */
describe('CoinflipService.cancel — status compare-and-swap (unit)', () => {
  it('rejects when the CAS claims 0 rows and refunds nobody', async () => {
    const userUpdateMany = vi.fn(); // applyBalanceDelta's guarded credit == the refund
    const ledgerCreate = vi.fn();
    const casUpdateMany = vi.fn().mockResolvedValue({ count: 0 }); // a join won the race

    const tx = {
      coinflipGame: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'g1',
          creatorId: 'creator',
          status: 'open',
          amountLamports: 1_000_000n,
        }),
        updateMany: casUpdateMany,
        findUniqueOrThrow: vi.fn(),
        update: vi.fn(),
      },
      user: { updateMany: userUpdateMany, update: vi.fn() },
      balanceLedger: { create: ledgerCreate },
    };

    const svc = makeService(tx);

    await expect(svc.cancel({ userId: 'creator', gameId: 'g1' })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(casUpdateMany).toHaveBeenCalledWith({
      where: { id: 'g1', status: 'open' },
      data: expect.objectContaining({ status: 'cancelled' }),
    });
    expect(userUpdateMany).not.toHaveBeenCalled(); // no refund credit
    expect(ledgerCreate).not.toHaveBeenCalled(); // no ledger movement
  });
});

/**
 * H20 — the joiner wagers the flip's stake in SOL, so the RG gate must be
 * called with that amount (not 0n) or a self-limited user could join unlimited
 * flips and bypass their daily wager/loss limit. assertCanWager short-circuits
 * on `amount <= 0`, so passing 0n silently skips the limit check.
 */
describe('CoinflipService.join — RG gate sees the real stake (unit, H20)', () => {
  it('calls assertCanWager with the flip amount, not 0n', async () => {
    const assertCanWager = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      coinflipGame: { findUnique: vi.fn().mockResolvedValue({ amountLamports: 1_000_000n }) },
      // Stop join right after the RG pre-check so we only assert the gate call.
      $transaction: vi.fn().mockRejectedValue(new Error('stop-after-rg')),
    } as never;
    const gateway = { emitCreated: vi.fn(), emitResolved: vi.fn(), emitCancelled: vi.fn() } as never;
    const svc = new CoinflipService(
      prisma,
      gateway,
      { enabled: false } as never,
      {} as never,
      { assertCanWager } as never,
      { creditReferral: vi.fn() } as never,
      { accrue: vi.fn() } as never,
    );

    await expect(svc.join({ userId: 'joiner', gameId: 'g1' })).rejects.toThrow();
    expect(assertCanWager).toHaveBeenCalledWith('joiner', 1_000_000n);
  });
});
