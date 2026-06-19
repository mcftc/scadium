import { BadRequestException, Injectable } from '@nestjs/common';
import { DICE, diceMultiplier } from '@scadium/shared';
import { diceRoll } from '@scadium/fair';
import { PrismaService } from '../../prisma/prisma.service';
import { SeedManagerService } from '../../fairness/seed-manager.service';
import { RgService } from '../../responsible-gambling/rg.service';
import { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import { settleInstantBet } from '../instant/instant-settle';

@Injectable()
export class DiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seeds: SeedManagerService,
    private readonly rg: RgService,
    private readonly proofOfWager: ProofOfWagerService,
  ) {}

  /** Roll-under dice: win when the roll is below `target` (in [2, 98]). */
  async play(params: { userId: string; amountLamports: bigint; target: number }) {
    const { userId, amountLamports, target } = params;
    if (!Number.isFinite(target) || target < DICE.MIN_TARGET || target > DICE.MAX_TARGET) {
      throw new BadRequestException(`target must be in [${DICE.MIN_TARGET}, ${DICE.MAX_TARGET}]`);
    }
    if (amountLamports < BigInt(DICE.MIN_BET_LAMPORTS) || amountLamports > BigInt(DICE.MAX_BET_LAMPORTS)) {
      throw new BadRequestException('bet amount out of range');
    }
    const multiplier = diceMultiplier(target);
    return settleInstantBet(
      { prisma: this.prisma, seeds: this.seeds, rg: this.rg, proofOfWager: this.proofOfWager },
      { userId, gameType: 'dice', amountLamports },
      (seed) => {
        const roll = diceRoll(seed.serverSeed, seed.clientSeed, seed.nonce);
        const won = roll < target;
        return { multiplier: won ? multiplier : 0, resultJson: { roll, target } };
      },
    );
  }
}
