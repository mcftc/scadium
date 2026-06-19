import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FairnessModule } from '../../fairness/fairness.module';
import { ProofOfWagerModule } from '../../proof-of-wager/proof-of-wager.module';
import { CoinflipController } from './coinflip.controller';
import { CoinflipService } from './coinflip.service';
import { CoinflipGateway } from './coinflip.gateway';

@Module({
  imports: [AuthModule, FairnessModule, ProofOfWagerModule],
  controllers: [CoinflipController],
  providers: [CoinflipService, CoinflipGateway],
  exports: [CoinflipService],
})
export class CoinflipModule {}
