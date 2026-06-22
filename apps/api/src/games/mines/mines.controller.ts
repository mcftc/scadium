import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BET_THROTTLE } from '../../common/throttle.constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { MinesService } from './mines.service';
import { StartMinesDto } from './dto/start-mines.dto';
import { PickMinesDto } from './dto/pick-mines.dto';

@ApiTags('mines')
@Controller('mines')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class MinesController {
  constructor(private readonly mines: MinesService) {}

  @Post('start')
  @Throttle({ default: BET_THROTTLE })
  @ApiOperation({ summary: 'Start a Mines round (debits the stake)' })
  start(@CurrentUser() user: AuthContextLike, @Body() dto: StartMinesDto) {
    return this.mines.start({
      userId: user.userId,
      amountLamports: BigInt(dto.amountLamports),
      mines: dto.mines,
    });
  }

  @Post(':roundId/pick')
  @Throttle({ default: BET_THROTTLE })
  @ApiOperation({ summary: 'Reveal a tile (safe = continue, bomb = bust)' })
  pick(
    @CurrentUser() user: AuthContextLike,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() dto: PickMinesDto,
  ) {
    return this.mines.pick({ userId: user.userId, roundId, cell: dto.cell });
  }

  @Post(':roundId/cashout')
  @Throttle({ default: BET_THROTTLE })
  @ApiOperation({ summary: 'Cash out the current Mines round' })
  cashout(@CurrentUser() user: AuthContextLike, @Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.mines.cashout({ userId: user.userId, roundId });
  }

  @Get('active')
  @ApiOperation({ summary: 'Get the active Mines round (masked), or null' })
  active(@CurrentUser() user: AuthContextLike) {
    return this.mines.active(user.userId);
  }
}
