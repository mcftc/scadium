import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BET_THROTTLE } from '../../common/throttle.constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { HiloService } from './hilo.service';
import { StartHiloDto } from './dto/start-hilo.dto';
import { GuessHiloDto } from './dto/guess-hilo.dto';

@ApiTags('hilo')
@Controller('hilo')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class HiloController {
  constructor(private readonly hilo: HiloService) {}

  @Post('start')
  @Throttle({ default: BET_THROTTLE })
  @ApiOperation({ summary: 'Start a Hi-Lo round (debits the stake)' })
  start(@CurrentUser() user: AuthContextLike, @Body() dto: StartHiloDto) {
    return this.hilo.start({ userId: user.userId, amountLamports: BigInt(dto.amountLamports) });
  }

  @Post(':roundId/guess')
  @Throttle({ default: BET_THROTTLE })
  @ApiOperation({ summary: 'Guess higher-or-same / lower-or-same (correct = continue, wrong = bust)' })
  guess(
    @CurrentUser() user: AuthContextLike,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() dto: GuessHiloDto,
  ) {
    return this.hilo.guess({ userId: user.userId, roundId, direction: dto.direction });
  }

  @Post(':roundId/cashout')
  @Throttle({ default: BET_THROTTLE })
  @ApiOperation({ summary: 'Cash out the current Hi-Lo round' })
  cashout(@CurrentUser() user: AuthContextLike, @Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.hilo.cashout({ userId: user.userId, roundId });
  }

  @Get('active')
  @ApiOperation({ summary: 'Get the active Hi-Lo round (masked), or null' })
  active(@CurrentUser() user: AuthContextLike) {
    return this.hilo.active(user.userId);
  }
}
