import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { CrashModule } from '../games/crash/crash.module';
import { CoinflipModule } from '../games/coinflip/coinflip.module';
import { BlackjackModule } from '../games/blackjack/blackjack.module';
import { JackpotModule } from '../games/jackpot/jackpot.module';
import { onlyIfEnabled } from '../games/enabled-games';

/**
 * The live-counters endpoint.
 *
 * Its game imports MUST be gated the same way as AppModule's. A module imported
 * here is instantiated here — so importing BlackjackModule unconditionally
 * would register blackjack's controller and Socket.io gateway even when the
 * game is switched off at app level, quietly defeating the gate and leaving the
 * game bettable by URL. PlatformService injects each game @Optional() to match.
 */
@Module({
  imports: [
    ...onlyIfEnabled('crash', CrashModule),
    ...onlyIfEnabled('coinflip', CoinflipModule),
    ...onlyIfEnabled('blackjack', BlackjackModule),
    ...onlyIfEnabled('jackpot', JackpotModule),
  ],
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
