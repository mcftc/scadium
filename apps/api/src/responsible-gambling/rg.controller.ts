import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

// Positive integer lamports only — rejects 0 and negative values (a negative
// limit would always compare `> -1` and permanently self-lock the account).
const POSITIVE_LAMPORTS = /^[1-9]\d*$/;
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { RgService } from './rg.service';

class SetLimitsDto {
  @IsOptional()
  @Matches(POSITIVE_LAMPORTS)
  dailyDepositLamports?: string | null;

  @IsOptional()
  @Matches(POSITIVE_LAMPORTS)
  dailyLossLamports?: string | null;

  @IsOptional()
  @Matches(POSITIVE_LAMPORTS)
  dailyWagerLamports?: string | null;
}

class CoolOffDto {
  @IsInt()
  @Min(1)
  @Max(720)
  hours!: number;
}

class SelfExcludeDto {
  @IsInt()
  @Min(1)
  @Max(3650)
  days!: number;
}

const parseLimit = (v?: string | null): bigint | null | undefined =>
  v === undefined ? undefined : v === null || v === '' ? null : BigInt(v);

@ApiTags('responsible-gambling')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/responsible-gambling')
export class RgController {
  constructor(private readonly rg: RgService) {}

  @Get()
  @ApiOperation({ summary: 'Read the current responsible-gambling state' })
  state(@CurrentUser() ctx: AuthContext) {
    return this.rg.state(ctx.userId);
  }

  @Patch('limits')
  @ApiOperation({ summary: 'Set/clear daily deposit/loss/wager limits (lamports; null clears)' })
  setLimits(@CurrentUser() ctx: AuthContext, @Body() dto: SetLimitsDto) {
    return this.rg.setLimits(ctx.userId, {
      dailyDeposit: parseLimit(dto.dailyDepositLamports),
      dailyLoss: parseLimit(dto.dailyLossLamports),
      dailyWager: parseLimit(dto.dailyWagerLamports),
    });
  }

  @Post('cool-off')
  @ApiOperation({ summary: 'Start a cooling-off period (hours); cannot be shortened' })
  coolOff(@CurrentUser() ctx: AuthContext, @Body() dto: CoolOffDto) {
    return this.rg.setCoolOff(ctx.userId, new Date(Date.now() + dto.hours * 3_600_000));
  }

  @Post('self-exclude')
  @ApiOperation({ summary: 'Self-exclude for a number of days; cannot be shortened' })
  selfExclude(@CurrentUser() ctx: AuthContext, @Body() dto: SelfExcludeDto) {
    return this.rg.setSelfExclusion(ctx.userId, new Date(Date.now() + dto.days * 86_400_000));
  }
}
