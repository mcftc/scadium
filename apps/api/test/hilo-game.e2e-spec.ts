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
/**
 * A winning direction that pays the most for the step from card[i] → card[i+1].
 * Non-ties have a single winning direction; a tie wins both ways (the game's
 * rule is higher-or-same / lower-or-same), so pick the higher-multiplier side —
 * this lets the happy path bank a genuine >1× win quickly regardless of the
 * randomly drawn sequence, instead of assuming three guesses always clear the
 * 2% house edge (they don't: e.g. a guaranteed 'higher' on an Ace pays 0.98×).
 */
function bestWinningDir(seq: number[], i: number): HiloDirection {
  const cur = cardRank(seq[i]!);
  const nxt = cardRank(seq[i + 1]!);
  if (nxt > cur) return 'higher';
  if (nxt < cur) return 'lower';
  return hiloStepMultiplier(cur, 'higher') >= hiloStepMultiplier(cur, 'lower')
    ? 'higher'
    : 'lower';
}

describe('Hi-Lo backend (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    hilo = buildService();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('happy path: correct guesses compound the multiplier, cashout banks it + records wager volume', async () => {
    const user = await makeUser(BAL);
    const start = await hilo.start({ userId: user.id, amountLamports: STAKE });
    expect(start.status).toBe('active');
    expect(start.state).not.toHaveProperty('sequence'); // secret withheld

    const seq = await seqOf(start.roundId);
    // Guess correctly until the banked multiplier clears the 2% house edge
    // (> 1×, a genuine win), then cash out. Looping makes the outcome
    // independent of the randomly drawn sequence — a fixed 3 guesses can land
    // ≤ 1× (status 'lost') on some seeds, which was the historical flake. Cap
    // below MAX_STEPS so cashout — not the auto-cash-out — ends the round.
    let expCum = 1;
    let steps = 0;
    while (steps < HILO.MAX_STEPS - 1) {
      const dir = bestWinningDir(seq, steps);
      expCum = floor2(expCum * hiloStepMultiplier(cardRank(seq[steps]!), dir));
      await hilo.guess({ userId: user.id, roundId: start.roundId, direction: dir });
      steps += 1;
      if (expCum > 1) break;
    }
    expect(steps).toBeGreaterThanOrEqual(1);

    const settle = await hilo.cashout({ userId: user.id, roundId: start.roundId });
    if (!isSettled(settle)) throw new Error('expected settle');
    const expPayout = (STAKE * BigInt(Math.round(expCum * 100))) / 100n;
    // Status is derived from the game's own rule (won iff payout beats the
    // stake), recomputed with the identical floor2/round math, so it can never
    // diverge from the engine for any seed. In practice the loop above clears
    // 1×, so this asserts the 'won' branch.
    const expWon = expPayout > STAKE;
    expect(settle.status).toBe(expWon ? 'won' : 'lost');
    expect(settle.multiplier).toBeCloseTo(expCum);
    expect(settle.payoutLamports).toBe(expPayout.toString());

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(BAL - STAKE + expPayout);
    // Engine v2: no per-bet $SCAD mint — accrue records the wager VOLUME into the
    // leaderboard (the play-rate the hourly block worker mints from).
    const lb = await prisma.wagerLeaderboard.findFirst({ where: { userId: user.id } });
    expect(lb?.wageredLamports).toBe(STAKE);
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
