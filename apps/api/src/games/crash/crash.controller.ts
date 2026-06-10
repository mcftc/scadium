import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BET_THROTTLE } from '../../common/throttle.constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { CrashService } from './crash.service';
import { PlaceCrashBetDto } from './dto/place-crash-bet.dto';

class CashOutDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  percent?: number;
}

@ApiTags('crash')
@Controller('crash')
export class CrashController {
  constructor(private readonly crash: CrashService) {}

  @Get('snapshot')
  @ApiOperation({ summary: 'Current round state + recent history' })
  snapshot() {
    return this.crash.snapshot();
  }

  @Post('bet')
  @Throttle({ default: BET_THROTTLE }) // bet-flood cap (#34)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Place a bet in the current waiting round' })
  async placeBet(
    @CurrentUser() user: AuthContextLike,
    @Body() dto: PlaceCrashBetDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.crash.placeBet(
      {
        userId: user.userId,
        amountLamports: BigInt(dto.amountLamports),
        autoCashout: dto.autoCashout ?? null,
      },
      key,
    );
  }

  @Post('schedule')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Queue a bet for the next round (debited now, auto-placed later)' })
  scheduleBet(@CurrentUser() user: AuthContextLike, @Body() dto: PlaceCrashBetDto) {
    return this.crash.scheduleBet({
      userId: user.userId,
      amountLamports: BigInt(dto.amountLamports),
      autoCashout: dto.autoCashout ?? null,
    });
  }

  @Post('schedule/cancel')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel the queued next-round bet and refund the stake' })
  cancelScheduled(@CurrentUser() user: AuthContextLike) {
    return this.crash.cancelScheduled(user.userId);
  }

  @Post('cashout')
  @Throttle({ default: BET_THROTTLE }) // cashout-spam cap (#34)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Cash out at the current multiplier — optionally a percentage (progressive)',
  })
  async cashOut(@CurrentUser() user: AuthContextLike, @Body() dto: CashOutDto) {
    const { payoutLamports, multiplier, remainingLamports } = await this.crash.cashOut(
      user.userId,
      dto?.percent ?? 100,
    );
    return {
      payoutLamports: payoutLamports.toString(),
      multiplier,
      remainingLamports: remainingLamports.toString(),
    };
  }
}
