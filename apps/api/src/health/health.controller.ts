import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'scadium-api',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  }
}
