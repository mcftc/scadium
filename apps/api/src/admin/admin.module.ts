import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SolanaModule } from '../solana/solana.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  // SolanaModule is @Global, but declare it explicitly: AdminController injects
  // ChainService (pause → on-chain set_paused) and shouldn't rely on the global.
  imports: [AuthModule, SolanaModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
