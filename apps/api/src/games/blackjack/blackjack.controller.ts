import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { BlackjackService } from './blackjack.service';

class TakeSeatDto {
  @IsInt()
  @Min(0)
  @Max(4)
  seatIndex!: number;
}

class PlaceTableBetDto {
  @IsNumberString()
  mainLamports!: string;

  @IsOptional()
  @IsNumberString()
  side21p3Lamports?: string;

  @IsOptional()
  @IsNumberString()
  sidePerfectPairsLamports?: string;
}

class TableActionDto {
  @IsIn(['hit', 'stand', 'double'])
  action!: 'hit' | 'stand' | 'double';
}

@ApiTags('blackjack')
@Controller('blackjack')
export class BlackjackController {
  constructor(private readonly blackjack: BlackjackService) {}

  @Get('tables')
  @ApiOperation({ summary: 'Public table lobby list' })
  tables() {
    return this.blackjack.listTables();
  }

  @Get('tables/:id')
  @ApiOperation({ summary: 'Full table snapshot (spectators welcome)' })
  table(@Param('id') id: string) {
    return this.blackjack.snapshot(id);
  }

  @Post('lobby/find')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Find New Lobby — emptiest public table (creates one if all full)' })
  findLobby() {
    return this.blackjack.findLobby();
  }

  @Post('solo')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Play Alone — a private single-seat table' })
  solo(@CurrentUser() user: AuthContextLike) {
    return this.blackjack.soloTable(user.userId);
  }

  @Post('tables/:id/seat')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Take an open seat at the table' })
  seat(
    @CurrentUser() user: AuthContextLike,
    @Param('id') id: string,
    @Body() dto: TakeSeatDto,
  ) {
    return this.blackjack.takeSeat({ tableId: id, seatIndex: dto.seatIndex, userId: user.userId });
  }

  @Post('tables/:id/leave')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Leave your seat (refunds the bet during the betting window)' })
  leave(@CurrentUser() user: AuthContextLike, @Param('id') id: string) {
    return this.blackjack.leaveSeat(id, user.userId);
  }

  @Post('tables/:id/bet')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Place/replace your bet (main + optional 21+3 / Perfect Pairs)' })
  bet(
    @CurrentUser() user: AuthContextLike,
    @Param('id') id: string,
    @Body() dto: PlaceTableBetDto,
  ) {
    return this.blackjack.placeBet({
      tableId: id,
      userId: user.userId,
      mainLamports: BigInt(dto.mainLamports),
      side21p3Lamports: BigInt(dto.side21p3Lamports ?? '0'),
      sidePerfectPairsLamports: BigInt(dto.sidePerfectPairsLamports ?? '0'),
    });
  }

  @Post('tables/:id/clear-bet')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Clear your bet during the betting window (full refund)' })
  clearBet(@CurrentUser() user: AuthContextLike, @Param('id') id: string) {
    return this.blackjack.clearBet(id, user.userId);
  }

  @Post('tables/:id/action')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Hit / stand / double on your turn' })
  action(
    @CurrentUser() user: AuthContextLike,
    @Param('id') id: string,
    @Body() dto: TableActionDto,
  ) {
    return this.blackjack.action({ tableId: id, userId: user.userId, action: dto.action });
  }
}
