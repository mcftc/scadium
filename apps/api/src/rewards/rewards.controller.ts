import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RewardsService } from './rewards.service';

class ClaimDto {
  @IsIn(['wagerReward', 'cashback'])
  kind!: 'wagerReward' | 'cashback';
}

@ApiTags('rewards')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get('summary')
  @ApiOperation({ summary: 'Claimable $SCAD amounts + daily case status' })
  summary(@CurrentUser() ctx: AuthContext) {
    return this.rewards.summary(ctx.userId);
  }

  @Post('claim')
  @ApiOperation({ summary: 'Claim accrued $SCAD (wager rewards or cashback)' })
  claim(
    @CurrentUser() ctx: AuthContext,
    @Body() dto: ClaimDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.rewards.claim(ctx.userId, dto.kind, key);
  }

  @Get('claims')
  @ApiOperation({ summary: 'Recent $SCAD claims with tx signatures' })
  claims(@CurrentUser() ctx: AuthContext, @Query('limit') limit?: string) {
    return this.rewards.recentClaims(ctx.userId, limit ? Number(limit) : 20);
  }
}
