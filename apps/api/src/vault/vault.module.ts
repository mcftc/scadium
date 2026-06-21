import { Module } from '@nestjs/common';
import { VaultService } from './vault.service';

/**
 * SCAD Vault — term-staking module. The controller + gateway land in V6; V4
 * ships the service so it can be wired and tested. PrismaModule is global, so
 * VaultService resolves PrismaService without an explicit import here.
 */
@Module({
  providers: [VaultService],
  exports: [VaultService],
})
export class VaultModule {}
