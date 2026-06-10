import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { queueConnection } from './queue.connection';
import { QUEUE_NAMES, airdropDistributeJobId } from './queue.constants';

/**
 * API-side queue PRODUCER. Lets HTTP handlers enqueue durable jobs that the
 * `@scadium/worker` process consumes, instead of running them in-process. The
 * connection + queues are created lazily on first enqueue so the API still boots
 * when Redis is unavailable (enqueue then fails loudly rather than at startup).
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues = new Map<string, Queue>();

  private queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: queueConnection() });
      this.queues.set(name, q);
    }
    return q;
  }

  /**
   * Enqueue the hourly airdrop distribution for `period` (UTC YYYYMMDDHH). The
   * jobId is keyed on the period, so a timer-fire and an admin force for the same
   * hour collapse to ONE job. `forcedByUserId` flows to the worker so the
   * privileged-action audit row is still written by the processor.
   */
  async enqueueAirdropDistribute(period: string, forcedByUserId?: string): Promise<void> {
    await this.queue(QUEUE_NAMES.airdrop).add(
      'distribute',
      { period, forcedByUserId },
      { jobId: airdropDistributeJobId(period), removeOnComplete: 1000, removeOnFail: 5000 },
    );
    this.logger.log(`enqueued airdrop:distribute ${period}${forcedByUserId ? ' (forced)' : ''}`);
  }

  async onModuleDestroy(): Promise<void> {
    for (const q of this.queues.values()) await q.close().catch(() => undefined);
  }
}
