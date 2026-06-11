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

/**
 * The module graph the `@scadium/worker` process boots via
 * `NestFactory.createApplicationContext`. It pulls in ONLY the infra + the five
 * job-owning feature modules (airdrop, swap, leaderboard, reconciliation,
 * rewards #28) — NOT
 * the live-game engines/gateways or HTTP controllers — so booting it does not
 * start a second crash/jackpot/lottery loop or bind a server. The worker's
 * BullMQ processors resolve `AirdropEngine`/`SwapService`/`LeaderboardService`/
 * `ReconciliationService` from this context and call them on a schedule.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    PrismaModule,
    RedisModule,
    QueueModule,
    SolanaModule,
    AirdropModule,
    SwapModule,
    LeaderboardModule,
    ReconciliationModule,
    RewardsModule,
  ],
})
export class WorkerModule {}
