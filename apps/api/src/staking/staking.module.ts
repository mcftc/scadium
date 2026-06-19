import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StakingController } from './staking.controller';
import { StakingService } from './staking.service';

@Module({
  imports: [AuthModule],
  controllers: [StakingController],
  providers: [StakingService],
  exports: [StakingService],
})
export class StakingModule {}
