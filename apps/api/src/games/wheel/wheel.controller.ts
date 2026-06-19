import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BET_THROTTLE } from '../../common/throttle.constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { WheelService } from './wheel.service';
import { PlayWheelDto } from './dto/play-wheel.dto';

@ApiTags('wheel')
@Controller('wheel')
export class WheelController {
  constructor(private readonly wheel: WheelService) {}

  @Post('play')
  @Throttle({ default: BET_THROTTLE })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Spin the wheel (instant settle)' })
  play(@CurrentUser() user: AuthContextLike, @Body() dto: PlayWheelDto) {
    return this.wheel.play({
      userId: user.userId,
      amountLamports: BigInt(dto.amountLamports),
    });
  }
}
