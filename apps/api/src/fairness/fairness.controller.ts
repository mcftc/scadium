import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FairnessService } from './fairness.service';
import { SeedManagerService } from './seed-manager.service';
import { VerifyFairnessDto } from './dto/verify-fairness.dto';
import { SetClientSeedDto } from './dto/set-client-seed.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../auth/current-user.decorator';
import { ChainService } from '../solana/chain.service';

@ApiTags('fairness')
@Controller('fairness')
export class FairnessController {
  constructor(
    private readonly fairness: FairnessService,
    private readonly seeds: SeedManagerService,
    private readonly chain: ChainService,
  ) {}

  @Post('verify')
  @ApiOperation({ summary: 'Reproduce a game result from seeds (provably fair)' })
  verify(@Body() dto: VerifyFairnessDto) {
    return this.fairness.verify(dto);
  }

  @Get('onchain')
  @ApiOperation({
    summary:
      'Shared on-chain RNG status — the single program (scadium_rng) that anchors every game',
  })
  onchain() {
    // Surfaces the "background blockchain activity" so the UI can SHOW it: every
    // game derives its outcome from this ONE program's commit→reveal + SlotHashes
    // entropy. Until it is deployed the API folds a synthetic slot hash off-chain
    // (play-money) — `live: false`. Each address ships with a Solscan link so the
    // panel can link straight to the cluster.
    const cluster = this.chain.cluster;
    const explorer = (kind: 'account' | 'token', id: string | null) =>
      id ? `https://solscan.io/${kind}/${id}?cluster=${cluster}` : null;

    return {
      cluster,
      // The headline: is the shared RNG actually driving outcomes on-chain?
      live: this.chain.rngEnabled,
      rng: {
        enabled: this.chain.rngEnabled,
        programId: this.chain.rngProgramIdBase58,
        explorerUrl: explorer('account', this.chain.rngProgramIdBase58),
      },
      lottery: {
        enabled: this.chain.lotteryEnabled,
        programId: this.chain.lotteryProgramIdBase58,
        explorerUrl: explorer('account', this.chain.lotteryProgramIdBase58),
      },
      vault: {
        enabled: this.chain.enabled,
        programId: this.chain.programIdBase58,
        explorerUrl: explorer('account', this.chain.programIdBase58),
      },
      scadMint: {
        address: this.chain.scadMintBase58,
        explorerUrl: explorer('token', this.chain.scadMintBase58),
      },
      usdsMint: {
        address: this.chain.usdsMintBase58,
        explorerUrl: explorer('token', this.chain.usdsMintBase58),
      },
    };
  }

  @Get('seed')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "The caller's active seed pair + next commitment + nonce" })
  getSeed(@CurrentUser() user: AuthContextLike) {
    return this.seeds.getOrCreateActivePair(user.userId);
  }

  @Post('seed/client')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Set the caller’s client seed (resets the nonce)' })
  setClientSeed(@CurrentUser() user: AuthContextLike, @Body() dto: SetClientSeedDto) {
    return this.seeds.setClientSeed(user.userId, dto.clientSeed);
  }

  @Post('seed/rotate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Reveal the current server seed and publish a fresh commitment' })
  rotate(@CurrentUser() user: AuthContextLike) {
    return this.seeds.rotateServerSeed(user.userId);
  }
}
