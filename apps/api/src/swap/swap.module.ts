import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SwapController } from './swap.controller';
import { SwapService } from './swap.service';

@Module({
  imports: [AuthModule],
  controllers: [SwapController],
  providers: [SwapService],
  exports: [SwapService],
})
export class SwapModule {}
