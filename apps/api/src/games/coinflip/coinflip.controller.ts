import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CoinflipService } from './coinflip.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../../auth/current-user.decorator';
import { CreateCoinflipDto } from './dto/create-coinflip.dto';

@ApiTags('coinflip')
@Controller('coinflip')
export class CoinflipController {
  constructor(private readonly coinflip: CoinflipService) {}

  @Get('open')
  @ApiOperation({ summary: 'List open flips waiting for a joiner' })
  listOpen(@Query('limit') limit?: string) {
    return this.coinflip.listOpen(limit ? parseInt(limit, 10) : 20);
  }

  @Get('recent')
  @ApiOperation({ summary: 'List recently resolved flips' })
  listRecent(@Query('limit') limit?: string) {
    return this.coinflip.listRecent(limit ? parseInt(limit, 10) : 20);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a new flip (locks balance)' })
  create(@CurrentUser() user: AuthContextLike, @Body() dto: CreateCoinflipDto) {
    return this.coinflip.create({
      userId: user.userId,
      side: dto.side,
      amountLamports: BigInt(dto.amountLamports),
    });
  }

  @Post(':id/join')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Join an open flip — triggers resolution' })
  join(@CurrentUser() user: AuthContextLike, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.coinflip.join({ userId: user.userId, gameId: id });
  }

  @Post(':id/cancel')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cancel an open flip (creator only)' })
  cancel(@CurrentUser() user: AuthContextLike, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.coinflip.cancel({ userId: user.userId, gameId: id });
  }
}
