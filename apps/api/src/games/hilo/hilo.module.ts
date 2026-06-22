import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FairnessModule } from '../../fairness/fairness.module';
import { ProofOfWagerModule } from '../../proof-of-wager/proof-of-wager.module';
import { HiloController } from './hilo.controller';
import { HiloService } from './hilo.service';

@Module({
  imports: [AuthModule, FairnessModule, ProofOfWagerModule],
  controllers: [HiloController],
  providers: [HiloService],
  exports: [HiloService],
})
export class HiloModule {}
