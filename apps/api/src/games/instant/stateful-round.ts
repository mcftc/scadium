import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type GameType, type InstantRound } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SeedManagerService } from '../../fairness/seed-manager.service';
import type { RgService } from '../../responsible-gambling/rg.service';
import type { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import { withSerializable } from '../../prisma/with-serializable';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';

/**
 * Shared backend for the STATEFUL provably-fair games (Mines / Hi-Lo / Tower):
 * the player drives a persisted round with `start` → `advance` (pick / guess /
 * step / cashout) → terminal settle. The stake is debited at start; the payout,
 * lifetime aggregates, Proof-of-Wager accrual and the unified `Bet` row are
 * written only at the terminal event. This is the single settlement path for
 * those three games (the coverage guard points each of them here).
 *
 * Money-safety: start runs in a Serializable tx behind `RgService.assertCanWager`
 * and debits via `applyBalanceDelta`; a partial unique index guarantees at most
 * one active round per (user, game). `advance` re-loads the round inside a
 * Serializable tx and refuses to act on a round that is no longer `active`, so a
 * busted/cashed round can never pay twice and concurrent cash-outs settle once.
 */

export interface StatefulDeps {
  prisma: PrismaService;
  seeds: SeedManagerService;
  rg: RgService;
  proofOfWager: ProofOfWagerService;
}

export interface RoundFairness {
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/** Server-side context handed to a game's `build`/`apply` callbacks. */
export interface StatefulSeedContext {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/**
 * Round state persisted as JSON. `secret` is the committed field (never sent to
 * the client while the round is active); `public` is the visible progress.
 */
export interface RoundState {
  secret: Record<string, unknown>;
  public: Record<string, unknown>;
}

/** Masked view safe to return to the client for an in-progress round. */
export interface RoundView {
  roundId: string;
  gameType: GameType;
  status: 'active' | 'won' | 'lost';
  stakeLamports: string;
  multiplier: number;
  state: Record<string, unknown>;
  fairness: RoundFairness;
}

/** Terminal settle result (cashout or bust). */
export interface RoundSettleResult {
  roundId: string;
  betId: string;
  gameType: GameType;
  status: 'won' | 'lost';
  stakeLamports: string;
  payoutLamports: string;
  multiplier: number;
  won: boolean;
  balanceLamports: string;
  result: Record<string, unknown>;
  fairness: RoundFairness;
}

/** What a game's `build` callback returns at start. */
export interface BuildResult {
  secret: Record<string, unknown>;
  public: Record<string, unknown>;
  /** Cash-out multiplier at zero progress (e.g. minesMultiplier(mines, 0)). */
  multiplier: number;
}

/** What a game's `apply` callback returns for one step. */
export type StepResult =
  | { type: 'continue'; state: RoundState; multiplier: number }
  | {
      type: 'settle';
      won: boolean;
      multiplier: number;
      /** Game detail published once the round is over (incl. the full field). */
      resultJson: Record<string, unknown>;
    };

function parseState(round: InstantRound): RoundState {
  const raw = round.stateJson as unknown as RoundState | null;
  return {
    secret: raw?.secret ?? {},
    public: raw?.public ?? {},
  };
}

function viewOf(round: InstantRound): RoundView {
  return {
    roundId: round.id,
    gameType: round.gameType,
    status: round.status,
    stakeLamports: round.stakeLamports.toString(),
    multiplier: round.multiplier,
    state: parseState(round).public,
    fairness: {
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
    },
  };
}

/**
 * Open a new stateful round: gate → debit the stake → consume the rotating seed
 * → let the game `build` the committed field → persist the active round. Returns
 * a masked view (secret field withheld). Throws `ConflictException` if the user
 * already has an active round for this game (enforced by a partial unique index;
 * a concurrent double-start surfaces as P2002 here).
 */
export async function startStatefulRound(
  deps: StatefulDeps,
  params: { userId: string; gameType: GameType; stakeLamports: bigint },
  build: (seed: StatefulSeedContext) => BuildResult,
): Promise<RoundView> {
  const { userId, gameType, stakeLamports } = params;
  if (stakeLamports <= 0n) throw new BadRequestException('amount must be positive');

  await deps.rg.assertCanWager(userId, stakeLamports);

  return withSerializable(deps.prisma, async (tx) => {
    // 1) One-active-round guard (fast path; the partial unique index is the
    //    concurrency-safe backstop).
    const existing = await tx.instantRound.findFirst({
      where: { userId, gameType, status: 'active' },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`a ${gameType} round is already in progress`);
    }

    // 2) Debit the stake through the single mutation point (ledger row in-tx).
    await applyBalanceDelta(tx, userId, -stakeLamports, {
      reason: `${gameType}_bet`,
      refType: 'InstantRound',
    });

    // 3) Consume the player's rotating provably-fair seed.
    const ctx = await deps.seeds.consumeNonce(tx, userId);
    const seed: StatefulSeedContext = {
      serverSeed: ctx.serverSeed,
      serverSeedHash: ctx.serverSeedHash,
      clientSeed: ctx.clientSeed,
      nonce: Number(ctx.nonce),
    };

    // 4) Build the committed field for this game.
    const built = build(seed);

    // 5) Persist the active round. P2002 ⇒ a concurrent start raced us.
    let round: InstantRound;
    try {
      round = await tx.instantRound.create({
        data: {
          userId,
          gameType,
          stakeLamports,
          status: 'active',
          serverSeedHash: seed.serverSeedHash,
          clientSeed: seed.clientSeed,
          nonce: seed.nonce,
          multiplier: built.multiplier,
          stateJson: { secret: built.secret, public: built.public } as Prisma.InputJsonValue,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`a ${gameType} round is already in progress`);
      }
      throw e;
    }

    return viewOf(round);
  });
}

/**
 * Advance an active round by one step. The game's `apply` callback inspects the
 * current (secret + public) state and returns either `continue` (update progress
 * and keep the round open) or `settle` (terminal: pay out or bust). Settlement
 * credits any payout, bumps lifetime aggregates, accrues Proof-of-Wager $SCAD and
 * writes the unified `Bet` row — all atomic. Idempotent against a non-active
 * round (throws), so a busted/cashed round never settles twice.
 */
export async function advanceStatefulRound(
  deps: StatefulDeps,
  params: { userId: string; roundId: string; gameType: GameType },
  apply: (state: RoundState, fairness: RoundFairness) => StepResult,
): Promise<RoundView | RoundSettleResult> {
  const { userId, roundId, gameType } = params;

  return withSerializable(deps.prisma, async (tx) => {
    const round = await tx.instantRound.findUnique({ where: { id: roundId } });
    if (!round || round.userId !== userId || round.gameType !== gameType) {
      throw new NotFoundException('round not found');
    }
    if (round.status !== 'active') {
      throw new ConflictException('round is no longer active');
    }

    const fairness: RoundFairness = {
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
    };
    const step = apply(parseState(round), fairness);

    // --- Non-terminal: just persist the new progress + multiplier. -----------
    if (step.type === 'continue') {
      const updated = await tx.instantRound.update({
        where: { id: round.id },
        data: {
          multiplier: step.multiplier,
          stateJson: {
            secret: step.state.secret,
            public: step.state.public,
          } as Prisma.InputJsonValue,
        },
      });
      return viewOf(updated);
    }

    // --- Terminal: settle exactly like settleInstantBet, but for a round. -----
    const stake = round.stakeLamports;
    const payoutLamports =
      step.won && step.multiplier > 0
        ? (stake * BigInt(Math.round(step.multiplier * 100))) / 100n
        : 0n;
    const netProfit = payoutLamports - stake;
    const won = step.won && netProfit > 0n;

    if (payoutLamports > 0n) {
      await applyBalanceDelta(tx, userId, payoutLamports, {
        reason: `${gameType}_settle`,
        refType: 'InstantRound',
        refId: round.id,
      });
    }

    await tx.user.update({
      where: { id: userId },
      data: {
        totalWagered: { increment: stake },
        totalWon: { increment: netProfit > 0n ? netProfit : 0n },
        totalLost: { increment: netProfit < 0n ? -netProfit : 0n },
        gamesPlayed: { increment: 1 },
      },
    });
    await tx.$executeRaw`
      UPDATE "User" SET "biggestWin" = GREATEST("biggestWin", ${netProfit})
      WHERE "id" = ${userId}::uuid
    `;

    // Central Proof-of-Wager accrual (+ leaderboard) in this tx — the engine
    // coverage contract requires every game to call this.
    await deps.proofOfWager.accrue(tx, { userId, gameType, stakeLamports: stake });

    const bet = await tx.bet.create({
      data: {
        userId,
        gameType,
        amountLamports: stake,
        payoutLamports,
        multiplier: step.multiplier,
        status: won ? 'won' : 'lost',
        nonce: round.nonce,
        resultJson: {
          ...step.resultJson,
          won,
          multiplier: step.multiplier,
          serverSeedHash: round.serverSeedHash,
          clientSeed: round.clientSeed,
          nonce: round.nonce,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    const settled = await tx.instantRound.update({
      where: { id: round.id },
      data: {
        status: won ? 'won' : 'lost',
        multiplier: step.multiplier,
        betId: bet.id,
        endedAt: new Date(),
        stateJson: {
          secret: parseState(round).secret,
          // On settle the full game detail becomes public for verification.
          public: { ...parseState(round).public, ...step.resultJson, settled: true },
        } as Prisma.InputJsonValue,
      },
    });

    const { playBalanceLamports } = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { playBalanceLamports: true },
    });

    return {
      roundId: settled.id,
      betId: bet.id,
      gameType,
      status: won ? 'won' : 'lost',
      stakeLamports: stake.toString(),
      payoutLamports: payoutLamports.toString(),
      multiplier: step.multiplier,
      won,
      balanceLamports: playBalanceLamports.toString(),
      result: step.resultJson,
      fairness,
    };
  });
}

/** Type guard so callers can branch on the `advance` return. */
export function isSettled(r: RoundView | RoundSettleResult): r is RoundSettleResult {
  return 'betId' in r;
}

/** Read a user's active round for a game (masked), or null. */
export async function getActiveRound(
  deps: Pick<StatefulDeps, 'prisma'>,
  userId: string,
  gameType: GameType,
): Promise<RoundView | null> {
  const round = await deps.prisma.instantRound.findFirst({
    where: { userId, gameType, status: 'active' },
    orderBy: { createdAt: 'desc' },
  });
  return round ? viewOf(round) : null;
}
