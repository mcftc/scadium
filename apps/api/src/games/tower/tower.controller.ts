import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BET_THROTTLE } from '../../common/throttle.constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { TowerService } from './tower.service';
import { StartTowerDto } from './dto/start-tower.dto';
import { PickTowerDto } from './dto/pick-tower.dto';

@ApiTags('tower')
@Controller('tower')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class TowerController {
  constructor(private readonly tower: TowerService) {}

  @Post('start')
  @Throttle({ default: BET_THROTTLE })
  @ApiOperation({ summary: 'Start a Tower round (debits the stake)' })
  start(@CurrentUser() user: AuthContextLike, @Body() dto: StartTowerDto) {
    return this.tower.start({ userId: user.userId, amountLamports: BigInt(dto.amountLamports) });
  }

  @Post(':roundId/pick')
  @Throttle({ default: BET_THROTTLE })
  @ApiOperation({ summary: 'Step on a tile in the current row (safe = climb, trap = bust)' })
  pick(
    @CurrentUser() user: AuthContextLike,
    @Param('roundId', ParseUUIDPipe) roundId: string,
    @Body() dto: PickTowerDto,
  ) {
    return this.tower.pick({ userId: user.userId, roundId, column: dto.column });
  }

  @Post(':roundId/cashout')
  @Throttle({ default: BET_THROTTLE })
  @ApiOperation({ summary: 'Cash out the current Tower round' })
  cashout(@CurrentUser() user: AuthContextLike, @Param('roundId', ParseUUIDPipe) roundId: string) {
    return this.tower.cashout({ userId: user.userId, roundId });
  }

  @Get('active')
  @ApiOperation({ summary: 'Get the active Tower round (masked), or null' })
  active(@CurrentUser() user: AuthContextLike) {
    return this.tower.active(user.userId);
  }
}
