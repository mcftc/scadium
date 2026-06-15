import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ComplianceService } from './compliance.service';

@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /** Public licensing config the web footer gates its claim on (fail-closed). */
  @Get('config')
  @ApiOperation({ summary: 'Public compliance/licensing config (unlicensed by default)' })
  config() {
    return this.compliance.publicConfig();
  }
}
