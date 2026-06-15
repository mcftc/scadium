import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { pinoParams } from './logging/pino.config';
import { MetricsController } from './observability/metrics.controller';
import { MetricsInterceptor } from './observability/metrics.interceptor';
import { SentryExceptionFilter } from './observability/sentry-exception.filter';
import { HttpThrottlerGuard } from './common/http-throttler.guard';
import { ThrottlerRedisStorage } from './common/throttler-redis.storage';
import { DEFAULT_THROTTLE } from './common/throttle.constants';
import { RedisService } from './redis/redis.service';
import { HealthController } from './health/health.controller';
import { FairnessModule } from './fairness/fairness.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { UsersModule } from './users/users.module';
import { CoinflipModule } from './games/coinflip/coinflip.module';
import { CrashModule } from './games/crash/crash.module';
import { LotteryModule } from './games/lottery/lottery.module';
import { JackpotModule } from './games/jackpot/jackpot.module';
import { BlackjackModule } from './games/blackjack/blackjack.module';
import { ChatModule } from './chat/chat.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { AirdropModule } from './airdrop/airdrop.module';
import { AffiliatesModule } from './affiliates/affiliates.module';
import { AdminModule } from './admin/admin.module';
import { SolanaModule } from './solana/solana.module';
import { RewardsModule } from './rewards/rewards.module';
import { SwapModule } from './swap/swap.module';
import { PlatformModule } from './platform/platform.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { QueueModule } from './queue/queue.module';
import { ComplianceModule } from './compliance/compliance.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    ScheduleModule.forRoot(),
    // Structured JSON logs with request-id correlation + secret redaction (#38).
    // main.ts flushes the buffered bootstrap logs through this via app.useLogger.
    LoggerModule.forRoot(pinoParams()),
    // Redis-backed storage (#34) so limits hold across replicas — the default
    // in-process Map gives every pod its own counters. RedisModule is global,
    // so RedisService is injectable here. Per-route overrides (auth/bet
    // profiles) live in common/throttle.constants.ts.
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ...DEFAULT_THROTTLE }],
        storage: new ThrottlerRedisStorage(redis.client),
      }),
    }),
    PrismaModule,
    RedisModule,
    QueueModule,
    SolanaModule,
    FairnessModule,
    AuthModule,
    UsersModule,
    CoinflipModule,
    CrashModule,
    LotteryModule,
    JackpotModule,
    BlackjackModule,
    ChatModule,
    LeaderboardModule,
    AirdropModule,
    RewardsModule,
    SwapModule,
    AffiliatesModule,
    AdminModule,
    PlatformModule,
    ReconciliationModule,
    ComplianceModule,
  ],
  controllers: [HealthController, MetricsController],
  // Activate the configured rate limiter globally — ThrottlerModule alone is inert
  // without a registered guard. HttpThrottlerGuard scopes it to HTTP (gateways excluded).
  // Per-IP buckets require `trust proxy` (set in main.ts) so clients behind Caddy aren't
  // all collapsed onto the proxy's IP.
  providers: [
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
    // HTTP latency/throughput metrics + Sentry capture for unexpected errors (#38).
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
    { provide: APP_FILTER, useClass: SentryExceptionFilter },
  ],
})
export class AppModule {}
