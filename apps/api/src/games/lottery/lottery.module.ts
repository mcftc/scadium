import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ProofOfWagerModule } from '../../proof-of-wager/proof-of-wager.module';
import { LotteryController } from './lottery.controller';
import { LotteryService } from './lottery.service';
import { LotteryGateway } from './lottery.gateway';
import { LotteryEngine } from './lottery.engine';

@Module({
  imports: [AuthModule, ProofOfWagerModule],
  controllers: [LotteryController],
  providers: [LotteryService, LotteryGateway, LotteryEngine],
  exports: [LotteryService],
})
export class LotteryModule {}
