import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health/health.controller';
import { FairnessModule } from './fairness/fairness.module';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
      },
    ]),
    PrismaModule,
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
  ],
  controllers: [HealthController],
})
export class AppModule {}
