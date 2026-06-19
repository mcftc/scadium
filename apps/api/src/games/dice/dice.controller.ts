import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BET_THROTTLE } from '../../common/throttle.constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { DiceService } from './dice.service';
import { PlayDiceDto } from './dto/play-dice.dto';

@ApiTags('dice')
@Controller('dice')
export class DiceController {
  constructor(private readonly dice: DiceService) {}

  @Post('play')
  @Throttle({ default: BET_THROTTLE })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Place a dice bet (instant settle)' })
  play(@CurrentUser() user: AuthContextLike, @Body() dto: PlayDiceDto) {
    return this.dice.play({
      userId: user.userId,
      amountLamports: BigInt(dto.amountLamports),
      target: dto.target,
    });
  }
}
