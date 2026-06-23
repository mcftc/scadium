import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mineField } from '@scadium/fair';
import { minesMultiplier, MINES } from '@scadium/shared';
import { SeedManagerService } from '../src/fairness/seed-manager.service';
import {
  startStatefulRound,
  advanceStatefulRound,
  getActiveRound,
  isSettled,
  type StatefulDeps,
  type RoundState,
  type StepResult,
} from '../src/games/instant/stateful-round';
import { prisma, makeUser, realPow } from './engine-harness';

/**
 * Foundation spec (#284): the shared stateful-round helper drives a persisted
 * round with start → advance(step) → terminal settle, and must uphold the
 * money-safety invariants every stateful game relies on — stake debited exactly
 * once at start, payout credited at most once at settle, bust pays nothing,
 * double-start blocked, settle idempotent. Exercised through an inline Mines-like
 * game so the helper is tested without depending on a game module yet.
 */

// Minimal Mines wiring on top of the helper (the real module lands in #285).
const MINE_COUNT = 3;

function buildMines(seed: { serverSeed: string; clientSeed: string; nonce: number }) {
  const mines = mineField(seed.serverSeed, seed.clientSeed, seed.nonce, MINES.CELLS, MINE_COUNT);
  return {
    secret: { mines },
    public: { revealed: [] as number[] },
    multiplier: 0, // no payout before the first safe pick
  };
}

function pickStep(cell: number) {
  return (state: RoundState): StepResult => {
    const mines = state.secret.mines as number[];
    const revealed = (state.public.revealed as number[]) ?? [];
    if (mines.includes(cell)) {
      return { type: 'settle', won: false, multiplier: 0, resultJson: { mines, hitMine: cell } };
    }
    const nextRevealed = [...revealed, cell];
    const mult = minesMultiplier(MINE_COUNT, nextRevealed.length);
    return {
      type: 'continue',
      state: { secret: state.secret, public: { revealed: nextRevealed } },
      multiplier: mult,
    };
  };
}

function cashoutStep() {
  return (state: RoundState): StepResult => {
    const mines = state.secret.mines as number[];
    const revealed = (state.public.revealed as number[]) ?? [];
    const mult = minesMultiplier(MINE_COUNT, revealed.length);
    return { type: 'settle', won: true, multiplier: mult, resultJson: { mines, revealed } };
  };
}

let deps: StatefulDeps;

/** Find a safe, not-yet-revealed cell for a user's active round (reads the
 *  secret server-side). */
async function safeCellFor(roundId: string): Promise<number> {
  const round = await prisma.instantRound.findUniqueOrThrow({ where: { id: roundId } });
  const state = round.stateJson as unknown as RoundState;
  const mines = state.secret.mines as number[];
  const revealed = (state.public.revealed as number[]) ?? [];
  for (let c = 0; c < MINES.CELLS; c += 1) {
    if (!mines.includes(c) && !revealed.includes(c)) return c;
  }
  throw new Error('no safe cell');
}
async function mineCellFor(roundId: string): Promise<number> {
  const round = await prisma.instantRound.findUniqueOrThrow({ where: { id: roundId } });
  return (round.stateJson as unknown as RoundState).secret.mines[0] as number;
}

describe('stateful-round helper (integration, real Postgres)', () => {
  beforeAll(async () => {
    await prisma.$connect();
    deps = {
      prisma: prisma as never,
      seeds: new SeedManagerService(prisma as never),
      // RG is gated elsewhere; the helper only needs the choke-point call to pass.
      rg: { assertCanWager: async () => undefined } as never,
      proofOfWager: realPow(),
    };
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('start debits the stake, opens one active round, and masks the secret field', async () => {
    const user = await makeUser(10_000n);
    const view = await startStatefulRound(
      deps,
      { userId: user.id, gameType: 'mines', stakeLamports: 1_000n },
      buildMines,
    );

    expect(view.status).toBe('active');
    expect(view.stakeLamports).toBe('1000');
    // Public state only — the committed mine field must NOT leak.
    expect(view.state).not.toHaveProperty('mines');
    expect(view.state).toHaveProperty('revealed');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(9_000n); // debited exactly once

    // A ledger row was written for the debit (single mutation point).
    const debit = await prisma.balanceLedger.findFirst({
      where: { userId: user.id, refType: 'InstantRound', delta: -1_000n },
    });
    expect(debit).not.toBeNull();
  });

  it('blocks a second active round for the same game (one-active guard)', async () => {
    const user = await makeUser(10_000n);
    await startStatefulRound(
      deps,
      { userId: user.id, gameType: 'mines', stakeLamports: 1_000n },
      buildMines,
    );
    await expect(
      startStatefulRound(
        deps,
        { userId: user.id, gameType: 'mines', stakeLamports: 1_000n },
        buildMines,
      ),
    ).rejects.toThrow(/in progress/i);
    // The blocked start must NOT have debited a second time.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(9_000n);
  });

  it('happy path: safe picks compound the multiplier, cashout credits the payout + records wager volume', async () => {
    const user = await makeUser(10_000n);
    const start = await startStatefulRound(
      deps,
      { userId: user.id, gameType: 'mines', stakeLamports: 1_000n },
      buildMines,
    );

    // Two safe picks.
    const c1 = await safeCellFor(start.roundId);
    const r1 = await advanceStatefulRound(
      deps,
      { userId: user.id, roundId: start.roundId, gameType: 'mines' },
      pickStep(c1),
    );
    expect(isSettled(r1)).toBe(false);
    const c2 = await safeCellFor(start.roundId);
    expect(c2).not.toBe(c1);
    await advanceStatefulRound(
      deps,
      { userId: user.id, roundId: start.roundId, gameType: 'mines' },
      pickStep(c2),
    );

    // Cash out.
    const settle = await advanceStatefulRound(
      deps,
      { userId: user.id, roundId: start.roundId, gameType: 'mines' },
      cashoutStep(),
    );
    if (!isSettled(settle)) throw new Error('expected settle');

    const expectedMult = minesMultiplier(MINE_COUNT, 2);
    const expectedPayout = (1_000n * BigInt(Math.round(expectedMult * 100))) / 100n;
    expect(settle.status).toBe('won');
    expect(settle.payoutLamports).toBe(expectedPayout.toString());

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(9_000n + expectedPayout);
    expect(after.gamesPlayed).toBe(1);
    expect(after.totalWagered).toBe(1_000n);

    // A unified Bet row was written; accrue recorded the wager VOLUME into the
    // leaderboard (Engine v2 — no per-bet $SCAD mint; the hourly block worker
    // mints from this volume).
    const bet = await prisma.bet.findFirst({ where: { userId: user.id, gameType: 'mines' } });
    expect(bet?.status).toBe('won');
    const lb = await prisma.wagerLeaderboard.findFirst({ where: { userId: user.id } });
    expect(lb?.wageredLamports).toBe(1_000n);
  });

  it('bust path: hitting a mine settles a loss with no payout', async () => {
    const user = await makeUser(10_000n);
    const start = await startStatefulRound(
      deps,
      { userId: user.id, gameType: 'mines', stakeLamports: 1_000n },
      buildMines,
    );
    const mine = await mineCellFor(start.roundId);
    const settle = await advanceStatefulRound(
      deps,
      { userId: user.id, roundId: start.roundId, gameType: 'mines' },
      pickStep(mine),
    );
    if (!isSettled(settle)) throw new Error('expected settle');
    expect(settle.status).toBe('lost');
    expect(settle.payoutLamports).toBe('0');

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.playBalanceLamports).toBe(9_000n); // only the start debit
    expect(after.totalLost).toBe(1_000n);
  });

  it('settle is idempotent: advancing an ended round is rejected (no double pay)', async () => {
    const user = await makeUser(10_000n);
    const start = await startStatefulRound(
      deps,
      { userId: user.id, gameType: 'mines', stakeLamports: 1_000n },
      buildMines,
    );
    const c1 = await safeCellFor(start.roundId);
    await advanceStatefulRound(
      deps,
      { userId: user.id, roundId: start.roundId, gameType: 'mines' },
      pickStep(c1),
    );
    await advanceStatefulRound(
      deps,
      { userId: user.id, roundId: start.roundId, gameType: 'mines' },
      cashoutStep(),
    );
    const balAfterCashout = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .playBalanceLamports;

    // A second cashout on the now-ended round must be rejected.
    await expect(
      advanceStatefulRound(
        deps,
        { userId: user.id, roundId: start.roundId, gameType: 'mines' },
        cashoutStep(),
      ),
    ).rejects.toThrow(/no longer active/i);

    const balNow = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
      .playBalanceLamports;
    expect(balNow).toBe(balAfterCashout); // no second payout
    // Exactly one Bet row for this round.
    expect(await prisma.bet.count({ where: { userId: user.id, gameType: 'mines' } })).toBe(1);
  });

  it('getActiveRound returns the masked in-progress round, null after settle', async () => {
    const user = await makeUser(10_000n);
    const start = await startStatefulRound(
      deps,
      { userId: user.id, gameType: 'mines', stakeLamports: 1_000n },
      buildMines,
    );
    const active = await getActiveRound(deps, user.id, 'mines');
    expect(active?.roundId).toBe(start.roundId);
    expect(active?.state).not.toHaveProperty('mines');

    await advanceStatefulRound(
      deps,
      { userId: user.id, roundId: start.roundId, gameType: 'mines' },
      pickStep(await safeCellFor(start.roundId)),
    );
    await advanceStatefulRound(
      deps,
      { userId: user.id, roundId: start.roundId, gameType: 'mines' },
      cashoutStep(),
    );
    expect(await getActiveRound(deps, user.id, 'mines')).toBeNull();
  });
});
