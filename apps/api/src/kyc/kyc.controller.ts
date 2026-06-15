import { Body, Controller, ForbiddenException, Headers, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { KycService } from './kyc.service';

class KycWebhookDto {
  @IsString()
  providerRef!: string;

  @IsString()
  status!: string;

  @IsOptional()
  @IsBoolean()
  sanctionsCleared?: boolean;
}

@ApiTags('kyc')
@Controller('kyc')
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Post('start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Begin identity verification; returns a provider SDK token' })
  start(@CurrentUser() ctx: AuthContext) {
    return this.kyc.start(ctx.userId);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Provider verification callback (HMAC-signed)' })
  async webhook(@Body() dto: KycWebhookDto, @Headers('x-kyc-signature') signature?: string) {
    if (!this.kyc.verifySignature(dto.providerRef, dto.status, signature)) {
      throw new ForbiddenException('Invalid webhook signature');
    }
    await this.kyc.applyWebhook(dto);
    return { ok: true as const };
  }
}
