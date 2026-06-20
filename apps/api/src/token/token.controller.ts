import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TokenService } from './token.service';

/**
 * Public (unauthenticated) $SCAD tokenomics read endpoint — supply, emission
 * halving progress, the 6-way distribution, and value flows (burn / dividends).
 * Read-only; never mutates balances.
 */
@ApiTags('token')
@Controller('token')
export class TokenController {
  constructor(private readonly token: TokenService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Tokenomics: supply, emission halving, distribution, value flows' })
  stats() {
    return this.token.stats();
  }
}
