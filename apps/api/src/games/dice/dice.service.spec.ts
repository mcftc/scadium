import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { diceRoll } from '@scadium/fair';
import { diceMultiplier } from '@scadium/shared';
import { DiceService } from './dice.service';

const SS = 'srv-seed';
const CS = 'cli-seed';
const NONCE = 1;

/** Full mock of the serializable-tx surface settleInstantBet touches. */
function makeService() {
  const bet = { create: vi.fn().mockResolvedValue({ id: 'bet1' }) };
  const accrue = vi.fn().mockResolvedValue(0n);
  const tx = {
    user: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn().mockResolvedValue({}),
      findUniqueOrThrow: vi.fn().mockResolvedValue({ playBalanceLamports: 4_000_000n }),
    },
    balanceLedger: { create: vi.fn().mockResolvedValue({}) },
    bet,
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx) } as never;
  const seeds = {
    consumeNonce: vi
      .fn()
      .mockResolvedValue({ serverSeed: SS, serverSeedHash: 'h', clientSeed: CS, nonce: BigInt(NONCE) }),
  } as never;
  const rg = { assertCanWager: vi.fn().mockResolvedValue(undefined) } as never;
  const proofOfWager = { accrue } as never;
  return { svc: new DiceService(prisma, seeds, rg, proofOfWager), tx, accrue };
}

describe('DiceService.play (unit)', () => {
  it('rejects an out-of-range target', async () => {
    const { svc } = makeService();
    await expect(
      svc.play({ userId: 'u1', amountLamports: 1_000_000n, target: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('settles a roll: debits stake, accrues wager, writes a Bet row with the fair result', async () => {
    const { svc, tx, accrue } = makeService();
    const target = 50;
    const expectedRoll = diceRoll(SS, CS, NONCE);
    const expectedWon = expectedRoll < target;

    const res = await svc.play({ userId: 'u1', amountLamports: 1_000_000n, target });

    // Stake debited through applyBalanceDelta (guarded updateMany).
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { playBalanceLamports: { increment: -1_000_000n } } }),
    );
    // Central proof-of-wager accrual ran in-tx.
    expect(accrue).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ userId: 'u1', gameType: 'dice', stakeLamports: 1_000_000n }),
    );
    // Bet row reflects the deterministic fair outcome.
    const betArg = tx.bet.create.mock.calls[0]![0];
    expect(betArg.data.status).toBe(expectedWon ? 'won' : 'lost');
    expect(betArg.data.resultJson.roll).toBe(expectedRoll);
    expect(betArg.data.resultJson.target).toBe(target);
    expect(res.won).toBe(expectedWon);
    if (expectedWon) expect(res.multiplier).toBe(diceMultiplier(target));
  });
});
