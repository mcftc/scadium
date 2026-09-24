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

/** Outcome of one job in a run-all sweep. */
interface JobRunResult {
  job: string;
  ok: boolean;
  durationMs?: number;
  error?: string;
}

/**
 * ONE generic route for all the economy + custody jobs — deliberately not one endpoint per
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

  /**
   * Run EVERY job, sequentially. This is what the hourly Cloudflare Cron Trigger
   * calls, so the cron Worker never has to know the job names — one source of
   * truth (`JOB_HANDLERS`), one request.
   *
   * A failing job is recorded and the rest still run: a broken reconcile must not
   * stop the dividend round. Every handler is a no-op when its period is already
   * settled, so running the full set hourly is cheap.
   */
  @Post()
  @HttpCode(200)
  async runAll(): Promise<{ ok: boolean; results: JobRunResult[] }> {
    const results: JobRunResult[] = [];
    for (const name of JOB_NAMES) {
      try {
        const { durationMs } = await this.runner.run(name);
        results.push({ job: name, ok: true, durationMs });
      } catch (e) {
        results.push({ job: name, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { ok: results.every((r) => r.ok), results };
  }

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
