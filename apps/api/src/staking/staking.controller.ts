import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNumberString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ProofOfWagerService } from '../proof-of-wager/proof-of-wager.service';
import { StakingService } from './staking.service';

class StakeDto {
  /** $SCAD base units (9 decimals) to stake, as a decimal string. */
  @IsNumberString()
  amount!: string;
}

class UnstakeDto {
  /** $SCAD base units (9 decimals) to unstake, as a decimal string. */
  @IsNumberString()
  amount!: string;
}

class AutoStakeDto {
  /** Whether earned $SCAD should be auto-staked on the next staking touch. */
  @IsBoolean()
  enabled!: boolean;
}

@ApiTags('staking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('staking')
export class StakingController {
  constructor(
    private readonly staking: StakingService,
    private readonly proofOfWager: ProofOfWagerService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Staked balance, lock state, USDS earned + est. APY' })
  summary(@CurrentUser() ctx: AuthContext) {
    return this.staking.summary(ctx.userId);
  }

  @Get('auto-stake')
  @ApiOperation({ summary: 'Read the auto-stake-earned-$SCAD preference' })
  async getAutoStake(@CurrentUser() ctx: AuthContext) {
    return { enabled: await this.staking.getAutoStake(ctx.userId) };
  }

  @Patch('auto-stake')
  @ApiOperation({ summary: 'Toggle auto-staking of earned $SCAD' })
  async setAutoStake(@CurrentUser() ctx: AuthContext, @Body() dto: AutoStakeDto) {
    return { enabled: await this.staking.setAutoStake(ctx.userId, dto.enabled) };
  }

  @Get('earn-rate')
  @ApiOperation({
    summary: 'Current $SCAD earn rate: effective multiplier + per-SOL (display only)',
  })
  earnRate(@CurrentUser() ctx: AuthContext) {
    return this.proofOfWager.earnRate(ctx.userId);
  }

  @Post('stake')
  @ApiOperation({ summary: 'Stake $SCAD (locks it; earns USDS dividends)' })
  stake(@CurrentUser() ctx: AuthContext, @Body() dto: StakeDto) {
    return this.staking.stake(ctx.userId, BigInt(dto.amount));
  }

  @Post('claim-and-stake')
  @ApiOperation({ summary: 'Stake the entire earned $SCAD balance in one step' })
  claimAndStake(@CurrentUser() ctx: AuthContext) {
    return this.staking.claimAndStake(ctx.userId);
  }

  @Post('unstake')
  @ApiOperation({ summary: 'Unstake $SCAD (rejected until the lock elapses)' })
  unstake(@CurrentUser() ctx: AuthContext, @Body() dto: UnstakeDto) {
    return this.staking.unstake(ctx.userId, BigInt(dto.amount));
  }
}
