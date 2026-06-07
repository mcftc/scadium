import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { LotteryService } from './lottery.service';
import { BuyTicketDto } from './dto/buy-ticket.dto';

class ConfirmTicketDto {
  @IsString()
  @Length(64, 96)
  signature!: string;
}

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
    return this.lottery.recentDraws(limit ? Math.min(100, Number(limit)) : 10);
  }

  @Get('draws/:drawIndex/results')
  @ApiOperation({ summary: 'One round: winning numbers, tallies and the public winners list' })
  drawResults(@Param('drawIndex') drawIndex: string) {
    if (!/^\d+$/.test(drawIndex)) throw new BadRequestException('Invalid draw index');
    return this.lottery.drawResults(BigInt(drawIndex));
  }

  @Get('jackpot-winners')
  @ApiOperation({ summary: 'Historical grand-prize (jackpot) winners' })
  jackpotWinners(@Query('limit') limit?: string) {
    return this.lottery.jackpotWinners(limit ? Math.min(100, Number(limit)) : 50);
  }

  @Get('my-stats')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'The caller’s lifetime lottery stats (My Bets cards)' })
  myStats(@CurrentUser() user: AuthContextLike) {
    return this.lottery.myStats(user.userId);
  }

  @Get('my-tickets')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'The caller’s recent lottery tickets' })
  myTickets(
    @CurrentUser() user: AuthContextLike,
    @Query('limit') limit?: string,
    @Query('won') won?: string,
  ) {
    return this.lottery.myTickets(
      user.userId,
      limit ? Math.min(50, Number(limit)) : 20,
      won === 'true',
    );
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

  @Post('confirm')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Register an on-chain ticket purchase (user-signed buy_ticket tx signature)',
  })
  confirm(@CurrentUser() user: AuthContextLike, @Body() dto: ConfirmTicketDto) {
    return this.lottery.confirmTicket({ userId: user.userId, signature: dto.signature });
  }

  @Get('free-tickets')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Earned free tickets (1 per 1 SOL wagered across all games)' })
  freeTickets(@CurrentUser() user: AuthContextLike) {
    return this.lottery.freeTicketStatus(user.userId);
  }

  @Post('ticket/free')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Spend one earned free ticket on your picks' })
  useFreeTicket(@CurrentUser() user: AuthContextLike, @Body() dto: BuyTicketDto) {
    return this.lottery.useFreeTicket({
      userId: user.userId,
      mainNumbers: dto.mainNumbers,
      bonusNumber: dto.bonusNumber,
    });
  }

  @Post('faucet')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Devnet: receive 10 demo USDT for ticket purchases' })
  faucet(@CurrentUser() user: AuthContextLike) {
    return this.lottery.usdtFaucet(user.userId);
  }

  @Post('draw/run')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin: resolve the current draw immediately' })
  async runDraw(@CurrentUser() user: AuthContextLike) {
    await this.lottery.forceDraw(user.userId);
    return this.lottery.snapshot();
  }
}
