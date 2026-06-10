import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FairnessModule } from '../fairness/fairness.module';
import { RewardsController } from './rewards.controller';
import { RewardsService } from './rewards.service';

@Module({
  imports: [AuthModule, FairnessModule],
  controllers: [RewardsController],
  providers: [RewardsService],
  exports: [RewardsService],
})
export class RewardsModule {}
