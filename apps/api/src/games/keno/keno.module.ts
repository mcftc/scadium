import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FairnessModule } from '../../fairness/fairness.module';
import { ProofOfWagerModule } from '../../proof-of-wager/proof-of-wager.module';
import { KenoController } from './keno.controller';
import { KenoService } from './keno.service';

@Module({
  imports: [AuthModule, FairnessModule, ProofOfWagerModule],
  controllers: [KenoController],
  providers: [KenoService],
  exports: [KenoService],
})
export class KenoModule {}
