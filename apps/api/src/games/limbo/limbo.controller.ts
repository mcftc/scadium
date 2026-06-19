import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BET_THROTTLE } from '../../common/throttle.constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { LimboService } from './limbo.service';
import { PlayLimboDto } from './dto/play-limbo.dto';

@ApiTags('limbo')
@Controller('limbo')
export class LimboController {
  constructor(private readonly limbo: LimboService) {}

  @Post('play')
  @Throttle({ default: BET_THROTTLE })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Place a limbo bet (instant settle)' })
  play(@CurrentUser() user: AuthContextLike, @Body() dto: PlayLimboDto) {
    return this.limbo.play({
      userId: user.userId,
      amountLamports: BigInt(dto.amountLamports),
      target: dto.target,
    });
  }
}
