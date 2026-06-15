import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MaintenanceService } from './maintenance.service';

@ApiTags('status')
@Controller('status')
export class StatusController {
  constructor(private readonly maintenance: MaintenanceService) {}

  /** Public status the web reads to show a maintenance banner / disable play (#56). */
  @Get()
  @ApiOperation({ summary: 'Public platform status (global pause flag)' })
  async status() {
    return { paused: await this.maintenance.isPaused() };
  }
}
