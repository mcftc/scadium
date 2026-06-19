import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FairnessModule } from '../../fairness/fairness.module';
import { ProofOfWagerModule } from '../../proof-of-wager/proof-of-wager.module';
import { WheelController } from './wheel.controller';
import { WheelService } from './wheel.service';

@Module({
  imports: [AuthModule, FairnessModule, ProofOfWagerModule],
  controllers: [WheelController],
  providers: [WheelService],
  exports: [WheelService],
})
export class WheelModule {}
