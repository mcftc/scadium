import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { FairnessModule } from '../../fairness/fairness.module';
import { ProofOfWagerModule } from '../../proof-of-wager/proof-of-wager.module';
import { TowerController } from './tower.controller';
import { TowerService } from './tower.service';

@Module({
  imports: [AuthModule, FairnessModule, ProofOfWagerModule],
  controllers: [TowerController],
  providers: [TowerService],
  exports: [TowerService],
})
export class TowerModule {}
