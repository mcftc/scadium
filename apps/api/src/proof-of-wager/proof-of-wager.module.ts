import { Module } from '@nestjs/common';
import { ProofOfWagerService } from './proof-of-wager.service';

// PrismaService is provided globally (PrismaModule is @Global), so this module
// only needs to register the service and export it to the game modules.
@Module({
  providers: [ProofOfWagerService],
  exports: [ProofOfWagerService],
})
export class ProofOfWagerModule {}
