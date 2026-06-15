import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../auth/current-user.decorator';
import { AdminService } from './admin.service';
import { MaintenanceService } from '../maintenance/maintenance.service';
import { ChainService } from '../solana/chain.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly maintenance: MaintenanceService,
    private readonly chain: ChainService,
  ) {}

  @Post('pause')
  @ApiOperation({ summary: 'Global kill-switch: pause all wagering/deposits (admin only)' })
  async pause(@CurrentUser() user: AuthContextLike) {
    await this.admin.assertAdmin(user.userId);
    await this.maintenance.setPaused(true);
    // Halt on-chain settlement too (no-op while the vault is play-money/undeployed).
    await this.chain.setPaused(true).catch(() => undefined);
    return { ok: true, paused: true };
  }

  @Post('resume')
  @ApiOperation({ summary: 'Lift the global pause (admin only)' })
  async resume(@CurrentUser() user: AuthContextLike) {
    await this.admin.assertAdmin(user.userId);
    await this.maintenance.setPaused(false);
    await this.chain.setPaused(false).catch(() => undefined);
    return { ok: true, paused: false };
  }

  @Post('cosigner/reload')
  @ApiOperation({
    summary: 'Rotate/reload the on-chain cosigner key without a redeploy (admin only) (#36)',
  })
  async reloadCosigner(@CurrentUser() user: AuthContextLike) {
    await this.admin.assertAdmin(user.userId);
    const cosigner = this.chain.reloadCosigner();
    await this.admin.recordCosignerReload(user.userId, cosigner);
    return { ok: true, cosigner };
  }

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
    await this.admin.banUser(user.userId, id, reason);
    return { ok: true };
  }

  @Post('users/:id/unban')
  @ApiOperation({ summary: 'Unban a user (admin only)' })
  async unban(@CurrentUser() user: AuthContextLike, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.admin.assertAdmin(user.userId);
    await this.admin.unbanUser(user.userId, id);
    return { ok: true };
  }

  @Get('reconciliation/drift')
  @ApiOperation({ summary: 'Recent reconciliation drift flags (admin only)' })
  async drift(@CurrentUser() user: AuthContextLike) {
    await this.admin.assertAdmin(user.userId);
    return this.admin.recentDrift();
  }

  @Get('audit-log')
  @ApiOperation({ summary: 'Recent privileged-action audit log (admin only)' })
  async auditLog(@CurrentUser() user: AuthContextLike) {
    await this.admin.assertAdmin(user.userId);
    return this.admin.recentAuditLog();
  }
}
