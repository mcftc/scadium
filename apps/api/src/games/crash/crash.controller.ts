import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { CrashService } from './crash.service';
import { PlaceCrashBetDto } from './dto/place-crash-bet.dto';

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
  @ApiOperation({ summary: 'Cash out immediately at the current multiplier' })
  cashOut(@CurrentUser() user: AuthContextLike) {
    const { payoutLamports, multiplier } = this.crash.cashOut(user.userId);
    return { payoutLamports: payoutLamports.toString(), multiplier };
  }
}
