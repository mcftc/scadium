import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycGuard } from './kyc.guard';

// Global so the vault (deposit/withdraw) controller can apply KycGuard, and so
// other modules can read KycService, without re-importing (#45).
@Global()
@Module({
  imports: [AuthModule],
  controllers: [KycController],
  providers: [KycService, KycGuard],
  exports: [KycService, KycGuard],
})
export class KycModule {}
