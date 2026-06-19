import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { ProofOfWagerModule } from '../../proof-of-wager/proof-of-wager.module';
import { JackpotController } from './jackpot.controller';
import { JackpotService } from './jackpot.service';
import { JackpotGateway } from './jackpot.gateway';
import { JackpotEngine } from './jackpot.engine';

@Module({
  imports: [AuthModule, ProofOfWagerModule],
  controllers: [JackpotController],
  providers: [JackpotService, JackpotGateway, JackpotEngine],
  exports: [JackpotService],
})
export class JackpotModule {}
