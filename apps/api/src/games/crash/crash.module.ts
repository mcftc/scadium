import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { CrashController } from './crash.controller';
import { CrashService } from './crash.service';
import { CrashGateway } from './crash.gateway';
import { CrashEngine } from './crash.engine';

@Module({
  imports: [AuthModule],
  controllers: [CrashController],
  providers: [CrashService, CrashGateway, CrashEngine],
  exports: [CrashService],
})
export class CrashModule {}
