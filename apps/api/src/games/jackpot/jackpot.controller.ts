import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { parseLimit } from '../../common/parse-limit';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { BET_THROTTLE } from '../../common/throttle.constants';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { JackpotService } from './jackpot.service';
import { EnterJackpotDto } from './dto/enter-jackpot.dto';

@ApiTags('jackpot')
@Controller('jackpot')
export class JackpotController {
  constructor(private readonly jackpot: JackpotService) {}

  @Get('current')
  @ApiOperation({ summary: 'Current open round + players + last result' })
  current() {
    return this.jackpot.snapshot();
  }

  @Get('recent')
  @ApiOperation({ summary: 'Recent resolved rounds with revealed seeds' })
  recent(@Query('limit') limit?: string) {
    return this.jackpot.recent(parseLimit(limit, 10, 50));
  }

  @Get('my-entries')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'The caller’s recent jackpot rounds' })
  myEntries(@CurrentUser() user: AuthContextLike, @Query('limit') limit?: string) {
    return this.jackpot.myEntries(user.userId, parseLimit(limit, 20, 50));
  }

  @Post('enter')
  @Throttle({ default: BET_THROTTLE }) // enter-flood cap (#34)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Enter the current jackpot round with a SOL amount' })
  enter(
    @CurrentUser() user: AuthContextLike,
    @Body() dto: EnterJackpotDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.jackpot.enter(
      { userId: user.userId, amountLamports: BigInt(dto.amountLamports) },
      key,
    );
  }
}
