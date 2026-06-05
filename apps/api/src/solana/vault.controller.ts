import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ChainService } from './chain.service';

@ApiTags('vault')
@Controller('vault')
export class VaultController {
  constructor(private readonly chain: ChainService) {}

  /** Public chain config the web needs to build deposit/withdraw txs. */
  @Get('config')
  @ApiOperation({ summary: 'On-chain vault config (program id, enabled flag)' })
  config() {
    return {
      enabled: this.chain.enabled,
      programId: this.chain.programIdBase58,
      cluster: 'devnet',
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
}
