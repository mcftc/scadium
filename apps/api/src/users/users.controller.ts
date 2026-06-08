import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ListBetsQueryDto } from './dto/list-bets-query.dto';
import { StatsQueryDto } from './dto/stats-query.dto';
import { ConnectionDto } from './dto/connection.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'Get the current user profile' })
  getMe(@CurrentUser() ctx: AuthContext) {
    return this.users.findById(ctx.userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update username/avatar/email/notification prefs' })
  updateMe(@CurrentUser() ctx: AuthContext, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(ctx.userId, dto);
  }

  @Put('connection')
  @ApiOperation({ summary: 'Link or unlink a social account (google/telegram/discord)' })
  updateConnection(@CurrentUser() ctx: AuthContext, @Body() dto: ConnectionDto) {
    return this.users.updateConnection(ctx.userId, dto.provider, dto.account ?? null);
  }

  @Get('bets')
  @ApiOperation({ summary: 'Paginated bet history for the current user' })
  listBets(@CurrentUser() ctx: AuthContext, @Query() query: ListBetsQueryDto) {
    return this.users.listBets(ctx.userId, {
      limit: query.limit,
      cursor: query.cursor,
      gameType: query.gameType,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Aggregate stats for the current user (windowed)' })
  getStats(@CurrentUser() ctx: AuthContext, @Query() query: StatsQueryDto) {
    return this.users.getStats(ctx.userId, query.window);
  }

  @Post('stats/reset')
  @ApiOperation({ summary: 'Reset the lifetime stats baseline to now' })
  resetStats(@CurrentUser() ctx: AuthContext) {
    return this.users.resetStats(ctx.userId);
  }
}
