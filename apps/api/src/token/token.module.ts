import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { ProofOfWagerModule } from '../proof-of-wager/proof-of-wager.module';
import { TokenController } from './token.controller';
import { TokenService } from './token.service';

/**
 * $SCAD tokenomics read module. Composes the proof-of-wager emission counter
 * (ProofOfWagerModule) and the engine's burn/dividend stats (EngineModule) into
 * the public /token/stats endpoint. PrismaModule is global.
 */
@Module({
  imports: [EngineModule, ProofOfWagerModule],
  controllers: [TokenController],
  providers: [TokenService],
})
export class TokenModule {}
