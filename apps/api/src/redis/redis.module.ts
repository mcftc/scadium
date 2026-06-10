import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * Global so any feature module gets the shared RedisService without importing
 * RedisModule (mirrors PrismaModule). Foundation for the readiness probe (#15)
 * and the Redis-backed state/rate-limit/worker tasks (#11-#13).
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
