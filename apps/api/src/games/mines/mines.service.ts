import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { MINES, minesMultiplier } from '@scadium/shared';
import { mineField } from '@scadium/fair';
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
 * Mines: a 5×5 (CELLS) field with `mines` hidden bombs. The player reveals
 * tiles one at a time; each safe reveal raises the cash-out multiplier; revealing
 * a bomb busts the round. Cash out at any time (after ≥1 safe pick) to bank
 * `stake × multiplier`. The mine field is committed from the provably-fair seed
 * at start and only published once the round ends. Round lifecycle + money-safety
 * live in the shared stateful-round helper.
 */
@Injectable()
export class MinesService {
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

  /** Total safe tiles for a given mine count. */
  private static safeCells(mineCount: number): number {
    return MINES.CELLS - mineCount;
  }

  async start(params: { userId: string; amountLamports: bigint; mines: number }) {
    const { userId, amountLamports, mines } = params;
    if (mines < MINES.MIN_MINES || mines > MINES.MAX_MINES) {
      throw new BadRequestException(`mines must be in [${MINES.MIN_MINES}, ${MINES.MAX_MINES}]`);
    }
    if (
      amountLamports < BigInt(MINES.MIN_BET_LAMPORTS) ||
      amountLamports > BigInt(MINES.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('bet amount out of range');
    }

    return startStatefulRound(
      this.deps,
      { userId, gameType: 'mines', stakeLamports: amountLamports, gameParams: { mines } },
      (seed) => {
        const field = mineField(seed.serverSeed, seed.clientSeed, seed.nonce, MINES.CELLS, mines);
        return {
          // Committed field, withheld until the round ends.
          secret: { mines: field, mineCount: mines },
          // Visible progress only.
          public: { mineCount: mines, cells: MINES.CELLS, revealed: [] as number[] },
          // No payout before the first safe pick.
          multiplier: 0,
        };
      },
    );
  }

  async pick(params: { userId: string; roundId: string; cell: number }) {
    const { userId, roundId, cell } = params;
    if (!Number.isInteger(cell) || cell < 0 || cell >= MINES.CELLS) {
      throw new BadRequestException('cell out of range');
    }

    return advanceStatefulRound(
      this.deps,
      { userId, roundId, gameType: 'mines' },
      (state: RoundState): StepResult => {
        const mines = state.secret.mines as number[];
        const mineCount = state.secret.mineCount as number;
        const revealed = (state.public.revealed as number[]) ?? [];

        if (revealed.includes(cell)) {
          throw new BadRequestException('cell already revealed');
        }

        // Bomb → bust: settle a loss and publish the full field.
        if (mines.includes(cell)) {
          return {
            type: 'settle',
            won: false,
            multiplier: 0,
            resultJson: { mines, mineCount, revealed, hitMine: cell },
          };
        }

        const nextRevealed = [...revealed, cell];
        const multiplier = minesMultiplier(mineCount, nextRevealed.length);

        // All safe tiles cleared → auto-cash-out at the max multiplier.
        if (nextRevealed.length >= MinesService.safeCells(mineCount)) {
          return {
            type: 'settle',
            won: true,
            multiplier,
            resultJson: { mines, mineCount, revealed: nextRevealed, cleared: true },
          };
        }

        return {
          type: 'continue',
          state: {
            secret: state.secret,
            public: { mineCount, cells: MINES.CELLS, revealed: nextRevealed },
          },
          multiplier,
        };
      },
    );
  }

  async cashout(params: { userId: string; roundId: string }) {
    const { userId, roundId } = params;
    return advanceStatefulRound(
      this.deps,
      { userId, roundId, gameType: 'mines' },
      (state: RoundState): StepResult => {
        const mines = state.secret.mines as number[];
        const mineCount = state.secret.mineCount as number;
        const revealed = (state.public.revealed as number[]) ?? [];
        if (revealed.length < 1) {
          throw new BadRequestException('reveal at least one tile before cashing out');
        }
        const multiplier = minesMultiplier(mineCount, revealed.length);
        return {
          type: 'settle',
          won: true,
          multiplier,
          resultJson: { mines, mineCount, revealed, cashedOut: true },
        };
      },
    );
  }

  /** The player's active mines round (masked), or null. */
  async active(userId: string) {
    return getActiveRound(this.deps, userId, 'mines');
  }
}
