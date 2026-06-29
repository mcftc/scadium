import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { PLINKO, plinkoPayouts } from '@scadium/shared';
import { plinkoDrop } from '@scadium/fair';
import { PrismaService } from '../../prisma/prisma.service';
import { SeedManagerService } from '../../fairness/seed-manager.service';
import { RgService } from '../../responsible-gambling/rg.service';
import { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import { OnchainRngService } from '../../solana/onchain-rng.service';
import { settleInstantBet } from '../instant/instant-settle';

@Injectable()
export class PlinkoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seeds: SeedManagerService,
    private readonly rg: RgService,
    private readonly proofOfWager: ProofOfWagerService,
    // Optional so unit specs can construct the service without the chain layer;
    // the @Global SolanaModule supplies it in the running app (on-chain anchoring).
    @Optional() private readonly onchainRng?: OnchainRngService,
  ) {}

  /** Plinko: drop a ball through `rows` pegs; the landing bin sets the payout. */
  async play(params: { userId: string; amountLamports: bigint; rows: number }) {
    const { userId, amountLamports, rows } = params;
    const payouts = plinkoPayouts(rows);
    if (!payouts) {
      throw new BadRequestException(`rows must be one of ${PLINKO.ROWS.join(', ')}`);
    }
    if (
      amountLamports < BigInt(PLINKO.MIN_BET_LAMPORTS) ||
      amountLamports > BigInt(PLINKO.MAX_BET_LAMPORTS)
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
      { userId, gameType: 'plinko', amountLamports, gameParams: { rows } },
      (seed) => {
        const { path, bin } = plinkoDrop(seed.serverSeed, seed.clientSeed, seed.nonce, rows);
        const multiplier = payouts[bin] ?? 0;
        return { multiplier, resultJson: { rows, bin, path } };
      },
    );
  }
}
