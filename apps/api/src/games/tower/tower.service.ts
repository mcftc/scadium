import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { TOWER, towerMultiplier } from '@scadium/shared';
import { towerTraps } from '@scadium/fair';
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
 * Tower: climb a tower row by row. Each row has `TOWER.COLUMNS` tiles, of which
 * `COLUMNS - SAFE_PER_ROW` are traps. The player picks one tile per row; a safe
 * tile advances them up and raises the cash-out multiplier, a trap busts the
 * round. Cash out at any time (after ≥1 cleared row) to bank
 * `stake × towerMultiplier(rowsClimbed)`. Reaching the top auto-cashes-out. The
 * trap layout is committed from the provably-fair seed at start and published
 * once the round ends.
 */
@Injectable()
export class TowerService {
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

  async start(params: { userId: string; amountLamports: bigint }) {
    const { userId, amountLamports } = params;
    if (
      amountLamports < BigInt(TOWER.MIN_BET_LAMPORTS) ||
      amountLamports > BigInt(TOWER.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('bet amount out of range');
    }

    return startStatefulRound(
      this.deps,
      { userId, gameType: 'tower', stakeLamports: amountLamports, gameParams: {} },
      (seed) => {
        const traps = towerTraps(
          seed.serverSeed,
          seed.clientSeed,
          seed.nonce,
          TOWER.ROWS,
          TOWER.COLUMNS,
          TOWER.SAFE_PER_ROW,
        );
        return {
          // Committed trap columns per row, withheld until the round ends.
          secret: { traps },
          public: {
            rows: TOWER.ROWS,
            columns: TOWER.COLUMNS,
            safePerRow: TOWER.SAFE_PER_ROW,
            currentRow: 0,
            picks: [] as number[],
          },
          multiplier: 0, // no payout before the first cleared row
        };
      },
    );
  }

  async pick(params: { userId: string; roundId: string; column: number }) {
    const { userId, roundId, column } = params;
    if (!Number.isInteger(column) || column < 0 || column >= TOWER.COLUMNS) {
      throw new BadRequestException('column out of range');
    }

    return advanceStatefulRound(
      this.deps,
      { userId, roundId, gameType: 'tower' },
      (state: RoundState): StepResult => {
        const traps = state.secret.traps as number[][];
        const currentRow = (state.public.currentRow as number) ?? 0;
        const picks = (state.public.picks as number[]) ?? [];

        // Trap on the current row → bust: settle a loss and publish the layout.
        if (traps[currentRow]!.includes(column)) {
          return {
            type: 'settle',
            won: false,
            multiplier: 0,
            resultJson: { traps, picks, hitRow: currentRow, hitColumn: column },
          };
        }

        const nextRow = currentRow + 1;
        const nextPicks = [...picks, column];
        const multiplier = towerMultiplier(nextRow);

        // Reached the top → auto-cash-out at the max multiplier.
        if (nextRow >= TOWER.ROWS) {
          return {
            type: 'settle',
            won: true,
            multiplier,
            resultJson: { traps, picks: nextPicks, climbed: nextRow, reachedTop: true },
          };
        }

        return {
          type: 'continue',
          state: {
            secret: state.secret,
            public: {
              rows: TOWER.ROWS,
              columns: TOWER.COLUMNS,
              safePerRow: TOWER.SAFE_PER_ROW,
              currentRow: nextRow,
              picks: nextPicks,
            },
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
      { userId, roundId, gameType: 'tower' },
      (state: RoundState): StepResult => {
        const traps = state.secret.traps as number[][];
        const currentRow = (state.public.currentRow as number) ?? 0;
        const picks = (state.public.picks as number[]) ?? [];
        if (currentRow < 1) {
          throw new BadRequestException('clear at least one row before cashing out');
        }
        const multiplier = towerMultiplier(currentRow);
        return {
          type: 'settle',
          won: true,
          multiplier,
          resultJson: { traps, picks, climbed: currentRow, cashedOut: true },
        };
      },
    );
  }

  /** The player's active tower round (masked), or null. */
  async active(userId: string) {
    return getActiveRound(this.deps, userId, 'tower');
  }
}
