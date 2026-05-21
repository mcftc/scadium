import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global so every feature module gets PrismaService without importing
 * PrismaModule. Common pattern for apps that treat the DB client as
 * infrastructure.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
