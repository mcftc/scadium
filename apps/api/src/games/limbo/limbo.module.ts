import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FairnessModule } from '../../fairness/fairness.module';
import { ProofOfWagerModule } from '../../proof-of-wager/proof-of-wager.module';
import { LimboController } from './limbo.controller';
import { LimboService } from './limbo.service';

@Module({
  imports: [AuthModule, FairnessModule, ProofOfWagerModule],
  controllers: [LimboController],
  providers: [LimboService],
  exports: [LimboService],
})
export class LimboModule {}
