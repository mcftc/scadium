import { Module } from '@nestjs/common';
import { JobsController } from './jobs.controller';
import { JobRunnerService } from './job-runner.service';

/**
 * Exposes `POST /internal/jobs/:name` so Cloudflare Cron Triggers can drive the
 * economy jobs. Imports nothing: `JobRunnerService` reaches the job-owning
 * services through `ModuleRef` with `strict: false`, so this module adds a route
 * without widening any other module's public surface.
 */
@Module({
  controllers: [JobsController],
  providers: [JobRunnerService],
})
export class JobsModule {}
