import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FairnessService } from './fairness.service';
import { SeedManagerService } from './seed-manager.service';
import { VerifyFairnessDto } from './dto/verify-fairness.dto';
import { SetClientSeedDto } from './dto/set-client-seed.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from '../auth/current-user.decorator';

@ApiTags('fairness')
@Controller('fairness')
export class FairnessController {
  constructor(
    private readonly fairness: FairnessService,
    private readonly seeds: SeedManagerService,
  ) {}

  @Post('verify')
  @ApiOperation({ summary: 'Reproduce a game result from seeds (provably fair)' })
  verify(@Body() dto: VerifyFairnessDto) {
    return this.fairness.verify(dto);
  }

  @Get('seed')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "The caller's active seed pair + next commitment + nonce" })
  getSeed(@CurrentUser() user: AuthContextLike) {
    return this.seeds.getOrCreateActivePair(user.userId);
  }

  @Post('seed/client')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Set the caller’s client seed (resets the nonce)' })
  setClientSeed(@CurrentUser() user: AuthContextLike, @Body() dto: SetClientSeedDto) {
    return this.seeds.setClientSeed(user.userId, dto.clientSeed);
  }

  @Post('seed/rotate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Reveal the current server seed and publish a fresh commitment' })
  rotate(@CurrentUser() user: AuthContextLike) {
    return this.seeds.rotateServerSeed(user.userId);
  }
}
