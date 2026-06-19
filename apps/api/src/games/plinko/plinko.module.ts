import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FairnessModule } from '../../fairness/fairness.module';
import { ProofOfWagerModule } from '../../proof-of-wager/proof-of-wager.module';
import { PlinkoController } from './plinko.controller';
import { PlinkoService } from './plinko.service';

@Module({
  imports: [AuthModule, FairnessModule, ProofOfWagerModule],
  controllers: [PlinkoController],
  providers: [PlinkoService],
  exports: [PlinkoService],
})
export class PlinkoModule {}
