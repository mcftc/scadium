import { Module } from '@nestjs/common';
import { BotService } from './bot.service';

/**
 * Demo-bot driver module (`DEMO_BOTS=1`). Provides {@link BotService}, which
 * resolves every game service lazily via `ModuleRef` — so this module imports
 * NO game module and cannot break the app-boot module graph. It must be
 * registered AFTER the game modules in `AppModule` so those providers exist by
 * the time `BotService.onModuleInit` runs. A no-op unless bots are enabled.
 */
@Module({
  providers: [BotService],
})
export class BotsModule {}
