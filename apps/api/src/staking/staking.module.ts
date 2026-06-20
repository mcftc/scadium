import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProofOfWagerModule } from '../proof-of-wager/proof-of-wager.module';
import { StakingController } from './staking.controller';
import { StakingService } from './staking.service';

@Module({
  imports: [AuthModule, ProofOfWagerModule],
  controllers: [StakingController],
  providers: [StakingService],
  exports: [StakingService],
})
export class StakingModule {}
