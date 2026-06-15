import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { KycGuard } from '../kyc/kyc.guard';
import { KycService } from '../kyc/kyc.service';
import { ChainService } from './chain.service';
import { VaultBridgeService } from './vault-bridge.service';

class ConfirmTransferDto {
  @IsString()
  @MinLength(32)
  signature!: string;
}

@ApiTags('vault')
@Controller('vault')
export class VaultController {
  constructor(
    private readonly chain: ChainService,
    private readonly bridge: VaultBridgeService,
    private readonly kyc: KycService,
  ) {}

  /** Public chain config the web needs to build deposit/withdraw txs. */
  @Get('config')
  @ApiOperation({ summary: 'On-chain vault config (program id, enabled flag)' })
  config() {
    return {
      enabled: this.chain.enabled,
      programId: this.chain.programIdBase58,
      cluster: this.chain.cluster,
      kycEnabled: this.kyc.enabled,
    };
  }

  @Get('balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Caller's on-chain vault balance (lamports)" })
  async balance(@CurrentUser() ctx: AuthContext) {
    const lamports = await this.chain.vaultBalance(ctx.walletAddress);
    return { vaultLamports: lamports.toString(), enabled: this.chain.enabled };
  }

  @Post('deposit-confirm')
  @UseGuards(JwtAuthGuard, KycGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Credit a VERIFIED on-chain deposit to the spendable balance (#27, idempotent)',
  })
  depositConfirm(@CurrentUser() ctx: AuthContext, @Body() dto: ConfirmTransferDto) {
    return this.bridge.confirmDeposit(ctx.userId, ctx.walletAddress, dto.signature);
  }

  @Post('withdraw-confirm')
  @UseGuards(JwtAuthGuard, KycGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Debit the mirror after a VERIFIED on-chain withdrawal (#27, idempotent)',
  })
  withdrawConfirm(@CurrentUser() ctx: AuthContext, @Body() dto: ConfirmTransferDto) {
    return this.bridge.confirmWithdraw(ctx.userId, ctx.walletAddress, dto.signature);
  }
}
