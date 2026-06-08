import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { WalletAddressDto, WalletLinkDto } from './dto/wallet.dto';

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

  @Get('wallets')
  @ApiOperation({ summary: 'List the account’s wallets (primary + linked)' })
  listWallets(@CurrentUser() ctx: AuthContext) {
    return this.users.listWallets(ctx.userId);
  }

  @Post('wallets/nonce')
  @ApiOperation({ summary: 'Issue a SIWS nonce to prove ownership of a wallet to link' })
  walletNonce(@CurrentUser() _ctx: AuthContext, @Body() dto: WalletAddressDto) {
    return this.users.walletLinkNonce(dto.address);
  }

  @Post('wallets/link')
  @ApiOperation({ summary: 'Link a wallet after signing the SIWS nonce with it' })
  linkWallet(@CurrentUser() ctx: AuthContext, @Body() dto: WalletLinkDto) {
    return this.users.linkWallet(ctx.userId, dto);
  }

  @Post('wallets/primary')
  @ApiOperation({ summary: 'Make a linked wallet the primary one' })
  setPrimaryWallet(@CurrentUser() ctx: AuthContext, @Body() dto: WalletAddressDto) {
    return this.users.setPrimaryWallet(ctx.userId, dto.address);
  }

  @Delete('wallets/:address')
  @ApiOperation({ summary: 'Unlink a linked wallet (cannot unlink the primary)' })
  unlinkWallet(@CurrentUser() ctx: AuthContext, @Param('address') address: string) {
    return this.users.unlinkWallet(ctx.userId, address);
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
