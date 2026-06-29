import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { HILO, hiloStepMultiplier, type HiloDirection } from '@scadium/shared';
import { hiloSequence, cardRank } from '@scadium/fair';
import { PrismaService } from '../../prisma/prisma.service';
import { SeedManagerService } from '../../fairness/seed-manager.service';
import { RgService } from '../../responsible-gambling/rg.service';
import { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import { OnchainRngService } from '../../solana/onchain-rng.service';
import {
  advanceStatefulRound,
  getActiveRound,
  startStatefulRound,
  type RoundState,
  type StatefulDeps,
  type StepResult,
} from '../instant/stateful-round';

/**
 * Hi-Lo: a base card is shown; the player guesses whether the next card is
 * higher-or-same or lower-or-same. Each correct guess compounds the multiplier
 * by the step odds for the CURRENT rank (ties count as a win for the chosen
 * direction, so the extremes always have a guaranteed option); a wrong guess
 * busts. Cash out (after ≥1 correct guess) to bank stake × cumulative multiplier.
 * Reaching the end of the committed card sequence auto-cashes-out. The whole
 * card sequence is committed from the provably-fair seed at start and published
 * once the round ends.
 */
@Injectable()
export class HiloService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seeds: SeedManagerService,
    private readonly rg: RgService,
    private readonly proofOfWager: ProofOfWagerService,
    // Optional so unit specs can construct the service without the chain layer;
    // the @Global SolanaModule supplies it in the running app (on-chain anchoring).
    @Optional() private readonly onchainRng?: OnchainRngService,
  ) {}

  private get deps(): StatefulDeps {
    return {
      prisma: this.prisma,
      seeds: this.seeds,
      rg: this.rg,
      proofOfWager: this.proofOfWager,
      onchainRng: this.onchainRng,
    };
  }

  /** Floor a multiplier product to 2 dp (matches the step-multiplier convention). */
  private static floor2(x: number): number {
    return Math.floor(x * 100) / 100;
  }

  async start(params: { userId: string; amountLamports: bigint }) {
    const { userId, amountLamports } = params;
    if (
      amountLamports < BigInt(HILO.MIN_BET_LAMPORTS) ||
      amountLamports > BigInt(HILO.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('bet amount out of range');
    }

    return startStatefulRound(
      this.deps,
      { userId, gameType: 'hilo', stakeLamports: amountLamports, gameParams: {} },
      (seed) => {
        // MAX_STEPS guesses ⇒ MAX_STEPS + 1 cards (base + one per guess).
        const sequence = hiloSequence(
          seed.serverSeed,
          seed.clientSeed,
          seed.nonce,
          HILO.MAX_STEPS + 1,
        );
        const base = sequence[0]!;
        return {
          secret: { sequence },
          public: {
            index: 0,
            card: base,
            rank: cardRank(base),
            steps: 0,
            cumMult: 1,
            maxSteps: HILO.MAX_STEPS,
          },
          multiplier: 0, // no payout before the first correct guess
        };
      },
    );
  }

  async guess(params: { userId: string; roundId: string; direction: HiloDirection }) {
    const { userId, roundId, direction } = params;
    if (direction !== 'higher' && direction !== 'lower') {
      throw new BadRequestException('direction must be higher or lower');
    }

    return advanceStatefulRound(
      this.deps,
      { userId, roundId, gameType: 'hilo' },
      (state: RoundState): StepResult => {
        const sequence = state.secret.sequence as number[];
        const index = (state.public.index as number) ?? 0;
        const steps = (state.public.steps as number) ?? 0;
        const cumMult = (state.public.cumMult as number) ?? 1;

        const currentRank = cardRank(sequence[index]!);
        const nextCard = sequence[index + 1]!;
        const nextRank = cardRank(nextCard);
        const correct = direction === 'higher' ? nextRank >= currentRank : nextRank <= currentRank;

        // Wrong guess → bust: settle a loss and publish the sequence.
        if (!correct) {
          return {
            type: 'settle',
            won: false,
            multiplier: 0,
            resultJson: {
              sequence,
              index,
              direction,
              currentRank,
              nextCard,
              nextRank,
              busted: true,
            },
          };
        }

        const stepMult = hiloStepMultiplier(currentRank, direction);
        const newCum = HiloService.floor2(cumMult * stepMult);
        const newIndex = index + 1;
        const newSteps = steps + 1;

        // Reached the end of the committed sequence → auto-cash-out.
        if (newSteps >= HILO.MAX_STEPS) {
          return {
            type: 'settle',
            won: true,
            multiplier: newCum,
            resultJson: { sequence, index: newIndex, steps: newSteps, reachedEnd: true },
          };
        }

        return {
          type: 'continue',
          state: {
            secret: state.secret,
            public: {
              index: newIndex,
              card: nextCard,
              rank: nextRank,
              steps: newSteps,
              cumMult: newCum,
              maxSteps: HILO.MAX_STEPS,
            },
          },
          multiplier: newCum,
        };
      },
    );
  }

  async cashout(params: { userId: string; roundId: string }) {
    const { userId, roundId } = params;
    return advanceStatefulRound(
      this.deps,
      { userId, roundId, gameType: 'hilo' },
      (state: RoundState): StepResult => {
        const sequence = state.secret.sequence as number[];
        const index = (state.public.index as number) ?? 0;
        const steps = (state.public.steps as number) ?? 0;
        const cumMult = (state.public.cumMult as number) ?? 1;
        if (steps < 1) {
          throw new BadRequestException('make at least one correct guess before cashing out');
        }
        return {
          type: 'settle',
          won: true,
          multiplier: cumMult,
          resultJson: { sequence, index, steps, cashedOut: true },
        };
      },
    );
  }

  /** The player's active Hi-Lo round (masked), or null. */
  async active(userId: string) {
    return getActiveRound(this.deps, userId, 'hilo');
  }
}
