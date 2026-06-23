import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mineField } from '@scadium/fair';
import { minesMultiplier, MINES } from '@scadium/shared';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import { MinesService } from '../src/games/mines/mines.service';
import { isSettled, type RoundState } from '../src/games/instant/stateful-round';
import { prisma, makeUser, realPow } from './engine-harness';

/**
 * Mines backend spec (#285): full round lifecycle over real Postgres, driving
 * MinesService directly (constructed outside NestJS DI with a stubbed RG gate).
 * Covers happy-path cashout, bust, the cashout-needs-a-pick guard, post-bust
 * rejection, double-start, fairness reproducibility, and the auto-cashout when
 * every safe tile is cleared.
 */

const STAKE = 1_000_000n; // MINES.MIN_BET_LAMPORTS
const BAL = 10_000_000n;

let mines: MinesService;

function buildService() {
  return new MinesService(
    prisma as never,
    new SeedManagerService(prisma as never),
    { assertCanWager: async () => undefined } as never,
    realPow(),
  );
}

async function secretOf(roundId: string): Promise<{ mines: number[]; mineCount: number }> {
  const round = await prisma.instantRound.findUniqueOrThrow({ where: { id: roundId } });
  const s = (round.stateJson as unknown as RoundState).secret;
  return { mines: s.mines as number[], mineCount: s.mineCount as number };
}

function firstSafeNotIn(mineCells: number[], revealed: number[]): number {
  for (let c = 0; c < MINES.CELLS; c += 1) {
    if (!mineCells.includes(c) && !revealed.includes(c)) return c;
  }
  throw new Error('no safe cell');
}

describe('Mines backend (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    mines = buildService();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('happy path: two safe picks then cashout banks stake × multiplier + records wager volume', async () => {
    const user = await makeUser(BAL);
    const start = await mines.start({ userId: user.id, amountLamports: STAKE, mines: 3 });
    expect(start.status).toBe('active');
    expect(start.state).not.toHaveProperty('mines'); // secret withheld

    const { mines: field } = await secretOf(start.roundId);
    const c1 = firstSafeNotIn(field, []);
    await mines.pick({ userId: user.id, roundId: start.roundId, cell: c1 });
    const c2 = firstSafeNotIn(field, [c1]);
    const afterPick2 = await mines.pick({ userId: user.id, roundId: start.roundId, cell: c2 });
    expect(isSettled(afterPick2)).toBe(false);

    const settle = await mines.cashout({ userId: user.id, roundId: start.roundId });
    if (!isSettled(settle)) throw new Error('expected settle');
    const expMult = minesMultiplier(3, 2);
    const expPayout = (STAKE * BigInt(Math.round(expMult * 100))) / 100n;
    expect(settle.status).toBe('won');
    expect(settle.payoutLamports).toBe(expPayout.toString());

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(BAL - STAKE + expPayout);

    // Engine v2: no per-bet $SCAD mint — accrue records the wager VOLUME into the
    // leaderboard (the play-rate the hourly block worker mints from).
    const lb = await prisma.wagerLeaderboard.findFirst({ where: { userId: user.id } });
    expect(lb?.wageredLamports).toBe(STAKE);
  });

  it('bust: revealing a bomb settles a loss with no payout (only the stake debit)', async () => {
    const user = await makeUser(BAL);
    const start = await mines.start({ userId: user.id, amountLamports: STAKE, mines: 5 });
    const { mines: field } = await secretOf(start.roundId);
    const settle = await mines.pick({ userId: user.id, roundId: start.roundId, cell: field[0]! });
    if (!isSettled(settle)) throw new Error('expected settle');
    expect(settle.status).toBe('lost');
    expect(settle.payoutLamports).toBe('0');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(BAL - STAKE);
  });

  it('cashout requires at least one safe pick', async () => {
    const user = await makeUser(BAL);
    const start = await mines.start({ userId: user.id, amountLamports: STAKE, mines: 3 });
    await expect(mines.cashout({ userId: user.id, roundId: start.roundId })).rejects.toThrow(
      /at least one tile/i,
    );
  });

  it('rejects a pick after the round busted (no resurrection)', async () => {
    const user = await makeUser(BAL);
    const start = await mines.start({ userId: user.id, amountLamports: STAKE, mines: 5 });
    const { mines: field } = await secretOf(start.roundId);
    await mines.pick({ userId: user.id, roundId: start.roundId, cell: field[0]! });
    const safe = firstSafeNotIn(field, []);
    await expect(
      mines.pick({ userId: user.id, roundId: start.roundId, cell: safe }),
    ).rejects.toThrow(/no longer active/i);
  });

  it('blocks a second concurrent Mines round for the same user', async () => {
    const user = await makeUser(BAL);
    await mines.start({ userId: user.id, amountLamports: STAKE, mines: 3 });
    await expect(
      mines.start({ userId: user.id, amountLamports: STAKE, mines: 3 }),
    ).rejects.toThrow(/in progress/i);
  });

  it('rejects revealing the same cell twice', async () => {
    const user = await makeUser(BAL);
    const start = await mines.start({ userId: user.id, amountLamports: STAKE, mines: 3 });
    const { mines: field } = await secretOf(start.roundId);
    const c = firstSafeNotIn(field, []);
    await mines.pick({ userId: user.id, roundId: start.roundId, cell: c });
    await expect(
      mines.pick({ userId: user.id, roundId: start.roundId, cell: c }),
    ).rejects.toThrow(/already revealed/i);
  });

  it('auto-cashes-out when every safe tile is cleared (max mines)', async () => {
    const user = await makeUser(BAL);
    // 24 mines on 25 cells → exactly one safe tile; the first safe pick clears all.
    const start = await mines.start({ userId: user.id, amountLamports: STAKE, mines: 24 });
    const { mines: field } = await secretOf(start.roundId);
    const safe = firstSafeNotIn(field, []);
    const settle = await mines.pick({ userId: user.id, roundId: start.roundId, cell: safe });
    if (!isSettled(settle)) throw new Error('expected auto-settle');
    expect(settle.status).toBe('won');
    expect(settle.result.cleared).toBe(true);
    expect(await mines.active(user.id)).toBeNull();
  });

  it('published field reproduces from the provably-fair seed', async () => {
    const user = await makeUser(BAL);
    const start = await mines.start({ userId: user.id, amountLamports: STAKE, mines: 4 });
    // Server-side seed (not yet rotated) → recompute the field and compare to what
    // the round committed.
    const seed = await prisma.clientSeed.findUniqueOrThrow({ where: { userId: user.id } });
    const round = await prisma.instantRound.findUniqueOrThrow({ where: { id: start.roundId } });
    const recomputed = mineField(
      seed.serverSeed,
      round.clientSeed,
      round.nonce,
      MINES.CELLS,
      4,
    );
    const committed = (round.stateJson as unknown as RoundState).secret.mines as number[];
    expect(committed).toEqual(recomputed);
  });
});
