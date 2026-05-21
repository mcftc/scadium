import {
  Body,
  Controller,
  Get,
  Patch,
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
  @ApiOperation({ summary: 'Update username/avatar of the current user' })
  updateMe(@CurrentUser() ctx: AuthContext, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(ctx.userId, dto);
  }

  @Get('bets')
  @ApiOperation({ summary: 'Paginated bet history for the current user' })
  listBets(@CurrentUser() ctx: AuthContext, @Query() query: ListBetsQueryDto) {
    return this.users.listBets(ctx.userId, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Aggregate lifetime stats for the current user' })
  getStats(@CurrentUser() ctx: AuthContext) {
    return this.users.getStats(ctx.userId);
  }
}
