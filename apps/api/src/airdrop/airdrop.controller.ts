import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Matches, MaxLength } from 'class-validator';
import { AirdropService } from './airdrop.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../auth/current-user.decorator';

export class TipDto {
  // Lamport amount as a STRICTLY POSITIVE integer string: no sign, no leading
  // zero, no decimals. `@IsNumberString()` used to accept "-1000000000", which
  // — combined with a `{ decrement }` write — was a balance-mint vector
  // (ANALYSIS.md §4 Critical #1). This rejects it at the edge; the service
  // guard and a DB CHECK constraint are the defense-in-depth backstops.
  @Matches(/^[1-9]\d*$/, {
    message: 'amountLamports must be a positive integer (lamports), no sign or leading zero',
  })
  @MaxLength(20) // u64 max is 19 digits; 20 is a safe cap
  amountLamports!: string;
}

@ApiTags('airdrop')
@Controller('airdrop')
export class AirdropController {
  constructor(private readonly airdrop: AirdropService) {}

  @Get('next')
  @ApiOperation({ summary: 'Next airdrop drop time and pool' })
  next() {
    return this.airdrop.nextDropInfo();
  }

  @Get('pool')
  @ApiOperation({ summary: 'Live hourly airdrop pool (left-rail widget)' })
  pool() {
    return this.airdrop.pool();
  }

  @Post('tip')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Tip play-balance SOL into the current airdrop pool' })
  tip(@CurrentUser() user: AuthContextLike, @Body() dto: TipDto) {
    return this.airdrop.tip(user.userId, BigInt(dto.amountLamports));
  }

  @Post('run')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Admin: force the hourly distribution to run now' })
  run(@CurrentUser() user: AuthContextLike) {
    return this.airdrop.forceDistribute(user.userId);
  }

  @Get('eligibility')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Check current user eligibility for the next drop' })
  eligibility(@CurrentUser() user: AuthContextLike) {
    return this.airdrop.checkEligibility(user.userId);
  }

  @Get('case/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Whether the user can open the daily case now' })
  caseStatus(@CurrentUser() user: AuthContextLike) {
    return this.airdrop.caseStatus(user.userId);
  }

  @Post('case/open')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Open the daily case for a random reward' })
  openCase(
    @CurrentUser() user: AuthContextLike,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.airdrop.openDailyCase(user.userId, key);
  }
}
