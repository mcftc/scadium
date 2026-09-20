import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InternalSecretGuard } from './internal-secret.guard';
import { JobRunnerService } from './job-runner.service';
import { JOB_NAMES, isJobName, type JobPayload } from './job-registry';

/**
 * ONE generic route for all 9 economy jobs — deliberately not one endpoint per
 * job. A new job arrives as a new entry in `JOB_HANDLERS`, not a new route here.
 *
 * Called by the Cloudflare Cron Trigger worker (see `worker/index.ts`). It is the
 * scheduling guarantee for a container that is allowed to sleep: BullMQ's
 * repeatable schedulers only fire while the process is awake, whereas Cron fires
 * regardless. Both paths are safe to run because every handler is idempotent and
 * period-keyed.
 *
 * Runs the job synchronously so the caller sees success/failure. A caller-side
 * timeout is harmless — the job continues server-side and is idempotent, so the
 * next fire converges.
 *
 * Hidden from Swagger and skipped by the throttler (the cron is trusted and
 * fixed-rate); the shared-secret guard is the access control.
 */
@ApiExcludeController()
@SkipThrottle()
@UseGuards(InternalSecretGuard)
@Controller('internal/jobs')
export class JobsController {
  constructor(private readonly runner: JobRunnerService) {}

  @Post(':name')
  @HttpCode(200)
  async run(
    @Param('name') name: string,
    @Body() body?: JobPayload,
  ): Promise<{ ok: true; job: string; durationMs: number }> {
    if (!isJobName(name)) {
      throw new BadRequestException(`unknown job '${name}' (expected one of: ${JOB_NAMES.join(', ')})`);
    }
    const result = await this.runner.run(name, body);
    return { ok: true, ...result };
  }
}
