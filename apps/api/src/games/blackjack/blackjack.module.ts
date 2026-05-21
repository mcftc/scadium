import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { BlackjackController } from './blackjack.controller';
import { BlackjackService } from './blackjack.service';

@Module({
  imports: [AuthModule],
  controllers: [BlackjackController],
  providers: [BlackjackService],
  exports: [BlackjackService],
})
export class BlackjackModule {}
