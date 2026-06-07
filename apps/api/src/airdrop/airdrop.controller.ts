import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsNumberString } from 'class-validator';
import { AirdropService } from './airdrop.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../auth/current-user.decorator';

class TipDto {
  @IsNumberString()
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
  openCase(@CurrentUser() user: AuthContextLike) {
    return this.airdrop.openDailyCase(user.userId);
  }
}
