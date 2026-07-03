import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { DICE, diceMultiplier, type DiceMode } from '@scadium/shared';
import { diceRoll } from '@scadium/fair';
import { PrismaService } from '../../prisma/prisma.service';
import { SeedManagerService } from '../../fairness/seed-manager.service';
import { RgService } from '../../responsible-gambling/rg.service';
import { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import { OnchainRngService } from '../../solana/onchain-rng.service';
import { settleInstantBet } from '../instant/instant-settle';

@Injectable()
export class DiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seeds: SeedManagerService,
    private readonly rg: RgService,
    private readonly proofOfWager: ProofOfWagerService,
    // Optional so unit specs can construct the service without the chain layer;
    // the @Global SolanaModule supplies it in the running app (on-chain anchoring).
    @Optional() private readonly onchainRng?: OnchainRngService,
  ) {}

  /**
   * Dice: roll-under wins when roll < target; roll-over wins when
   * roll >= target (>= keeps the 10,000-outcome grid split exact — a strict >
   * would silently add ~1bp of edge). Target is in [2, 98] for both modes.
   */
  async play(params: {
    userId: string;
    amountLamports: bigint;
    target: number;
    mode?: DiceMode;
  }) {
    const { userId, amountLamports, target, mode = 'under' } = params;
    if (!Number.isFinite(target) || target < DICE.MIN_TARGET || target > DICE.MAX_TARGET) {
      throw new BadRequestException(`target must be in [${DICE.MIN_TARGET}, ${DICE.MAX_TARGET}]`);
    }
    if (
      amountLamports < BigInt(DICE.MIN_BET_LAMPORTS) ||
      amountLamports > BigInt(DICE.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('bet amount out of range');
    }
    const multiplier = diceMultiplier(target, mode);
    return settleInstantBet(
      {
        prisma: this.prisma,
        seeds: this.seeds,
        rg: this.rg,
        proofOfWager: this.proofOfWager,
        onchainRng: this.onchainRng,
      },
      { userId, gameType: 'dice', amountLamports, gameParams: { target, mode } },
      (seed) => {
        const roll = diceRoll(seed.serverSeed, seed.clientSeed, seed.nonce);
        const won = mode === 'over' ? roll >= target : roll < target;
        return { multiplier: won ? multiplier : 0, resultJson: { roll, target, mode } };
      },
    );
  }
}
