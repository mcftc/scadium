import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { VaultService } from './vault.service';

export class VaultDepositDto {
  /** Target term pool id. */
  @IsString()
  @MaxLength(40)
  poolId!: string;

  /** $SCAD base units (9 decimals) to lock, as a decimal string. */
  @IsString()
  @Matches(/^[1-9]\d*$/)
  @MaxLength(20)
  amount!: string;
}

export class VaultWithdrawDto {
  /** The position to withdraw from. */
  @IsString()
  @MaxLength(40)
  positionId!: string;

  /** Shares to burn (decimal string). Omit to withdraw the whole position. */
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d*$/)
  @MaxLength(30)
  shares?: string;
}

@ApiTags('vault')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('vault')
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get('pools')
  @ApiOperation({ summary: 'Active term pools (term, APR, index, totals)' })
  pools() {
    return this.vault.pools();
  }

  @Get('positions')
  @ApiOperation({ summary: "The caller's vault positions with current value + maturity" })
  positions(@CurrentUser() ctx: AuthContext) {
    return this.vault.positions(ctx.userId);
  }

  @Post('deposit')
  @ApiOperation({ summary: 'Lock $SCAD into a term pool (mints a position)' })
  deposit(@CurrentUser() ctx: AuthContext, @Body() dto: VaultDepositDto) {
    return this.vault.deposit(ctx.userId, dto.poolId, BigInt(dto.amount));
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Withdraw from a position (early = penalised, kept in pool)' })
  withdraw(@CurrentUser() ctx: AuthContext, @Body() dto: VaultWithdrawDto) {
    return this.vault.withdraw(
      ctx.userId,
      dto.positionId,
      dto.shares === undefined ? undefined : BigInt(dto.shares),
    );
  }
}
