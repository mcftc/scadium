import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FairnessController } from './fairness.controller';
import { FairnessService } from './fairness.service';
import { SeedManagerService } from './seed-manager.service';

@Module({
  imports: [AuthModule],
  controllers: [FairnessController],
  providers: [FairnessService, SeedManagerService],
  // SeedManagerService is exported so the game engines can derive each bet from
  // the player's active seed pair + monotonic nonce (#92/#93).
  exports: [FairnessService, SeedManagerService],
})
export class FairnessModule {}
