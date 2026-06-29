import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { LIMBO } from '@scadium/shared';
import { limboResult } from '@scadium/fair';
import { PrismaService } from '../../prisma/prisma.service';
import { SeedManagerService } from '../../fairness/seed-manager.service';
import { RgService } from '../../responsible-gambling/rg.service';
import { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import { settleInstantBet } from '../instant/instant-settle';
import { OnchainRngService } from '../../solana/onchain-rng.service';

@Injectable()
export class LimboService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seeds: SeedManagerService,
    private readonly rg: RgService,
    private readonly proofOfWager: ProofOfWagerService,
    // Optional so unit specs can construct the service without the chain layer;
    // the @Global SolanaModule supplies it in the running app (on-chain anchoring).
    @Optional() private readonly onchainRng?: OnchainRngService,
  ) {}

  /** Limbo: win when the rolled multiplier is ≥ the chosen target; pays target×. */
  async play(params: { userId: string; amountLamports: bigint; target: number }) {
    const { userId, amountLamports, target } = params;
    if (!Number.isFinite(target) || target < LIMBO.MIN_TARGET || target > LIMBO.MAX_TARGET) {
      throw new BadRequestException(`target must be in [${LIMBO.MIN_TARGET}, ${LIMBO.MAX_TARGET}]`);
    }
    if (
      amountLamports < BigInt(LIMBO.MIN_BET_LAMPORTS) ||
      amountLamports > BigInt(LIMBO.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('bet amount out of range');
    }
    const targetMult = Math.floor(target * 100) / 100;
    return settleInstantBet(
      {
        prisma: this.prisma,
        seeds: this.seeds,
        rg: this.rg,
        proofOfWager: this.proofOfWager,
        onchainRng: this.onchainRng,
      },
      { userId, gameType: 'limbo', amountLamports, gameParams: { target: targetMult } },
      (seed) => {
        const result = limboResult(seed.serverSeed, seed.clientSeed, seed.nonce, LIMBO.HOUSE_EDGE);
        const won = result >= targetMult;
        return { multiplier: won ? targetMult : 0, resultJson: { result, target: targetMult } };
      },
    );
  }
}
