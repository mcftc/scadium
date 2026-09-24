import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { KycService } from '../kyc/kyc.service';
import { ChainService } from './chain.service';

/**
 * The site's on-chain feature flag. SOL custody moved to `custody/` (ADR 0005);
 * this only tells the web whether the Anchor programs are live.
 */
@ApiTags('vault')
@Controller('vault')
export class VaultController {
  constructor(
    private readonly chain: ChainService,
    private readonly kyc: KycService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'On-chain program config (program id, enabled flag)' })
  config() {
    return {
      enabled: this.chain.enabled,
      programId: this.chain.programIdBase58,
      cluster: this.chain.cluster,
      kycEnabled: this.kyc.enabled,
    };
  }
}
