import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { NonceRequestDto } from './dto/nonce-request.dto';
import { VerifyDto } from './dto/verify.dto';
import { RefreshDto } from './dto/refresh.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, type AuthContextLike } from './current-user.decorator';

/** Capture the request's user-agent + client IP for the Session row. */
const sessionCtx = (req: Request) => ({
  userAgent: req.headers['user-agent'] ?? null,
  ipAddress: req.ip ?? null,
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('nonce')
  @ApiOperation({ summary: 'Issue a fresh nonce for SIWS signing' })
  nonce(@Body() dto: NonceRequestDto) {
    return this.auth.requestNonce(dto.walletAddress);
  }

  @Post('verify')
  @ApiOperation({ summary: 'Verify SIWS signature and issue an access + refresh token pair' })
  verify(@Body() dto: VerifyDto, @Req() req: Request) {
    return this.auth.verifyAndIssueToken(dto, sessionCtx(req));
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate a refresh token for a new access + refresh pair' })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, sessionCtx(req));
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out the current session (revokes this access token)' })
  async logout(@CurrentUser() user: AuthContextLike) {
    await this.auth.logout(user.jti);
    return { ok: true };
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Log out everywhere (revokes all of this user’s sessions)' })
  async logoutAll(@CurrentUser() user: AuthContextLike) {
    await this.auth.logoutAll(user.userId);
    return { ok: true };
  }
}
