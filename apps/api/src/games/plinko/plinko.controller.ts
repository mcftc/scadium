import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BET_THROTTLE } from '../../common/throttle.constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { PlinkoService } from './plinko.service';
import { PlayPlinkoDto } from './dto/play-plinko.dto';

@ApiTags('plinko')
@Controller('plinko')
export class PlinkoController {
  constructor(private readonly plinko: PlinkoService) {}

  @Post('play')
  @Throttle({ default: BET_THROTTLE })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Drop a plinko ball (instant settle)' })
  play(@CurrentUser() user: AuthContextLike, @Body() dto: PlayPlinkoDto) {
    return this.plinko.play({
      userId: user.userId,
      amountLamports: BigInt(dto.amountLamports),
      rows: dto.rows,
    });
  }
}
