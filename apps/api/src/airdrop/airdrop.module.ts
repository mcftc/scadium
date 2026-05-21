import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AirdropController } from './airdrop.controller';
import { AirdropService } from './airdrop.service';

@Module({
  imports: [AuthModule],
  controllers: [AirdropController],
  providers: [AirdropService],
})
export class AirdropModule {}
