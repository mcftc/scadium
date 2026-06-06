import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RewardsModule } from '../rewards/rewards.module';
import { AirdropController } from './airdrop.controller';
import { AirdropService } from './airdrop.service';

@Module({
  imports: [AuthModule, RewardsModule],
  controllers: [AirdropController],
  providers: [AirdropService],
})
export class AirdropModule {}
