import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { BlackjackController } from './blackjack.controller';
import { BlackjackService } from './blackjack.service';
import { BlackjackEngine } from './blackjack.engine';
import { BlackjackGateway } from './blackjack.gateway';

@Module({
  imports: [AuthModule],
  controllers: [BlackjackController],
  providers: [BlackjackService, BlackjackEngine, BlackjackGateway],
  exports: [BlackjackService],
})
export class BlackjackModule {}
