import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformService } from './platform.service';

@ApiTags('platform')
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('live')
  @ApiOperation({ summary: 'Live game counters for the header dropdown + total-bets ticker' })
  live() {
    return this.platform.live();
  }
}
