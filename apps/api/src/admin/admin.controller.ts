import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../auth/current-user.decorator';
import { AdminService } from './admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Platform-wide KPIs (admin only)' })
  async stats(@CurrentUser() user: AuthContextLike) {
    await this.admin.assertAdmin(user.userId);
    return this.admin.platformStats();
  }

  @Post('users/:id/ban')
  @ApiOperation({ summary: 'Ban a user (admin only)' })
  async ban(
    @CurrentUser() user: AuthContextLike,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body('reason') reason?: string,
  ) {
    await this.admin.assertAdmin(user.userId);
    await this.admin.banUser(id, reason);
    return { ok: true };
  }

  @Post('users/:id/unban')
  @ApiOperation({ summary: 'Unban a user (admin only)' })
  async unban(
    @CurrentUser() user: AuthContextLike,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.admin.assertAdmin(user.userId);
    await this.admin.unbanUser(id);
    return { ok: true };
  }
}
