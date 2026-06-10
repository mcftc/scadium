import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AirdropEngine } from './airdrop.engine';

/**
 * Issue #3 — the negative-amount tip must be rejected at the engine boundary
 * BEFORE any DB write, so the engine is safe regardless of caller. Without the
 * guard, `tip(userId, -X)` reaches `playBalanceLamports: { decrement: -X }`,
 * which INCREMENTS the balance (a play-money mint).
 */
describe('AirdropEngine.tip — non-positive guard (issue #3)', () => {
  const makeEngine = () => {
    const prisma = {
      // If the guard fails to short-circuit, the test will see $transaction called.
      $transaction: vi.fn(async () => undefined),
      airdropPool: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
      user: { findUnique: vi.fn(), update: vi.fn() },
    };
    const gateway = { emitPool: vi.fn() };
    const engine = new AirdropEngine(prisma as never, gateway as never);
    return { engine, prisma };
  };

  it('rejects a negative tip before touching the DB', async () => {
    const { engine, prisma } = makeEngine();
    await expect(engine.tip('user-1', -1_000_000_000n)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a zero tip before touching the DB', async () => {
    const { engine, prisma } = makeEngine();
    await expect(engine.tip('user-1', 0n)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
