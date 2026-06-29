import { BadRequestException } from '@nestjs/common';
import type { GameType } from '@prisma/client';
import { deriveSeedContext, type GameParams } from '@scadium/fair';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SeedManagerService } from '../../fairness/seed-manager.service';
import type { RgService } from '../../responsible-gambling/rg.service';
import type { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import type { OnchainRngService } from '../../solana/onchain-rng.service';
import { withSerializable } from '../../prisma/with-serializable';
import { applyBalanceDelta } from '../../prisma/apply-balance-delta';

export interface InstantSeedContext {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export interface InstantOutcome {
  /**
   * Payout multiplier (0 on a total loss; may be < 1 for partial-return games
   * like Plinko). Payout = floor(stake × multiplier); win/lose status is derived
   * from net profit, not this value.
   */
  multiplier: number;
  /** Game-specific result detail persisted in Bet.resultJson. */
  resultJson: Record<string, unknown>;
}

export interface InstantDeps {
  prisma: PrismaService;
  seeds: SeedManagerService;
  rg: RgService;
  proofOfWager: ProofOfWagerService;
  /**
   * Shared on-chain RNG driver. When present AND live (scadium_rng deployed +
   * cosigner), every instant bet is anchored on-chain: its seed/nonce is reserved
   * and a round is driven on the ONE program so the outcome derives from chain
   * entropy. Absent/disabled → the deterministic off-chain derivation (unchanged).
   */
  onchainRng?: OnchainRngService;
}

export interface InstantSettleResult {
  betId: string;
  gameType: GameType;
  amountLamports: string;
  payoutLamports: string;
  multiplier: number;
  won: boolean;
  balanceLamports: string;
  result: Record<string, unknown>;
  fairness: { serverSeedHash: string; clientSeed: string; nonce: number };
}

/**
 * Shared settlement for instant, house-banked, single-player provably-fair games
 * (Dice, Limbo, Wheel, Plinko). Mirrors the coinflip transactional pattern but
 * for one player: gate → debit → consume the rotating seed → resolve → credit →
 * aggregates → Proof-of-Wager accrual → unified Bet row, all atomic. The
 * per-game `resolve` callback turns the committed seed into an outcome via
 * `@scadium/fair`; the active serverSeed stays secret (only its hash is
 * returned) until the player rotates their seed, exactly like the other games.
 */
export async function settleInstantBet(
  deps: InstantDeps,
  params: {
    userId: string;
    gameType: GameType;
    amountLamports: bigint;
    /** Per-round dynamics bound into the on-chain derivation (target, rows, …). */
    gameParams?: GameParams;
  },
  resolve: (seed: InstantSeedContext) => InstantOutcome,
): Promise<InstantSettleResult> {
  const { userId, gameType, amountLamports, gameParams } = params;
  if (amountLamports <= 0n) throw new BadRequestException('amount must be positive');

  await deps.rg.assertCanWager(userId, amountLamports);

  // ON-CHAIN ANCHORING (when scadium_rng is live): reserve this bet's seed/nonce
  // and drive ONE shared-RNG round for `gameType` BEFORE the settlement tx, so
  // the ~1s commit→reveal never holds the serializable tx open. The program's
  // `final_entropy` is folded into the seed below. Off-chain (or ANY failure)
  // both stay null and the tx consumes the nonce + derives deterministically,
  // byte-identical to the play-money behaviour. A reserved-but-unused nonce (tx
  // rolls back) is harmless — nonces only need to be unique, not contiguous.
  let reserved: Awaited<ReturnType<SeedManagerService['reserveSeedContext']>> | null = null;
  let onchainEntropy: Uint8Array | null = null;
  if (deps.onchainRng?.live) {
    reserved = await deps.seeds.reserveSeedContext(userId);
    onchainEntropy = await deps.onchainRng.roundEntropy({
      gameType,
      roundId: deps.onchainRng.nextRoundId(),
      serverSeed: reserved.serverSeed,
      clientSeed: reserved.clientSeed,
      nonce: Number(reserved.nonce),
      gameParams,
    });
  }

  return withSerializable(deps.prisma, async (tx) => {
    // 1) Debit the stake through the single mutation point (writes a ledger row).
    await applyBalanceDelta(tx, userId, -amountLamports, {
      reason: `${gameType}_bet`,
      refType: 'Bet',
    });

    // 2) Use the pre-reserved seed (on-chain mode) or consume the player's
    //    rotating provably-fair seed now (off-chain). The active serverSeed is
    //    committed; revealed only on rotation.
    const ctx = reserved ?? (await deps.seeds.consumeNonce(tx, userId));
    // Fold through the unified derivation (single source for every game). Off-chain
    // (no `onchainEntropy`) this is a pass-through and behaves exactly as before;
    // when `scadium_rng` is live the round entropy + params anchor the outcome.
    const folded = deriveSeedContext({
      serverSeed: ctx.serverSeed,
      clientSeed: ctx.clientSeed,
      nonce: Number(ctx.nonce),
      onchainEntropy,
      gameParams,
    });
    const seed: InstantSeedContext = {
      serverSeed: folded.serverSeed,
      serverSeedHash: ctx.serverSeedHash,
      clientSeed: folded.clientSeed,
      nonce: folded.nonce,
    };

    // 3) Resolve the outcome and compute payout (BigInt-safe, 2-dp multiplier).
    //    Payout follows the multiplier directly (0 = total loss, <1 = partial
    //    return); "won" is net profit, the source of truth for P/L aggregates.
    const outcome = resolve(seed);
    const payoutLamports =
      outcome.multiplier > 0
        ? (amountLamports * BigInt(Math.round(outcome.multiplier * 100))) / 100n
        : 0n;
    const netProfit = payoutLamports - amountLamports;
    const won = netProfit > 0n;

    // 4) Credit any payout (single mutation point), then bump lifetime aggregates.
    if (payoutLamports > 0n) {
      await applyBalanceDelta(tx, userId, payoutLamports, {
        reason: `${gameType}_settle`,
        refType: 'Bet',
      });
    }
    await tx.user.update({
      where: { id: userId },
      data: {
        totalWagered: { increment: amountLamports },
        totalWon: { increment: netProfit > 0n ? netProfit : 0n },
        totalLost: { increment: netProfit < 0n ? -netProfit : 0n },
        gamesPlayed: { increment: 1 },
      },
    });
    // biggestWin = max under the row lock (no stale read-then-write).
    await tx.$executeRaw`
      UPDATE "User" SET "biggestWin" = GREATEST("biggestWin", ${netProfit})
      WHERE "id" = ${userId}::uuid
    `;

    // 5) Central Proof-of-Wager accrual (+ leaderboard) in this tx.
    await deps.proofOfWager.accrue(tx, { userId, gameType, stakeLamports: amountLamports });

    // 6) Unified Bet row with full fairness context (seedId null — instant games
    //    use the rotating ClientSeed state, not a per-round Seed row).
    const bet = await tx.bet.create({
      data: {
        userId,
        gameType,
        amountLamports,
        payoutLamports,
        multiplier: outcome.multiplier,
        status: won ? 'won' : 'lost',
        nonce: seed.nonce,
        resultJson: {
          ...outcome.resultJson,
          won,
          multiplier: outcome.multiplier,
          serverSeedHash: seed.serverSeedHash,
          clientSeed: seed.clientSeed,
          nonce: seed.nonce,
        },
      },
      select: { id: true },
    });

    const { playBalanceLamports } = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { playBalanceLamports: true },
    });

    return {
      betId: bet.id,
      gameType,
      amountLamports: amountLamports.toString(),
      payoutLamports: payoutLamports.toString(),
      multiplier: outcome.multiplier,
      won,
      balanceLamports: playBalanceLamports.toString(),
      result: outcome.resultJson,
      fairness: {
        serverSeedHash: seed.serverSeedHash,
        clientSeed: seed.clientSeed,
        nonce: seed.nonce,
      },
    };
  });
}
