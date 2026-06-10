import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';

/**
 * Global so any feature module can enqueue jobs (e.g. the admin airdrop force)
 * without importing QueueModule. The consumer side lives in `@scadium/worker`.
 */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
