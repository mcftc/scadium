import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ENGINE } from '@scadium/shared';
import { StakingService } from '../src/staking/staking.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { prisma } from './engine-harness';

/**
 * SCAD Engine auto-stake (#206) integration against real Postgres. Proves the
 * lazy `autoStakeSweep` money path: earned $SCAD sweeps into the LOCKED staked
 * balance via the exact stake semantics (applyBalanceDelta scad→scad_staked,
 * StakeEvent kind:'auto_stake', lock set) atomically, never double-credits,
 * conserves total scad + scad_staked, respects MIN_STAKE, rejects an early
 * unstake, and leaves `stakeLedgerDrift()` at ZERO. Toggle OFF = no sweep.
 */
describe('SCAD Engine — auto-stake on earn (#206)', () => {
  const staking = new StakingService(prisma as never, { enabled: false } as never);
  // stakeLedgerDrift() only touches prisma; the chain dep (summary's chainEnabled) is stubbed.
  const reconcile = new ReconciliationService(prisma as never, {} as never);

  const userIds: string[] = [];

  /** Fresh user with `enabled` auto-stake and `balance` spendable $SCAD. */
  async function makeStaker(enabled: boolean, balance: bigint): Promise<string> {
    const id = randomUUID();
    const u = await prisma.user.create({
      data: {
        walletAddress: `eng-auto-${id}`,
        refCode: `eng-auto-ref-${id}`,
        scadiumBalance: balance,
        autoStakeEnabled: enabled,
      },
    });
    userIds.push(u.id);
    return u.id;
  }

  beforeEach(() => {
    userIds.length = 0;
  });

  afterAll(async () => {
    // Clean every row this suite created so the shared test DB drift checks stay clean.
    await prisma.reconciliationDrift.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.stakeEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.balanceLedger.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it('ON: earned $SCAD ends up staked + locked via the auto_stake path', async () => {
    const earned = 500_000_000_000n; // 500 SCAD (≥ MIN_STAKE)
    const userId = await makeStaker(true, earned);

    const moved = await staking.autoStakeSweep(userId);
    expect(moved).toBe(earned);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.scadiumStaked).toBe(earned); // credited to staked
    expect(u.scadiumBalance).toBe(0n); // debited from spendable
    expect(u.stakeLockedUntil).not.toBeNull();
    expect(u.stakeLockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // StakeEvent kind:'auto_stake' written.
    const ev = await prisma.stakeEvent.findFirst({ where: { userId, kind: 'auto_stake' } });
    expect(ev).not.toBeNull();
    expect(ev!.amountScad).toBe(earned);
    expect(ev!.stakedAfter).toBe(earned);

    // A scad_staked ledger row was written (both legs ledgered).
    const stakedLedger = await prisma.balanceLedger.findFirst({
      where: { userId, currency: 'scad_staked' },
      orderBy: { createdAt: 'desc' },
    });
    expect(stakedLedger).not.toBeNull();
    expect(stakedLedger!.balanceAfter).toBe(earned);
  });

  it('conserves total scad + scad_staked and never double-credits', async () => {
    const earned = 300_000_000_000n;
    const userId = await makeStaker(true, earned);

    await staking.autoStakeSweep(userId);
    // Second sweep is a no-op (spendable already 0 → below MIN).
    const second = await staking.autoStakeSweep(userId);
    expect(second).toBe(0n);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.scadiumBalance + u.scadiumStaked).toBe(earned); // total conserved
    expect(u.scadiumStaked).toBe(earned);

    // Exactly one auto_stake event (no double-credit).
    const count = await prisma.stakeEvent.count({ where: { userId, kind: 'auto_stake' } });
    expect(count).toBe(1);
  });

  it('rejects an immediate unstake (lock enforced)', async () => {
    const userId = await makeStaker(true, 500_000_000_000n);
    await staking.autoStakeSweep(userId);
    await expect(staking.unstake(userId, 1_000_000_000n)).rejects.toThrow(/locked/i);
  });

  it('respects MIN_STAKE: below-minimum spendable is NOT swept', async () => {
    const dust = BigInt(ENGINE.MIN_STAKE_SCAD_BASE) - 1n;
    const userId = await makeStaker(true, dust);

    const moved = await staking.autoStakeSweep(userId);
    expect(moved).toBe(0n);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.scadiumBalance).toBe(dust); // stays spendable
    expect(u.scadiumStaked).toBe(0n);
    expect(await prisma.stakeEvent.count({ where: { userId } })).toBe(0);
  });

  it('OFF: earned $SCAD stays spendable, no StakeEvent', async () => {
    const earned = 500_000_000_000n;
    const userId = await makeStaker(false, earned);

    const moved = await staking.autoStakeSweep(userId);
    expect(moved).toBe(0n);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.scadiumBalance).toBe(earned); // untouched, spendable
    expect(u.scadiumStaked).toBe(0n);
    expect(u.stakeLockedUntil).toBeNull();
    expect(await prisma.stakeEvent.count({ where: { userId } })).toBe(0);
  });

  it('summary() triggers the sweep for an active player', async () => {
    const earned = 500_000_000_000n;
    const userId = await makeStaker(true, earned);

    const summary = await staking.summary(userId);
    expect(summary.stakedScad).toBe(earned.toString());
    expect(summary.spendableScad).toBe('0');
    expect(summary.autoStakeEnabled).toBe(true);
  });

  it('setAutoStake(true) sweeps immediately; (false) disables future sweeps', async () => {
    const earned = 500_000_000_000n;
    const userId = await makeStaker(false, earned); // starts OFF

    // Turning ON sweeps the existing balance.
    await staking.setAutoStake(userId, true);
    let u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.scadiumStaked).toBe(earned);

    // Turn OFF; a later credit must NOT be swept by a summary touch.
    await staking.setAutoStake(userId, false);
    await prisma.user.update({
      where: { id: userId },
      data: { scadiumBalance: { increment: earned } },
    });
    await staking.summary(userId);
    u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.scadiumBalance).toBe(earned); // not swept
    expect(u.scadiumStaked).toBe(earned);
  });

  it('stakeLedgerDrift() flags ZERO of a batch of auto-staked users', async () => {
    // A batch of stakers all auto-stake; their scadiumStaked must equal the
    // latest scad_staked ledger balanceAfter, so the reconciler flags none of
    // them. (stakeLedgerDrift() scans the WHOLE shared test DB, so we assert no
    // drift row is attributed to THIS batch rather than a brittle global zero —
    // the per-user invariant is what the auto-stake path must hold.)
    const batch: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const userId = await makeStaker(true, 400_000_000_000n + BigInt(i) * 1_000_000_000n);
      await staking.autoStakeSweep(userId);
      batch.push(userId);
    }

    await reconcile.stakeLedgerDrift();

    const flagged = await prisma.reconciliationDrift.count({
      where: { userId: { in: batch }, field: 'scadiumStaked' },
    });
    expect(flagged).toBe(0);
  });
});
