import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { towerTraps } from '@scadium/fair';
import { towerMultiplier, TOWER } from '@scadium/shared';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import { TowerService } from '../src/games/tower/tower.service';
import { isSettled, type RoundState } from '../src/games/instant/stateful-round';
import { prisma, makeUser, realPow } from './engine-harness';

/**
 * Tower backend spec (#286): full round lifecycle over real Postgres, driving
 * TowerService directly (constructed outside NestJS DI with a stubbed RG gate).
 * Covers happy-path cashout, trap bust, the cashout-needs-a-row guard, post-bust
 * rejection, double-start, reach-the-top auto-cashout, and fairness reproducibility.
 */

const STAKE = 1_000_000n; // TOWER.MIN_BET_LAMPORTS
const BAL = 10_000_000n;

let tower: TowerService;

function buildService() {
  return new TowerService(
    prisma as never,
    new SeedManagerService(prisma as never),
    { assertCanWager: async () => undefined } as never,
    realPow(),
  );
}

async function trapsOf(roundId: string): Promise<number[][]> {
  const round = await prisma.instantRound.findUniqueOrThrow({ where: { id: roundId } });
  return (round.stateJson as unknown as RoundState).secret.traps as number[][];
}
function safeCol(traps: number[][], row: number): number {
  for (let c = 0; c < TOWER.COLUMNS; c += 1) if (!traps[row]!.includes(c)) return c;
  throw new Error('no safe column');
}

describe('Tower backend (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    tower = buildService();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('happy path: climb three rows then cashout banks stake × multiplier + records wager volume', async () => {
    const user = await makeUser(BAL);
    const start = await tower.start({ userId: user.id, amountLamports: STAKE });
    expect(start.status).toBe('active');
    expect(start.state).not.toHaveProperty('traps'); // secret withheld

    const traps = await trapsOf(start.roundId);
    for (let r = 0; r < 3; r += 1) {
      await tower.pick({ userId: user.id, roundId: start.roundId, column: safeCol(traps, r) });
    }

    const settle = await tower.cashout({ userId: user.id, roundId: start.roundId });
    if (!isSettled(settle)) throw new Error('expected settle');
    const expMult = towerMultiplier(3);
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

  it('bust: stepping on a trap settles a loss with no payout', async () => {
    const user = await makeUser(BAL);
    const start = await tower.start({ userId: user.id, amountLamports: STAKE });
    const traps = await trapsOf(start.roundId);
    const trapCol = traps[0]![0]!;
    const settle = await tower.pick({ userId: user.id, roundId: start.roundId, column: trapCol });
    if (!isSettled(settle)) throw new Error('expected settle');
    expect(settle.status).toBe('lost');
    expect(settle.payoutLamports).toBe('0');
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(BAL - STAKE);
  });

  it('cashout requires at least one cleared row', async () => {
    const user = await makeUser(BAL);
    const start = await tower.start({ userId: user.id, amountLamports: STAKE });
    await expect(tower.cashout({ userId: user.id, roundId: start.roundId })).rejects.toThrow(
      /at least one row/i,
    );
  });

  it('rejects a pick after the round busted', async () => {
    const user = await makeUser(BAL);
    const start = await tower.start({ userId: user.id, amountLamports: STAKE });
    const traps = await trapsOf(start.roundId);
    await tower.pick({ userId: user.id, roundId: start.roundId, column: traps[0]![0]! });
    await expect(
      tower.pick({ userId: user.id, roundId: start.roundId, column: safeCol(traps, 0) }),
    ).rejects.toThrow(/no longer active/i);
  });

  it('blocks a second concurrent Tower round for the same user', async () => {
    const user = await makeUser(BAL);
    await tower.start({ userId: user.id, amountLamports: STAKE });
    await expect(tower.start({ userId: user.id, amountLamports: STAKE })).rejects.toThrow(
      /in progress/i,
    );
  });

  it('auto-cashes-out on reaching the top row', async () => {
    const user = await makeUser(BAL);
    const start = await tower.start({ userId: user.id, amountLamports: STAKE });
    const traps = await trapsOf(start.roundId);
    let last: Awaited<ReturnType<TowerService['pick']>> | undefined;
    for (let r = 0; r < TOWER.ROWS; r += 1) {
      last = await tower.pick({ userId: user.id, roundId: start.roundId, column: safeCol(traps, r) });
    }
    if (!last || !isSettled(last)) throw new Error('expected auto-settle at the top');
    expect(last.status).toBe('won');
    expect(last.result.reachedTop).toBe(true);
    const expPayout = (STAKE * BigInt(Math.round(towerMultiplier(TOWER.ROWS) * 100))) / 100n;
    expect(last.payoutLamports).toBe(expPayout.toString());
    expect(await tower.active(user.id)).toBeNull();
  });

  it('published trap layout reproduces from the provably-fair seed', async () => {
    const user = await makeUser(BAL);
    const start = await tower.start({ userId: user.id, amountLamports: STAKE });
    const seed = await prisma.clientSeed.findUniqueOrThrow({ where: { userId: user.id } });
    const round = await prisma.instantRound.findUniqueOrThrow({ where: { id: start.roundId } });
    const recomputed = towerTraps(
      seed.serverSeed,
      round.clientSeed,
      round.nonce,
      TOWER.ROWS,
      TOWER.COLUMNS,
      TOWER.SAFE_PER_ROW,
    );
    const committed = (round.stateJson as unknown as RoundState).secret.traps as number[][];
    expect(committed).toEqual(recomputed);
  });
});
