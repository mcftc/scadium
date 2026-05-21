import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { NonceRequestDto } from './dto/nonce-request.dto';
import { VerifyDto } from './dto/verify.dto';

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
  @ApiOperation({ summary: 'Verify SIWS signature and issue JWT' })
  verify(@Body() dto: VerifyDto) {
    return this.auth.verifyAndIssueToken(dto);
  }
}
