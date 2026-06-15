import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RgController } from './rg.controller';
import { RgService } from './rg.service';

/**
 * Global so every game service can inject `RgService` and route its wager
 * through the single shared `assertCanWager` gate without importing the module.
 * Imports AuthModule so the JWT-guarded RgController can resolve JwtAuthGuard.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [RgController],
  providers: [RgService],
  exports: [RgService],
})
export class ResponsibleGamblingModule {}
