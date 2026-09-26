import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { KENO, KENO_RISKS, kenoPaytable, type KenoRisk } from '@scadium/shared';
import { kenoDraw, kenoHits } from '@scadium/fair';
import { PrismaService } from '../../prisma/prisma.service';
import { SeedManagerService } from '../../fairness/seed-manager.service';
import { RgService } from '../../responsible-gambling/rg.service';
import { ProofOfWagerService } from '../../proof-of-wager/proof-of-wager.service';
import { AffiliatesService } from '../../affiliates/affiliates.service';
import { settleInstantBet } from '../instant/instant-settle';
import { LiveFeedService } from '../../live/live-feed.service';
import { OnchainRngService } from '../../solana/onchain-rng.service';

@Injectable()
export class KenoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seeds: SeedManagerService,
    private readonly rg: RgService,
    private readonly proofOfWager: ProofOfWagerService,
    private readonly affiliates: AffiliatesService,
    @Optional() private readonly onchainRng?: OnchainRngService,
    @Optional() private readonly liveFeed?: LiveFeedService,
  ) {}

  /** Keno: KENO.DRAWS numbers are drawn; pays the paytable multiplier for the hit count. */
  async play(params: { userId: string; amountLamports: bigint; picks: number[]; risk: KenoRisk }) {
    const { userId, amountLamports, risk } = params;
    const picks = [...new Set(params.picks)].sort((a, b) => a - b);
    if (
      picks.length < KENO.MIN_PICKS ||
      picks.length > KENO.MAX_PICKS ||
      picks.length !== params.picks.length ||
      picks.some((p) => !Number.isInteger(p) || p < 1 || p > KENO.CELLS)
    ) {
      throw new BadRequestException(
        `pick ${KENO.MIN_PICKS}-${KENO.MAX_PICKS} distinct numbers in 1..${KENO.CELLS}`,
      );
    }
    if (!KENO_RISKS.includes(risk)) throw new BadRequestException('unknown risk');
    if (
      amountLamports < BigInt(KENO.MIN_BET_LAMPORTS) ||
      amountLamports > BigInt(KENO.MAX_BET_LAMPORTS)
    ) {
      throw new BadRequestException('bet amount out of range');
    }
    const table = kenoPaytable(risk, picks.length);
    return settleInstantBet(
      {
        prisma: this.prisma,
        seeds: this.seeds,
        rg: this.rg,
        proofOfWager: this.proofOfWager,
        affiliates: this.affiliates,
        onchainRng: this.onchainRng,
        liveFeed: this.liveFeed,
      },
      { userId, gameType: 'keno', amountLamports, gameParams: { picks: picks.join(','), risk } },
      (seed) => {
        const drawn = kenoDraw(seed.serverSeed, seed.clientSeed, seed.nonce);
        const hits = kenoHits(picks, drawn);
        return { multiplier: table[hits] ?? 0, resultJson: { picks, risk, drawn, hits } };
      },
    );
  }
}
