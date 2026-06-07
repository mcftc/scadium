import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { CrashModule } from '../games/crash/crash.module';
import { CoinflipModule } from '../games/coinflip/coinflip.module';
import { BlackjackModule } from '../games/blackjack/blackjack.module';
import { JackpotModule } from '../games/jackpot/jackpot.module';

@Module({
  imports: [CrashModule, CoinflipModule, BlackjackModule, JackpotModule],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
