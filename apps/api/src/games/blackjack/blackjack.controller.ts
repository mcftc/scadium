import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { BlackjackService } from './blackjack.service';
import { StartBlackjackDto } from './dto/start-blackjack.dto';
import { BlackjackActionDto } from './dto/blackjack-action.dto';

@ApiTags('blackjack')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('blackjack')
export class BlackjackController {
  constructor(private readonly bj: BlackjackService) {}

  @Get('active')
  @ApiOperation({ summary: 'Get the current hand state (or null)' })
  active(@CurrentUser() user: AuthContextLike) {
    return this.bj.getActive(user.userId);
  }

  @Post('start')
  @ApiOperation({ summary: 'Start a new blackjack hand' })
  start(@CurrentUser() user: AuthContextLike, @Body() dto: StartBlackjackDto) {
    return this.bj.start({
      userId: user.userId,
      amountLamports: BigInt(dto.amountLamports),
    });
  }

  @Post('action')
  @ApiOperation({ summary: 'Hit / Stand / Double on the current hand' })
  action(@CurrentUser() user: AuthContextLike, @Body() dto: BlackjackActionDto) {
    return this.bj.action({ userId: user.userId, action: dto.action });
  }
}
