import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BET_THROTTLE } from '../../common/throttle.constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { KenoService } from './keno.service';
import { PlayKenoDto } from './dto/play-keno.dto';

@ApiTags('keno')
@Controller('keno')
export class KenoController {
  constructor(private readonly keno: KenoService) {}

  @Post('play')
  @Throttle({ default: BET_THROTTLE })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Place a keno bet (instant settle)' })
  play(@CurrentUser() user: AuthContextLike, @Body() dto: PlayKenoDto) {
    return this.keno.play({
      userId: user.userId,
      amountLamports: BigInt(dto.amountLamports),
      picks: dto.picks,
      risk: dto.risk,
    });
  }
}
