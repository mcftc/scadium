import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const PAUSE_KEY = 'scadium:maintenance:paused';

/**
 * Global pause / kill-switch (#56). A single Redis flag, read by the wager gate
 * (RgService.assertCanWager) and the deposit path, that lets ops halt all new
 * real-money flow instantly across every replica. In-flight rounds still settle.
 * Reads fail-OPEN (a Redis blip must not take the platform down); the flag is
 * only ever true when an admin explicitly set it.
 */
@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(private readonly redis: RedisService) {}

  async isPaused(): Promise<boolean> {
    try {
      return (await this.redis.client.get(PAUSE_KEY)) === '1';
    } catch (e) {
      this.logger.warn(`pause-flag read failed (fail-open): ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }

  /**
   * Set/clear the pause flag. Fails LOUD (unlike the read): if the Redis write
   * throws, the platform state is indeterminate, so we re-throw to surface a 5xx
   * to the admin rather than silently report success. Ops must re-check
   * `GET /status` after any failed pause/resume.
   */
  async setPaused(paused: boolean): Promise<void> {
    try {
      if (paused) await this.redis.client.set(PAUSE_KEY, '1');
      else await this.redis.client.del(PAUSE_KEY);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `pause-flag write failed (paused=${paused}) — platform state indeterminate: ${msg}`,
      );
      throw new ServiceUnavailableException(
        'Failed to update maintenance flag (Redis unreachable). Verify GET /status.',
      );
    }
  }
}
