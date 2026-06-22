import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { hiloSequence, cardRank } from '@scadium/fair';
import { HILO, hiloStepMultiplier, type HiloDirection } from '@scadium/shared';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import { HiloService } from '../src/games/hilo/hilo.service';
import { isSettled, type RoundState } from '../src/games/instant/stateful-round';
import { prisma, makeUser, realPow } from './engine-harness';

/**
 * Hi-Lo backend spec (#287): full round lifecycle over real Postgres, driving
 * HiloService directly (constructed outside NestJS DI with a stubbed RG gate).
 * Covers happy-path compounding + cashout, wrong-guess bust, the cashout guard,
 * post-bust rejection, double-start, and fairness reproducibility.
 */

const STAKE = 1_000_000n; // HILO.MIN_BET_LAMPORTS
const BAL = 10_000_000n;

let hilo: HiloService;

function buildService() {
  return new HiloService(
    prisma as never,
    new SeedManagerService(prisma as never),
    { assertCanWager: async () => undefined } as never,
    realPow(),
  );
}

async function seqOf(roundId: string): Promise<number[]> {
  const round = await prisma.instantRound.findUniqueOrThrow({ where: { id: roundId } });
  return (round.stateJson as unknown as RoundState).secret.sequence as number[];
}
const floor2 = (x: number) => Math.floor(x * 100) / 100;
/** The winning direction for the step from card[index] → card[index+1]. */
function winningDir(seq: number[], i: number): HiloDirection {
  return cardRank(seq[i + 1]!) >= cardRank(seq[i]!) ? 'higher' : 'lower';
}

describe('Hi-Lo backend (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    hilo = buildService();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('happy path: three correct guesses compound the multiplier, cashout banks it + accrues $SCAD', async () => {
    const user = await makeUser(BAL);
    const start = await hilo.start({ userId: user.id, amountLamports: STAKE });
    expect(start.status).toBe('active');
    expect(start.state).not.toHaveProperty('sequence'); // secret withheld

    const seq = await seqOf(start.roundId);
    let expCum = 1;
    for (let i = 0; i < 3; i += 1) {
      const dir = winningDir(seq, i);
      expCum = floor2(expCum * hiloStepMultiplier(cardRank(seq[i]!), dir));
      await hilo.guess({ userId: user.id, roundId: start.roundId, direction: dir });
    }

    const settle = await hilo.cashout({ userId: user.id, roundId: start.roundId });
    if (!isSettled(settle)) throw new Error('expected settle');
    const expPayout = (STAKE * BigInt(Math.round(expCum * 100))) / 100n;
    expect(settle.status).toBe('won');
    expect(settle.multiplier).toBeCloseTo(expCum);
    expect(settle.payoutLamports).toBe(expPayout.toString());

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(BAL - STAKE + expPayout);
    const scad = await prisma.balanceLedger.findFirst({
      where: { userId: user.id, currency: 'scad', reason: 'wager_reward' },
    });
    expect(scad).not.toBeNull();
  });

  it('bust: a wrong guess settles a loss with no payout', async () => {
    const user = await makeUser(BAL);
    const start = await hilo.start({ userId: user.id, amountLamports: STAKE });
    const seq = await seqOf(start.roundId);

    // Walk to the first step where the ranks differ (so a wrong guess is possible),
    // guessing correctly through any tie, then guess the wrong way.
    let busted = false;
    for (let i = 0; i < HILO.MAX_STEPS; i += 1) {
      const cur = cardRank(seq[i]!);
      const nxt = cardRank(seq[i + 1]!);
      if (cur !== nxt) {
        const wrong: HiloDirection = nxt > cur ? 'lower' : 'higher';
        const res = await hilo.guess({ userId: user.id, roundId: start.roundId, direction: wrong });
        if (!isSettled(res)) throw new Error('expected bust settle');
        expect(res.status).toBe('lost');
        expect(res.payoutLamports).toBe('0');
        busted = true;
        break;
      }
      await hilo.guess({ userId: user.id, roundId: start.roundId, direction: 'higher' });
    }
    expect(busted).toBe(true);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(BAL - STAKE);
  });

  it('cashout requires at least one correct guess', async () => {
    const user = await makeUser(BAL);
    const start = await hilo.start({ userId: user.id, amountLamports: STAKE });
    await expect(hilo.cashout({ userId: user.id, roundId: start.roundId })).rejects.toThrow(
      /at least one correct guess/i,
    );
  });

  it('rejects a guess after the round busted', async () => {
    const user = await makeUser(BAL);
    const start = await hilo.start({ userId: user.id, amountLamports: STAKE });
    const seq = await seqOf(start.roundId);
    // Force an immediate bust at the first differing step.
    let i = 0;
    while (i < HILO.MAX_STEPS && cardRank(seq[i]!) === cardRank(seq[i + 1]!)) {
      await hilo.guess({ userId: user.id, roundId: start.roundId, direction: 'higher' });
      i += 1;
    }
    const cur = cardRank(seq[i]!);
    const nxt = cardRank(seq[i + 1]!);
    const wrong: HiloDirection = nxt > cur ? 'lower' : 'higher';
    await hilo.guess({ userId: user.id, roundId: start.roundId, direction: wrong });
    await expect(
      hilo.guess({ userId: user.id, roundId: start.roundId, direction: 'higher' }),
    ).rejects.toThrow(/no longer active/i);
  });

  it('blocks a second concurrent Hi-Lo round for the same user', async () => {
    const user = await makeUser(BAL);
    await hilo.start({ userId: user.id, amountLamports: STAKE });
    await expect(hilo.start({ userId: user.id, amountLamports: STAKE })).rejects.toThrow(
      /in progress/i,
    );
  });

  it('published card sequence reproduces from the provably-fair seed', async () => {
    const user = await makeUser(BAL);
    const start = await hilo.start({ userId: user.id, amountLamports: STAKE });
    const seed = await prisma.clientSeed.findUniqueOrThrow({ where: { userId: user.id } });
    const round = await prisma.instantRound.findUniqueOrThrow({ where: { id: start.roundId } });
    const recomputed = hiloSequence(
      seed.serverSeed,
      round.clientSeed,
      round.nonce,
      HILO.MAX_STEPS + 1,
    );
    const committed = (round.stateJson as unknown as RoundState).secret.sequence as number[];
    expect(committed).toEqual(recomputed);
  });
});
