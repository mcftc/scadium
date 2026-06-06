import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Place a bet in the current waiting round' })
  async placeBet(@CurrentUser() user: AuthContextLike, @Body() dto: PlaceCrashBetDto) {
    return this.crash.placeBet({
      userId: user.userId,
      amountLamports: BigInt(dto.amountLamports),
      autoCashout: dto.autoCashout ?? null,
    });
  }

  @Post('cashout')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Cash out at the current multiplier — optionally a percentage (progressive)',
  })
  cashOut(@CurrentUser() user: AuthContextLike, @Body() dto: CashOutDto) {
    const { payoutLamports, multiplier, remainingLamports } = this.crash.cashOut(
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
