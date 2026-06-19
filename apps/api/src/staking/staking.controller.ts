import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { StakingService } from './staking.service';

export class StakeDto {
  /** $SCAD base units (9 decimals) to stake, as a decimal string. */
  @IsString()
  @Matches(/^[1-9]\d*$/)
  @MaxLength(20)
  amount!: string;
}

export class UnstakeDto {
  /** $SCAD base units (9 decimals) to unstake, as a decimal string. */
  @IsString()
  @Matches(/^[1-9]\d*$/)
  @MaxLength(20)
  amount!: string;
}

@ApiTags('staking')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('staking')
export class StakingController {
  constructor(private readonly staking: StakingService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Staked balance, lock state, USDS earned + est. APY' })
  summary(@CurrentUser() ctx: AuthContext) {
    return this.staking.summary(ctx.userId);
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
