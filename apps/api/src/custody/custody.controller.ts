import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { BET_THROTTLE } from '../common/throttle.constants';
import { parseLimit } from '../common/parse-limit';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../auth/current-user.decorator';
import { KycGuard } from '../kyc/kyc.guard';
import { PrismaService } from '../prisma/prisma.service';
import { custodyConfig } from './custody.config';
import { CustodyRuntime } from './custody-runtime';
import { DepositService } from './deposit.service';
import { WithdrawalService } from './withdrawal.service';
import { transferView } from './transfer-view';

class ConfirmDepositDto {
  @IsString()
  @MinLength(32)
  @MaxLength(100)
  signature!: string;
}

class WithdrawDto {
  @IsString()
  @Matches(/^[1-9]\d*$/)
  @MaxLength(20)
  amountLamports!: string;

  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(44)
  wallet?: string;
}

/** Custody REST surface (ADR 0005, spec §8). */
@ApiTags('custody')
@Controller('custody')
export class CustodyController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: CustodyRuntime,
    private readonly deposits: DepositService,
    private readonly withdrawals: WithdrawalService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Custody settings the wallet page needs' })
  config() {
    const cfg = custodyConfig();
    const active = this.runtime.active;
    return {
      enabled: cfg.enabled,
      active: active !== null,
      inactiveReason: this.runtime.inactiveReason,
      cluster: active?.cluster ?? null,
      treasury: active?.treasury ?? null,
      commitment: cfg.commitment,
      minDepositLamports: cfg.minDepositLamports.toString(),
      minWithdrawLamports: cfg.minWithdrawLamports.toString(),
      maxWithdrawLamports: cfg.maxWithdrawLamports.toString(),
      dailyWithdrawLamports: cfg.dailyWithdrawLamports.toString(),
    };
  }

  @Get('transfers')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "The caller's deposits and withdrawals, newest first" })
  async transfers(@CurrentUser() user: AuthContextLike, @Query('limit') limit?: string) {
    const rows = await this.prisma.custodyTransfer.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: parseLimit(limit, 20, 100),
    });
    return rows.map(transferView);
  }

  @Post('deposits')
  @Throttle({ default: BET_THROTTLE })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, KycGuard)
  @ApiOperation({ summary: 'Confirm a deposit by its signature (idempotent)' })
  async confirmDeposit(@CurrentUser() user: AuthContextLike, @Body() dto: ConfirmDepositDto) {
    const out = await this.deposits.confirm(dto.signature);
    if (!('id' in out)) return out;
    // The credit goes to whoever SENT it; only its owner sees the details.
    return out.userId === user.userId ? transferView(out) : { status: out.status };
  }

  @Post('deposits/scan')
  @Throttle({ default: BET_THROTTLE })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Look for deposits now (e.g. after the tab closed mid-deposit)' })
  scan() {
    return this.deposits.scan();
  }

  @Post('withdrawals')
  @Throttle({ default: BET_THROTTLE })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, KycGuard)
  @ApiOperation({ summary: 'Withdraw deposited SOL to a wallet linked to the account' })
  withdraw(
    @CurrentUser() user: AuthContextLike,
    @Body() dto: WithdrawDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.withdrawals.request(
      user.userId,
      { amountLamports: BigInt(dto.amountLamports), wallet: dto.wallet },
      key,
    );
  }
}
