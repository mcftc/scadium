import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { QueueModule } from '../queue/queue.module';
import { SolanaModule } from '../solana/solana.module';
import { AirdropModule } from '../airdrop/airdrop.module';
import { SwapModule } from '../swap/swap.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { RewardsModule } from '../rewards/rewards.module';
import { EngineModule } from '../engine/engine.module';
import { ResponsibleGamblingModule } from '../responsible-gambling/rg.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { KycModule } from '../kyc/kyc.module';
import { AffiliatesModule } from '../affiliates/affiliates.module';

/**
 * The module graph the `@scadium/worker` process boots via
 * `NestFactory.createApplicationContext`. It pulls in ONLY the infra + the five
 * job-owning feature modules (airdrop, swap, leaderboard, reconciliation,
 * rewards #28) — NOT
 * the live-game engines/gateways or HTTP controllers — so booting it does not
 * start a second crash/jackpot/lottery loop or bind a server. The worker's
 * BullMQ processors resolve `AirdropEngine`/`SwapService`/`LeaderboardService`/
 * `ReconciliationService` from this context and call them on a schedule.
 *
 * `ResponsibleGamblingModule` is `@Global` but only registers once imported in a
 * booted graph (#213): `AirdropEngine` injects `RgService`, so the worker root —
 * like the api `AppModule` — must import it, or the worker crashes at boot
 * resolving `AirdropEngine`.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    PrismaModule,
    RedisModule,
    QueueModule,
    SolanaModule,
    MaintenanceModule,
    ResponsibleGamblingModule,
    KycModule,
    AffiliatesModule,
    AirdropModule,
    SwapModule,
    LeaderboardModule,
    ReconciliationModule,
    RewardsModule,
    EngineModule,
  ],
})
export class WorkerModule {}
