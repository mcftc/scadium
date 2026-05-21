import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AffiliatesService } from './affiliates.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../auth/current-user.decorator';

@ApiTags('affiliates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('affiliates')
export class AffiliatesController {
  constructor(private readonly affiliates: AffiliatesService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Affiliate lifetime stats for the current user' })
  stats(@CurrentUser() user: AuthContextLike) {
    return this.affiliates.stats(user.userId);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Recent referrals for the current user' })
  recent(@CurrentUser() user: AuthContextLike) {
    return this.affiliates.recentReferrals(user.userId);
  }
}
