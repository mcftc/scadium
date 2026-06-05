import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { LotteryService } from './lottery.service';
import { BuyTicketDto } from './dto/buy-ticket.dto';

@ApiTags('lottery')
@Controller('lottery')
export class LotteryController {
  constructor(private readonly lottery: LotteryService) {}

  @Get('current')
  @ApiOperation({ summary: 'Current open draw + last result' })
  current() {
    return this.lottery.snapshot();
  }

  @Get('recent')
  @ApiOperation({ summary: 'Recent resolved draws with revealed seeds' })
  recent(@Query('limit') limit?: string) {
    return this.lottery.recentDraws(limit ? Math.min(50, Number(limit)) : 10);
  }

  @Get('my-tickets')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'The caller’s recent lottery tickets' })
  myTickets(@CurrentUser() user: AuthContextLike, @Query('limit') limit?: string) {
    return this.lottery.myTickets(user.userId, limit ? Math.min(50, Number(limit)) : 20);
  }

  @Post('ticket')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Buy a ticket for the current draw (5 of 36 + 1 of 10)' })
  buyTicket(@CurrentUser() user: AuthContextLike, @Body() dto: BuyTicketDto) {
    return this.lottery.buyTicket({
      userId: user.userId,
      mainNumbers: dto.mainNumbers,
      bonusNumber: dto.bonusNumber,
    });
  }
}
