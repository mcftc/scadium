import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { WorkerModule } from '../src/worker/worker.module';
import { AirdropEngine } from '../src/airdrop/airdrop.engine';
import { SwapService } from '../src/swap/swap.service';
import { LeaderboardService } from '../src/leaderboard/leaderboard.service';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service';
import { RewardsService } from '../src/rewards/rewards.service';
import { DistributionService } from '../src/engine/distribution.service';
import { RedisService } from '../src/redis/redis.service';

/**
 * #213 — the `@scadium/worker` process boots `WorkerModule` and resolves every
 * background-job service. It was crashing at startup because `AirdropEngine`
 * injects `RgService`, but `WorkerModule` never imported `ResponsibleGamblingModule`
 * (`@Global` only registers once imported in the booted graph). This compiles the
 * REAL `WorkerModule` provider graph (which throws on any unresolved dependency,
 * exactly as the worker boot does) and asserts every service `apps/worker/src/main.ts`
 * resolves is constructible. `.compile()` instantiates providers without running
 * `onModuleInit`, so it exercises DI wiring without opening DB/Redis connections.
 *
 * Red-before: without `ResponsibleGamblingModule` in `WorkerModule`, `.compile()`
 * throws `Nest can't resolve dependencies of ... RgService`.
 *
 * NOTE: run via `test:integration` (the swc-enabled config) — NestJS DI needs the
 * emitted decorator metadata the default vitest config erases (same as the other
 * integration e2e suites under test/).
 */
describe('#213 — WorkerModule boots: every background-job service resolves', () => {
  it('compiles the worker graph and resolves all job services (no unresolved RgService etc.)', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    try {
      // Each of these is resolved by apps/worker/src/main.ts; a missing @Global
      // provider (RgService) would have thrown at compile() above.
      expect(moduleRef.get(AirdropEngine, { strict: false })).toBeDefined();
      expect(moduleRef.get(SwapService, { strict: false })).toBeDefined();
      expect(moduleRef.get(LeaderboardService, { strict: false })).toBeDefined();
      expect(moduleRef.get(ReconciliationService, { strict: false })).toBeDefined();
      expect(moduleRef.get(RewardsService, { strict: false })).toBeDefined();
      expect(moduleRef.get(DistributionService, { strict: false })).toBeDefined();
      expect(moduleRef.get(RedisService, { strict: false })).toBeDefined();
    } finally {
      await moduleRef.close();
    }
  });
});
