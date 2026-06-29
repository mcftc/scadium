import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { WHEEL, WHEEL_SEGMENTS, wheelMultiplier } from '@scadium/shared';
import { wheelSpin } from '@scadium/fair';
import { PrismaService } from '../../prisma/prisma.service';
import { SeedManagerService } from '../../fairness/seed-manager.service';
import { RgService } from '../../responsible-gambling/rg.service';
import { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import { OnchainRngService } from '../../solana/onchain-rng.service';
import { settleInstantBet } from '../instant/instant-settle';

@Injectable()
export class WheelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seeds: SeedManagerService,
    private readonly rg: RgService,
    private readonly proofOfWager: ProofOfWagerService,
    // Optional so unit specs can construct the service without the chain layer;
    // the @Global SolanaModule supplies it in the running app (on-chain anchoring).
    @Optional() private readonly onchainRng?: OnchainRngService,
  ) {}

  /** Wheel: spin lands on a weighted segment whose multiplier is the payout. */
  async play(params: { userId: string; amountLamports: bigint }) {
    const { userId, amountLamports } = params;
    if (
      amountLamports < BigInt(WHEEL.MIN_BET_LAMPORTS) ||
      amountLamports > BigInt(WHEEL.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('bet amount out of range');
    }
    return settleInstantBet(
      {
        prisma: this.prisma,
        seeds: this.seeds,
        rg: this.rg,
        proofOfWager: this.proofOfWager,
        onchainRng: this.onchainRng,
      },
      { userId, gameType: 'wheel', amountLamports, gameParams: { segments: WHEEL_SEGMENTS } },
      (seed) => {
        const index = wheelSpin(seed.serverSeed, seed.clientSeed, seed.nonce, WHEEL_SEGMENTS);
        const multiplier = wheelMultiplier(index);
        return { multiplier, resultJson: { index, segments: WHEEL_SEGMENTS } };
      },
    );
  }
}
