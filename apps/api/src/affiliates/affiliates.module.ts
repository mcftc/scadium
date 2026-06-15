import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AffiliatesController } from './affiliates.controller';
import { AffiliatesService } from './affiliates.service';

// Global so game settlement services can inject AffiliatesService to credit
// referrers inside their settlement transaction (#47).
@Global()
@Module({
  imports: [AuthModule],
  controllers: [AffiliatesController],
  providers: [AffiliatesService],
  exports: [AffiliatesService],
})
export class AffiliatesModule {}
